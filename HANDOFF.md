# Handoff: Daylight redesign (work in progress)

Branch `daylight`. Nothing here is live: GitHub Pages serves `main`.
Delete `HANDOFF.md` and `daylight-wip/` before the PR merges.

## The goal

Rebuild Morning Brief's UI in the **Daylight** design, Hamza's approved redesign.

- Source of truth: the Design canvas at https://claude.ai/artifact/T9i6PShdZwVEeBYEEBTLsX
- Offline copy of every artboard: `daylight-wip/design/*.dc.html`. Each one is
  plain HTML with inline styles plus a `renderVals()` script holding the sample
  data. Read them for exact sizes, spacing, copy and SVGs.
  - `Main`: Today on a phone (light). `Night`: Today at night with two stories
    opened. `Desktop`: Today at 1440, with a three-column grid and an aside.
  - `Sources`, `Discover`, `Clippings`, `ShareClip` (the save screen the share
    sheet opens), `CaughtUp` (nothing new), `Welcome` (first run).
  - `System`: tokens, source colors, type scale, mascot states and rules.

**The three rules that drive every decision**

1. Color means a source. Only the small source tags ("pebbles") carry color.
   Cards, headlines and buttons stay cream and ink.
2. Your order decides. Nothing is ranked. Sections follow the user's source
   order, and each opens with that source's newest story.
3. Read on their site. There is no in-app reader. Every story opens on the
   publisher's page (`target="_blank"`), with a small ↗ arrow on each row.

## What exists on this branch

- `daylight-wip/part_head.html`: the full new `<head>`, with fonts (Inter and
  Newsreader), a sun favicon, the pre-paint theme script and the **complete
  Daylight stylesheet**. It covers tokens, night mode, pebbles `.peb.c0`–`.c6`,
  buttons, chips, switch, header, tab bar, Today, folded sources, the quiet
  card, empty states, the desktop aside, Sources, Discover, Clippings, the
  share screen, sheets, toast, install card and pull-to-refresh. Wide layout
  starts at `min-width: 760px`.
- `daylight-wip/part_body.html`: the new `<body>` markup. It has the shared
  header, five `.view` containers (`today`, `clippings`, `sources`,
  `discover`, `share`), the tab bar and the install/iOS cards, ending with the
  Supabase and config script tags. Sources, Discover and Share are static
  markup. Today and Clippings are rendered by JS into `#today-root` and
  `#clippings-root`. IDs that `opml.js` needs are kept: `opml-import-btn` and
  `opml-export-btn`.
- **Not written yet:** all of the JS described below.

Planned assembly of the new `morning-brief.html`: `part_head` + `part_body` +
`<script>` with these pieces of the **current** file, kept as they are except
for the edits noted:

| Current lines (on main) | Keep | Edits |
|---|---|---|
| 2339–2884: utilities, State, Persist, Sync, Analytics | yes | see "State changes" and "Sync change" |
| 3682–3789: vouchers | logic yes | restyle `promptVoucher` as a sheet |
| 3885–3929: `importSources` + `window.MB.sources` bridge | yes | — |
| 4100–4187: install prompt | yes | new ids are already in `part_body` |
| 4318–4390: pull-to-refresh | yes | label copy |
| 4392–4442: service worker + update prompt | yes | restyle the update prompt as `.float-card.mb-update` |
| 4530–4558: RLS self-check | yes | — |

Everything else in the UI layer gets rewritten: masthead, pills, sections,
modals, focus trap, event delegation and init. Then add these tags, with
`defer` as now: `discovery.js`, `clippings.js`, `opml.js`.

## Decisions already made (do not re-ask)

- **What counts as "new"**: new since the user last had the app open, per
  device. It never counts down as they read. Opened stories just turn grey with
  "✓ Opened ·". Build it as a `Brief` module with localStorage only, no DB:
  - `morning_brief_brief` = `{startedAt, since, lastSeen}`. On load, if
    `now - lastSeen < CFG.SESSION_IDLE_MS` (30 min) continue the brief.
    Otherwise start a new one with `since = lastSeen`. On the very first run,
    fall back to `CFG.LAST_SESSION_KEY` for `since`, and read it before
    `trackSession()` overwrites it. Update `lastSeen` on a 60-second heartbeat
    while visible, on `visibilitychange` to hidden and on `pagehide`. If the gap
    is more than 30 minutes (the tab was hidden or the device slept), roll over
    to a new brief and refetch.
  - `morning_brief_seen` = `{ [sourceId]: { [hash]: firstSeenTs } }`. The hash
    is FNV-1a of the item key: `guid` (RSS) or `id` (Atom), else link + "|" +
    title. **New = firstSeen ≥ brief.startedAt.** Compute it at render time,
    not at fetch time, so a rollover works before the refetch lands. Keep at
    most 60 entries per source.
  - First sight of a source (no ledger entry yet):
    - Just added in this session, or `since` unknown: its latest 3 items are
      new and the rest are old (`firstSeen = 0`).
    - Otherwise, such as an existing user after this update or sources pulled
      onto a new device: an item is new if its pubDate is after `since`. If the
      item has no date, fall back to the latest 3.
  - `morning_brief_opened` = `{ [hash]: ts }`, capped at about 800. Mark an
    item opened on click and middle-click of `a.story`. Update its class in
    place and don't re-render.
- **Today on a phone**: the hero shows the date eyebrow ("Wednesday · 21
  October"), the serif H1 "23 new stories", the rising sun, and the line "From
  your 9 sources since yesterday at 7:40. Your order, nothing ranked." Below it:
  - A horizontal row of source chips that jump to a section, with a pebble,
    short name and count.
  - The **first 3 sources with new stories open in full**: lead story with a
    3-line excerpt, one more headline, then "N more from X" to expand. The rest
    fold into one card ("6 more sources · 16 stories"), with one-line rows that
    expand in place (`aria-expanded`).
  - A quiet card lists sources with nothing new, ones that failed (with Retry)
    and ones still loading.
  - The end mark: risen sun, "That's everything since yesterday.", "Pull down
    to check for new stories." and a **"See earlier stories"** toggle.
    Earlier mode shows every fetched item, not only new ones, and resets on a
    new brief.
- **Today on desktop (760px and up)**: a grid with all sections, nothing folded:
  `repeat(auto-fit, minmax(min(260px,100%),1fr))`. The aside has "Jump to a
  source" (all visible sources with counts, plus "Browse 1,250 sources") and
  "Latest clippings" (2 items, "All N", and the clipping tip). The aside wraps
  under the main column below about 1100px.
- **Nothing new** (all loaded, 0 new, not earlier mode): the `CaughtUp`
  artboard. "Nothing new since 7:40.", with the buttons "See earlier stories"
  and "Open clippings", and "Last checked 1 minute ago".
  - Every source failed: "Couldn't reach your sources." with Try again.
  - No sources at all: the `Welcome` artboard with the asleep sun, and no tab
    bar. Add a "Already use Morning Brief? Sign in" link, because a new device
    needs a way to pull its sources.
  - Every source switched off: a small empty state that links to Sources.
- **Avoid replaying animations**: build the Today shell once per mode+layout
  (store the key on `root.dataset.key`), then only update text and inner lists.
  Otherwise the sun's `.rise` animation replays every time a feed arrives.
  Re-render progressively as feeds arrive, throttled with rAF. Keep expanded
  state in Sets and restore focus by element id after a re-render.
- **Sources screen**: rows have a drag handle (also arrow-key reorder when
  focused), a pebble, the name and domain as one button (opens a source sheet),
  and a **switch to show or hide the source in Today**.
  - Hiding uses a new `hidden: true` flag on the source object. It syncs inside
    the existing config JSON with no schema change, and hidden sources still
    count toward the limit.
  - **Removing** lives in the source sheet, which also has rename (`Name`
    field), the feed address and "Open website".
  - Below the list: OPML import/export, then "Need more than 20 sources? Redeem
    a code".
- **Adding a source by any web address**: the proxy passes HTML through
  (checked: `?url=https://www.ben-evans.com` returns the page with
  `content-type: application/xml`). Find the feed like this:
  1. Fetch through the proxy. If the response parses as RSS or Atom, use it.
  2. Otherwise parse the HTML and look for `link[rel~=alternate]` with an RSS
     or Atom type, resolving relative URLs.
  3. Otherwise try `/feed`, `/rss`, `/feed.xml`, `/rss.xml`, `/atom.xml`,
     `/index.xml`, `?format=rss` (Squarespace; ben-evans.com has no alternate
     link) and `/feed/`.
  4. Take the name from the feed title. If nothing is found: "Couldn't find a
     feed on that page."
- **Discover**:
  - Back button, title and an "N of 20" pill, then search.
  - Topic chips: "All topics" plus the first 6, with topics that contain the
    user's sources first, then "61 more". Shorten labels: drop parentheticals,
    "Artificial Intelligence" → "AI", and cut at " & " when the result is over
    24 characters and the first part is at least 8 characters.
  - "All topics" shows the starter pack (zero sources only), bundles, then a
    list of topics that each open that topic.
  - A topic view has a serif title, "19 sources · 1 already in your brief", and
    rows with a pebble (neutral until added), name, domain and Add/Added/Full.
    Full opens the voucher sheet.
  - Sticky bar at the bottom: "9 of 20 sources / A color is picked when you add
    one" with Done. Done goes back.
- **Clippings**:
  - Title "Clippings" with "38 passages from 11 sources", and a tip box. The
    tip depends on the platform:
    - iPhone: say plainly that the share sheet doesn't offer web apps there
      yet.
    - Android and not installed: "Install first".
    - Otherwise: "Select text, tap Share, choose Morning Brief".
  - Filter chips: "All N", "With notes N" and a Source `<select>` styled as a
    chip.
  - A search field toggled by the header search button on phones, always shown
    on desktop.
  - Groups: Today, Yesterday, Earlier this week, then by month.
  - Cards have a pebble, the source and time, an italic serif passage, a "Your
    note" box, and a footer with the article title and "Open passage ↗".
  - A ⋯ button opens a sheet with Add/Edit note (a textarea sheet, replacing
    `window.prompt`), Copy passage and Delete.
- **Save clipping** (Web Share Target lands on `#clippings/share`): use the
  full-screen `view-share` from `part_body`.
  - A match card shows the source and title, with "✓ Matched to a source in
    your brief" or "Not from one of your sources".
  - The passage is a serif italic textarea. Show the counter only near the
    2,000-character limit.
  - Buttons: "Save and go back to the article" (the text-fragment URL, as now)
    and "Save and open Clippings".
  - When signed out, show the `#share-signin` banner. Saving needs an account,
    as now.
- **Account sheet** (avatar button in the header): the avatar shows the email's
  initial, with a status dot for synced, syncing or error. The sheet holds:
  - Magic-link sign-in, or the signed-in email, status and Sign out.
  - Appearance: an Auto / Day / Night segmented control. Keep
    `morning_brief_theme` values `auto`, `light` and `dark`.
  - Install app and a Privacy link.
- **Routing**: hash routes `#/`, `#/clippings`, `#/sources` and `#/discover`.
  Intercept `a[href^="#/"]` and use `history.pushState({mb:1})` plus a manual
  show. On `popstate`, show the parsed view. Back (Discover, share) calls
  `history.back()` only when `history.state?.mb`, otherwise it navigates to the
  fallback. Ignore non-route hashes: `#access_token=…` from Supabase, and
  `#clippings/share`, which `clippings.js` handles. Jump chips call
  `scrollIntoView` and must not touch the hash. On phones, hide the shared
  header on `discover` and `share`, and hide the tab bar there and on Welcome
  (`body.has-tabbar`).
- **Source colors**: the palette index is `colorIndex % 7`, in the order teal,
  ochre, pink, lav, peach, moss, cobalt, which maps to `.peb.c0`–`.c6`. Colors
  switch for night mode in CSS, so `recolorAll` becomes a no-op.
  - Replace `pickColor` and the HSL wheel.
  - Make `State.nextColorIndex()` pick an unused index whose color is the least
    used and not the same as the last source's color.
  - Pebble letter: the first letter or digit, skipping a leading "The ".
  - Short chip name: drop "The ", parentheticals and trailing
    Newsletter/Magazine/Review/Blog/News/Weekly/Daily/Digest; cap at about 14
    characters.
- **Not doing**: an in-app reader, ranking, syncing opened or new state across
  devices, and an iOS "Paste a passage" button. That last one was offered and
  not answered, so only mention it.

## State changes (in the kept slice)

- `colorFor(source)` → returns the palette class index, as described above.
- Add `setHidden(id, bool)` and `rename(id, name)`. Both go through Persist,
  then `Sync.pushAfterChange()`.
- `config.js`: `ARTICLES_PER_SOURCE` 5 → 10. Raise the article cache cap 200 →
  400 and the excerpt length 180 → about 220.
- `parseItem`: add `key` (guid/id), `h` (hash) and `readMin`. `readMin` is
  `round(words/230)`, and only when the body has 150 words or more. Show stories
  as "9 min · 1 hour ago" plus the arrow.

## Bugs found in the current code (fix them as part of this)

1. **`const State/UI/Sync` aren't on `window`.** `clippings.js` checks
   `window.UI`, `window.State` and `window.Sync`, which are always undefined. So
   every toast from clippings silently never shows. A signed-out user who taps
   Save sees nothing happen. Source matching also always gets `[]`. Fix: after
   the declarations, add `window.State = State; window.UI = UI; window.Sync =
   Sync;`.
2. **Magic link redirect**: `emailRedirectTo: window.location.href` would carry
   a `#/sources` hash into the Supabase redirect. Use `location.origin +
   location.pathname`.
3. `clippings.js` `rememberOutboundArticleClick` targets `a.article-featured,
   a.article-item`. Change it to `a.story` / `.story-title`.

## Module rewrites

- `discovery.js`: keep `loadCatalog`, `filterCatalog` and `bulkAdd`. Rewrite
  rendering into `#discover-content` as described above. Keep `window.Discover =
  {open, close, refresh}`.
- `clippings.js`: keep the whole data and sync layer, the text-fragment URL
  builder and the share-inbox intake. Delete `injectStyles`, because the styles
  now live in the main CSS. `open()` and `close()` should route. Add
  `render()`, `latest(n)` and `count()`. Dispatch `mb:clippings-changed` so the
  desktop aside can refresh. The save sheet becomes `view-share`.
- `opml.js`: unchanged.
- `sw.js`: cache `morning-brief-v27` → `v28`.
- `manifest.json`: `background_color` and `theme_color` → `#fffaf0`.
- Icons: regenerate `icon-192.png` and `icon-512.png` as the sun mark (from the
  header SVG in `part_body`) on cream, with a maskable safe zone. Chromium in
  Playwright can rasterize the filtered SVG. The landing page `index.html` also
  uses `icon-192.png` as its logo.
- `CHANGELOG.md`: add a v28 "Daylight" entry. Update the description lines in
  `README.md`.

## Testing (before the PR)

- Serve the repo with `python3 -m http.server 8000`.
- Use Playwright with the full Chromium channel. Stub
  `morning-brief-proxy…workers.dev` with fixture RSS feeds, and stub Supabase:
  intercept the jsdelivr script and strip any `integrity` attributes. This is
  the same approach the Open Loops QA used.
- Check: first run, adding from Discover, adding a plain URL (feed discovery),
  new versus earlier stories, opened state after reload, rollover after 30
  minutes idle (fake `Date`), hiding and removing a source, reordering, OPML
  round trip, the share flow (`#clippings/share` with a cached payload) and
  vouchers.
- Take screenshots at 390×844 and 1440×900, in light and night.
- Contrast: text at 4.5:1 or better. The design already darkened caption grey
  to `#6f6a5f`.
- No Supabase schema change is needed. If one ever is, note that from 30 Oct
  2026, new tables in `public` need explicit grants in the same migration.

## Shipping

- Commit with `-c user.name="Muhammad Hamza Saleem" -c
  user.email="hamzasaleem021@gmail.com"`.
- Open the PR with `gh api repos/hamzasaleem021/morning-brief/pulls`.
- **Ask Hamza before merging.** Merging changes the live app at
  morningbrief.auxila.cc for its roughly 10 users.
- After merging, also mention that the landing page (`index.html`) and the
  Resend sign-in emails still use the old newspaper look.
