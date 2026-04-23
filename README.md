# Morning Brief

> Your sources. Your signal. Every morning.

A focused RSS reader that holds up to 20 feeds and presents them as a daily personal brief. No algorithm. No ads. No reading history. Just the publications you've chosen, fetched fresh, in the order you want.

## What it is

- A PWA (Progressive Web App) — install to your home screen, works offline after first load
- Single-file app: `morning-brief.html` contains the full UI and logic
- Up to 20 RSS sources; each gets its own section with the 5 latest posts
- Dark mode, drag-reorder, scroll-spy nav, pull-to-refresh
- Optional magic-link sync across devices via Supabase
- No tracking, no analytics, no ads (see `privacy.html`)

## Files

```
morning-brief.html       — Main app (CSS + JS inline by design)
config.js                — All tunable constants; fork-friendly
sw.js                    — Service worker (offline + update prompt)
discovery.js             — Source catalog browser ("Discover")
discovery-sources.json   — 1,250 curated RSS feeds across 67 categories
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

You **must** configure Row Level Security before deploying publicly. The shipped `sb_publishable_` key is designed to be client-side safe, but only with proper RLS policies on the `user_configs` table.

Minimum required schema:

```sql
create table public.user_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_configs enable row level security;

create policy "users read own config" on public.user_configs
  for select using (auth.uid() = user_id);

create policy "users upsert own config" on public.user_configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.get_user_config(p_user_id uuid)
returns setof public.user_configs language sql security invoker as $$
  select * from public.user_configs where user_id = p_user_id and auth.uid() = p_user_id;
$$;

create or replace function public.upsert_user_config(p_user_id uuid, p_config_data jsonb)
returns public.user_configs language plpgsql security invoker as $$
declare result public.user_configs; begin
  insert into public.user_configs (user_id, config_data, updated_at)
  values (p_user_id, p_config_data, now())
  on conflict (user_id) do update set config_data = excluded.config_data, updated_at = now()
  where public.user_configs.user_id = auth.uid()
  returning * into result;
  return result;
end; $$;
```

Test that RLS is actually blocking cross-user reads before deploying. Authenticate as user A in one tab, attempt to query user B's row — it must return zero rows.

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
