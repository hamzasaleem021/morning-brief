# Morning Brief

> Your sources. Your signal. Every morning.

A focused RSS reader that holds up to 20 feeds and presents them as a daily personal brief. No algorithm. No ads. No reading history. Just the publications you've chosen, fetched fresh, in the order you want.

## What it is

- A PWA (Progressive Web App) — install to your home screen, works offline after first load
- Single-file app: `morning-brief.html` contains the full UI and logic
- Up to 20 RSS sources; each gets its own section with the 5 latest posts
- Dark mode, drag-reorder, scroll-spy nav, pull-to-refresh
- Optional magic-link sync across devices via Supabase
- OPML import/export — bring your feeds from any reader, take them with you any time
- No tracking, no analytics, no ads (see `privacy.html`)

## Files

```
morning-brief.html       — Main app (CSS + JS inline by design)
config.js                — All tunable constants; fork-friendly
sw.js                    — Service worker (offline + update prompt)
discovery.js             — Source catalog browser ("Discover")
discovery-sources.json   — 1,250 curated RSS feeds across 67 categories
opml.js                  — OPML import/export (Manage Sources modal)
privacy.html             — Privacy policy (shares the app's stylesheet)
manifest.json            — PWA manifest
icon-192.png, icon-512.png — App icons
```

## Architecture

A strict 4-layer flow for all source operations:

```
State → Persist → Sync → UI
```

- **State**: sole owner of the in-memory source list. Assigns source colors internally.
- **Persist**: write-through cache to localStorage. Never read for decisions.
- **Sync**: Supabase pull on login, push on every change, realtime subscription with self-echo suppression. Returns `{ok, error}` for every push — failures surface as a persistent banner.
- **UI**: reads only from State. Never touches localStorage or Supabase directly.

This separation keeps bugs rare: a sync failure cannot cause UI drift, and a UI action cannot skip persistence.

## Self-hosting

Fork this repo and edit `config.js`:

```js
window.MB_CONFIG = {
  RSS_PROXY:    '...your Cloudflare Worker URL...',
  SUPABASE_URL: '...your Supabase project URL...',
  SUPABASE_KEY: '...your sb_publishable_ key...',
  AMPLITUDE_KEY: null,       // null disables analytics entirely
  // ...
};
```

### Supabase setup (required if you want sync)

You **must** configure Row Level Security before deploying publicly. The shipped `sb_publishable_` key is designed to be client-side safe, but only with proper RLS policies on both tables below.

Run this once in the Supabase SQL editor. It creates both tables Morning Brief uses (`user_configs` for sources, `user_clippings` for Clippings), locks each row to its owner, and grants the app access.

> **Since 30 Oct 2026, Supabase no longer gives new tables API access automatically.** The `grant` lines below are required — without them the app gets "permission denied".

```sql
-- ── Sources: one row per user ─────────────────────────────────────────
create table public.user_configs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  config_data jsonb not null default '{"custom": [], "removed": []}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.user_configs enable row level security;

create policy "users manage own config" on public.user_configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger update_user_configs_updated_at
  before update on public.user_configs
  for each row execute function public.update_updated_at_column();

-- ── Clippings: one row per saved passage ──────────────────────────────
create table public.user_clippings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  text             text not null,
  article_url      text not null,
  article_title    text,
  article_pub_date timestamptz,
  source_id        text,
  source_name      text,
  source_domain    text,
  note             text,
  saved_at         timestamptz not null default now()
);

create index user_clippings_user_id_idx on public.user_clippings (user_id, saved_at desc);

alter table public.user_clippings enable row level security;

create policy "users read own clippings"   on public.user_clippings
  for select using (auth.uid() = user_id);
create policy "users insert own clippings" on public.user_clippings
  for insert with check (auth.uid() = user_id);
create policy "users update own clippings" on public.user_clippings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete own clippings" on public.user_clippings
  for delete using (auth.uid() = user_id);

-- ── Functions the app calls (load / save sources) ─────────────────────
-- security definer + an explicit owner check: a signed-in user can only
-- ever read or write their own row, and signed-out callers are refused.
create or replace function public.get_user_config(p_user_id uuid)
returns table (config_data jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select uc.config_data from public.user_configs uc where uc.user_id = p_user_id;
end; $$;

create or replace function public.upsert_user_config(p_user_id uuid, p_config_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.user_configs (user_id, config_data)
  values (p_user_id, p_config_data)
  on conflict (user_id) do update
    set config_data = excluded.config_data, updated_at = now();
end; $$;

-- ── Access grants (required for new tables since 30 Oct 2026) ─────────
grant select, insert, update, delete on public.user_configs   to authenticated;
grant select, insert, update, delete on public.user_clippings to authenticated;
grant select, insert, update, delete on public.user_configs   to service_role;
grant select, insert, update, delete on public.user_clippings to service_role;

revoke execute on function public.get_user_config(uuid)           from public, anon;
revoke execute on function public.upsert_user_config(uuid, jsonb) from public, anon;
grant  execute on function public.get_user_config(uuid)           to authenticated;
grant  execute on function public.upsert_user_config(uuid, jsonb) to authenticated;
```

Test that RLS is actually blocking cross-user reads before deploying. Authenticate as user A in one tab, attempt to query user B's row — it must return zero rows. Also confirm `rpc('get_user_config', { p_user_id: <user B's id> })` from user A returns a "not allowed" error.

### RSS proxy

The proxy exists to bypass CORS on RSS feeds. A minimal Cloudflare Worker:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url).searchParams.get('url');
    if (!url) return new Response('Missing url param', { status: 400 });
    const res = await fetch(url);
    const body = await res.text();
    return new Response(body, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/xml',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
```

## Install prompt

The install prompt isn't shown on first visit. It appears once the user has:
- Visited at least 2 separate sessions (30-min idle threshold)
- Added at least 3 sources

On iOS, a separate "Add to Home Screen" hint with Share-icon instructions appears under the same conditions.

## Key design decisions

- **One-file philosophy preserved.** CSS and JS stay inline in `morning-brief.html`. The single-file approach is part of the product — simple to deploy, easy to audit, easy to fork.
- **Source colors are generated, not picked from a palette.** An HSL wheel rotating from the accent color (`#c8502a`) produces 20 unique, harmonious colors that sit comfortably on the ivory background and adapt to dark mode.
- **20-source limit is a feature.** A focused feed is the whole idea. Raising this would turn Morning Brief into a feed aggregator.
- **No Amplitude by default.** The `AMPLITUDE_KEY` in `config.js` ships as `null`. Setting it to a real key enables tracking — if you do, update `privacy.html` and the welcome copy to disclose it.

## Development

No build step. Open `morning-brief.html` in a browser or serve the directory statically:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/morning-brief.html
```

For service-worker testing, serve with HTTPS (use `ngrok` or similar) or test on localhost.

## License

MIT.
