# Morning Brief

> Your sources. Your signal. Every morning.

A minimalist RSS reader as a single-file PWA. No algorithm, no ranking, no ads — just the feeds you choose, rendered cleanly.

## What it is

- **One HTML file.** `morning-brief.html` is the entire app: markup, styles, and logic in a single file. Open it locally, host it anywhere.
- **PWA.** Installable on desktop and mobile, works offline for the shell, caches aggressively.
- **Optional cross-device sync** via Supabase magic-link auth. Privacy-preserving: no passwords, no tracking, the user's source list is the only thing stored.
- **Free-tier RSS proxy** via a personal Cloudflare Worker (handles CORS so feeds work from any origin).

## Architecture

The main script follows a strict 4-layer separation with one-way data flow:

```
  User action ──▶ State ──▶ Persist ──▶ Sync ──▶ UI
                   ▲                               │
                   └───────────────────────────────┘
                       (cloud pull / realtime replaces state)
```

- **State** — sole owner of the runtime source list. Everything else reads from it; only the explicit mutators (`addSource`, `removeSource`, `reorderSources`, `replaceSources`) modify it. Enforces the `MAX_SOURCES` limit.
- **Persist** — write-through cache to `localStorage`. Never read for decisions; only used to seed state on next boot.
- **Sync** — Supabase is the cloud authority. On login: `pull` and replace local state (cloud wins). On change: `push`. Realtime subscription applies remote changes to state.
- **UI** — renders from State only. Never touches `localStorage` or Supabase directly.

## Files

| File | Purpose |
|---|---|
| `morning-brief.html` | The app |
| `sw.js` | Service worker (app-shell cache, external-API passthrough, update prompt) |
| `manifest.json` | PWA manifest |
| `privacy.html` | Privacy page |
| `discovery-netflix.js` | Netflix-style "browse all sources" modal |
| `discovery-sources.json` | Curated catalog of ~1250 RSS feeds across 67 categories |
| `icon-192.png`, `icon-512.png` | App icons |

## Self-hosting setup

The app expects three external dependencies. Substitute your own URLs/keys:

1. **Cloudflare Worker RSS proxy.** Replace `RSS_PROXY` in `morning-brief.html`. The worker should take `?url=<rss-url>`, fetch it, and return the body with permissive CORS headers.
2. **Supabase project.** Replace `SUPABASE_URL` and `SUPABASE_KEY` (the publishable `sb_publishable_...` key). You also need:
   - A table `public.user_configs (user_id uuid primary key, config_data jsonb)`.
   - Two RPC functions: `get_user_config(p_user_id uuid)` returning `setof user_configs`, and `upsert_user_config(p_user_id uuid, p_config_data jsonb)` returning `void`.
   - **Row Level Security enabled** (see below — non-optional).
   - Magic-link auth enabled under Authentication → Providers.
3. **Amplitude analytics** (optional). Replace the project key in `Analytics.init()`, or remove the Amplitude snippet entirely.

## Critical: Supabase RLS

The `sb_publishable_` key is safe to ship in the frontend **only if** Row Level Security is enabled on `user_configs`. Without RLS, anyone with the key can read every user's config. Run this in the Supabase SQL editor:

```sql
alter table public.user_configs enable row level security;

create policy "users read own config"
  on public.user_configs for select
  using (auth.uid() = user_id);

create policy "users insert own config"
  on public.user_configs for insert
  with check (auth.uid() = user_id);

create policy "users update own config"
  on public.user_configs for update
  using (auth.uid() = user_id);
```

Verify under Authentication → Policies that all three exist.

## Running locally

```bash
# Any static server; the app has no build step.
python3 -m http.server 8000
# Then open http://localhost:8000/morning-brief.html
```

Service workers require HTTPS in production, but `localhost` is treated as secure for development.

## Limits

- 20 sources per user (configurable via `MAX_SOURCES` in `morning-brief.html`).
- 5-second fetch timeout per feed, 5 concurrent fetches max.
- 5 articles rendered per source (1 featured + 4 list items).

## License

No license declared. Fork freely, but check before commercial use.
