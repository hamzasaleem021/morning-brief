# Changelog

## v10 — The Coherence Release

Major refactor focused on data integrity, design coherence, and onboarding.

### Fixed (data integrity — highest priority)
- **Sync failures no longer silent.** `Sync.push()` now returns `{ok, error}` and failures surface as a persistent banner with retry. Previous behavior caused silent cloud-local divergence.
- **Source colors no longer collide.** Colors are now assigned inside `State.addSource()` using an "unused first" strategy. The 8-color flat palette has been replaced with a generated HSL wheel — 20 distinct, accent-anchored tones.
- **Source IDs now use `crypto.randomUUID()`.** Previously `Date.now()` was used, which collided under rapid clicks.
- **Cache corruption no longer wipes sources.** Corrupt order-key parse is now isolated from source-key parse (each has its own try/catch).

### Added
- **Pull-to-refresh** on mobile (the welcome copy now matches reality).
- **Scroll-spy** on the pill nav — active pill updates as you scroll.
- **Focus trap** in modals + Escape-to-close.
- **Enter-to-submit** on the Add Source and sign-in inputs.
- **Magic-link UX pass**: inline submit button, client-side email validation, "Open Gmail/Outlook/Yahoo" deep-link after send.
- **Starter pack + curated bundles** in Discover — one-click add-all for new users.
- **`prefers-reduced-motion`** honored throughout.
- **Multi-tab theme sync** via storage events.
- **Touch-aware drag reorder** — works on iOS Safari without external libraries.

### Changed
- **Discover rebuilt in the app's design language.** Same modal shell, same button treatment, same palette. Purple gradient, stoplight stats, and parallel toast system are gone.
- **Install prompt retimed.** No longer shown on first visit. Appears after 2 sessions AND 3 sources. New bottom-anchored card design.
- **iOS install hint** is now a proper instructional card with numbered steps, not a fading tooltip.
- **Welcome state** when zero sources: opens Discover directly instead of the empty "Add by URL" form.
- **Privacy page** now inherits the app's stylesheet and supports dark mode.
- **Masthead mobile layout reworked** — theme toggle and sync indicator moved to absolute-positioned slots, content condensed.
- **Tablet portrait breakpoint added** (700–999px) — iPad no longer gets the phone layout.
- **Excerpt parser** prefers `content:encoded`, strips HTML via safer `DOMParser('text/html')`, truncates at word boundaries, and renders nothing (not "Invalid Date") for malformed dates.
- **Error banner** now derives visibility from a `failedSources` Set — individual retries correctly clear it.
- **Custom SVG illustrations** replace emoji in welcome state and drag handle.
- **Service worker** cache-first with strict response gating; update prompt prompts user before reload; first-install no longer triggers a spurious reload.

### Removed
- **Amplitude SDK and all analytics calls.** `config.js` ships with `AMPLITUDE_KEY: null` — no tracking of any kind by default. This resolves the contradiction with the "no tracking" pitch on the welcome screen.
- **Unused font weights** (Playfair 400, DM Sans 300) — smaller font payload.

### Architecture
- **New `config.js`** centralizes every constant. Fork-friendly — deployment changes live in one file.
- **Realtime echo suppression** via a client nonce embedded in each push.
- **Retry logic** triggers on `online` and `focus` events, plus manual retry button.
- **All push awaits** now propagate through `addSource`, `removeSource`, and drag-reorder.

---

# Changelog — Pareto refactor pass

This pass addresses the top-priority findings from the evaluation. All changes preserve the 4-layer architecture (State → Persist → Sync → UI).

## Files modified

| File | Changes |
|---|---|
| `morning-brief.html` | 11 logical changes, documented below |
| `sw.js` | Cache version bump + `SKIP_WAITING` message listener |
| `manifest.json` | Icon `purpose` split into separate `any`/`maskable` entries |
| `discovery-netflix.js` | Renamed shadowed function, migrated inline onclicks to delegation |
| `README.md` | Expanded from one line to full setup docs |

## `morning-brief.html` — changes in order

### 1. Theme-color meta pair
Replaced the single `<meta name="theme-color">` with a light/dark media-query pair so the browser chrome matches the active theme.

### 2. New constants
Added `MAX_SOURCES = 20`, `FETCH_TIMEOUT = 5000`, `FETCH_CONCURRENCY = 5` next to the existing constants block.

### 3. Prominent RLS warning in source
Added a multi-line comment next to `SUPABASE_KEY` that explains RLS is not optional and gives the exact SQL to run. Protects future maintainers from accidentally deploying without it.

### 4. `State.addSource` now enforces the 20-source limit
Moved the limit check from the discovery file into `State.addSource()` so it's enforced at the authoritative layer. Return type changed from `boolean` to `{ ok: boolean, reason?: 'limit' | 'duplicate_rss' | 'duplicate_id' }`. Only one caller consumed the old return (which ignored it), so no call sites broke.

### 5. Three new UI helpers inside the `UI` module
- `showToast(msg, duration)` — non-blocking notice, replaces most `alert()` calls.
- `confirmDialog(message, {okText, cancelText})` — async `Promise<boolean>` dialog with Escape/Enter handling, replaces `confirm()`.
- `mapWithConcurrency(items, limit, mapper)` — small worker-pool helper so RSS fetches cap at 5 in flight.

### 6. `fetchRSS` returns a structured result
Changed from `Array<Article>` (with `{live: true/false}` sentinel) to `{ status, articles }` where status is `'ok' | 'timeout' | 'network' | 'empty' | 'parse'`. Now distinguishes real error modes instead of showing the same "sample posts" fallback for everything. Also:
- Timeout reduced from 8s → 5s (via `FETCH_TIMEOUT`).
- `.slice(0, 6)` → `.slice(0, 5)` — fixes an off-by-one that fetched and threw away the 6th item.
- Added explicit `parsererror` detection for malformed XML.

### 7. `renderArticles` consumes the new shape
Non-ok results render a `.feed-error` block with a "Retry" button instead of a fake article. The button has `data-retry-id="<source.id>"` — picked up by event delegation.

### 8. New public methods on `UI`
- `UI.refetchAll()` — re-fetches every source without re-mounting the DOM (preserves scroll position, nav pills, dividers).
- `UI.refetchOne(id)` — targeted retry, used by the per-section retry button.
- `UI.toast`, `UI.confirm` — re-exports of the helpers above.

### 9. Modal remove button uses data-attribute, not inline onclick
`renderModal()`'s row template now uses `data-remove-id="<id>"` and a `.source-remove-btn` class instead of `onclick="removeSource('<id>')"`. The `<id>` interpolation is safe (it's generated internally) but event delegation is more robust.

### 10. User actions rewritten
- `addSource()` — delegates the limit/duplicate logic to `State.addSource()` and surfaces the returned reason via `UI.toast()`.
- `removeSource()` — uses `UI.confirm()` (async) instead of `confirm()` (sync/blocking).
- `handleSync()` — uses `UI.toast()` instead of `alert()`.
- `refreshAll()` — **deleted the 40-line duplicate** of `fetchRSS` + `renderArticles` that was inlined here. Now calls `UI.refetchAll()`. Net: ~50 lines removed.

### 11. Init sequence restructured
- **Analytics no longer blocks the boot.** Was: `await Analytics.init()`. Now: `Analytics.init().then(track).catch(warn)` — fire-and-forget. On a slow network, sync no longer waits up to 5 seconds for the Amplitude SDK.
- **Global event delegation** (`setupEventDelegation`) wired once at init for all dynamically rendered `data-retry-id` and `data-remove-id` elements.
- **Service worker update prompt** (`setupServiceWorker` + `promptUpdate`) — detects a waiting SW, shows a bottom toast with Reload/Dismiss. On confirm, the page posts `SKIP_WAITING` to the worker and `controllerchange` triggers a one-time reload. Returning users will no longer silently run stale app shells.

### 12. New CSS (all using existing design tokens)
`.mb-toast`, `.mb-confirm-overlay`, `.mb-confirm-box`, `.mb-confirm-msg`, `.mb-confirm-actions`, `.mb-confirm-cancel`, `.mb-confirm-ok`, `.feed-error`, `.feed-retry`, `.source-remove-btn`, `.mb-update-toast`, `.mb-update-reload`, `.mb-update-dismiss`. Dark-mode automatic via existing `--ink` / `--paper` / `--accent` variables.

## `sw.js` — changes

- `CACHE = 'morning-brief-v8'` → `'morning-brief-v9'`. Forces the update flow to actually trigger for returning users.
- Removed `self.skipWaiting()` from the `install` handler — the page now controls when the update activates.
- Added a `message` listener that calls `skipWaiting()` when the page sends `{ type: 'SKIP_WAITING' }`.

## `manifest.json` — changes

Icons now have separate entries for `purpose: "any"` and `purpose: "maskable"` at both 192 and 512 sizes, matching current PWA spec guidance. Previously both purposes were on a single entry, which some Android versions crop incorrectly. Aligned `theme_color` to `#f5f0e8` (matches the light-mode `theme-color` meta tag).

## `discovery-netflix.js` — changes

### Renamed local `addSource` → `addFromDiscovery`
The local function shadowed the host-app's global `addSource`, and the `typeof addSource === 'function'` guard that followed was always true but referred to the wrong function. Rename eliminates the shadow entirely. The `window.addFromDiscovery = addFromDiscovery` export now correctly points at the renamed function, matching what the event handlers call.

### Inline onclick → data attributes + delegation
- Source cards: `onclick="window.addFromDiscovery(...)"` replaced with `data-add-name`, `data-add-url`, `data-add-category`.
- Close button: `onclick="window.closeDiscovery()"` replaced with `data-action="close-discovery"`.
- Single delegated click listener on the modal handles all three.

Benefit: the `escapeHtml`'d strings are now in attribute values (where `&#39;` is a real entity) rather than inside a single-quoted JS literal inside a double-quoted HTML attribute (where escape semantics were fragile).

### Other
- `alert()` for "20-source limit" replaced with `UI.toast()` when the host is loaded, falling back to the local `showToast` if not.
- Added a `'reset'` state to `updateSourceButton()` for the failure path (was silently broken — button would stay as "⏳ Adding..." forever if the host app hadn't loaded).

## What was NOT changed (intentionally)

- **Top-level static `onclick` handlers** (masthead buttons, welcome CTA, sync button, iOS hint dismiss). These call named functions with no user-data interpolation — migrating them is pure style and introduces risk without benefit.
- **`discovery-sources.json` lazy-loading.** Out of scope; this is a real refactor, not a Pareto polish.
- **Icon cleanup.** I originally suggested "drop the PNGs OR drop the SVG" — that was wrong. The PNGs are required by the PWA spec for install, the SVG is for the browser tab. Both needed.
- **`State.loadFromCache` error logging.** Already uses `console.warn`; I initially flagged this but it's fine as-is.
- **Amplitude project key in source.** Not a secret (publishable client-side key); noted in the code comment block.

## Verification performed

- `node --check` on `sw.js`, `discovery-netflix.js`, and all three inline `<script>` blocks extracted from `morning-brief.html` — all pass.
- `python3 -c "json.load(...)"` on `manifest.json` — passes.
- Orphan-reference grep: no stale `addSource` calls in the discovery file, all functions referenced by surviving inline `onclick` handlers are defined.
- Cross-check: every `data-*` attribute emitted in rendered HTML has a matching handler in the event delegation setup, and every new CSS class has styles defined.

## Caveats (be honest)

I did not open this in a browser. The changes are structurally sound per static checks, but runtime verification is on you. Likely failure modes if anything slipped through:
- Typo in a CSS class name → unstyled-but-functional element (check the retry button and source-remove-btn look right).
- Event delegation miss → click does nothing (open devtools, check for silent failures).
- `UI.toast` called before `UI` IIFE resolves → a `TypeError`. Unlikely because `UI` is defined before `addSource`, but worth watching for on first boot.

If you hit any of these, the fix is almost certainly one-line. Flag it.

---

## Addendum: visual QA pass

After running a full visual QA in headless Chrome (15 screenshots across desktop/mobile × light/dark × all key UI states), two polish issues were found and fixed:

### Fix A: stale banner copy
The global `.error-notice` banner still said *"Sample posts are shown — live content will load once the feed becomes available"* from the old behavior where failed feeds showed fake samples. Since the new behavior is per-source retry buttons, the banner was misleading. Updated to:

> Note: One or more feeds couldn't be fetched. Use the *Retry* button on each section, or *Refresh* to try everything again.

### Fix B: loud default focus ring on confirm dialog
The confirm dialog auto-focuses the Cancel button for safety (Escape/Enter UX). On mobile, Chrome's default `:focus` outline renders as a thick orange ring that feels jarring against the cream dialog background. Added `:focus-visible` rules on `.mb-confirm-actions button` that replace the default outline with a soft `box-shadow: 0 0 0 3px var(--accent-soft)` — uses the existing design token, reads as a subtle halo rather than a loud ring.

Both fixes are CSS/copy only — no logic changes, no new risks introduced. Re-verified visually after application.

### Functional QA results
- Main jsdom harness: **46/46 pass** (welcome state, toast, confirm dialog async flow, MAX_SOURCES=20 enforcement, duplicate rejection, retry delegation, all globals defined)
- Analytics race test: **pass** (Sync.init fires at 572ms with Amplitude artificially delayed 3000ms; previously blocked full 3s)
- Discovery integration: host `addSource` is still `AsyncFunction` after discovery load (shadowing bug truly fixed), `data-add-*` attributes replace inline onclicks, no XSS-adjacent string interpolation remains
- Visual QA: 15 screenshots reviewed; all new/modified UI states render correctly in both themes and both viewports

