# Open Loops

**A calm place for unfinished things.**

Open Loops is a local-first PWA for capturing the thoughts that occupy headspace — the half-decisions, the pending asks, the things you keep meaning to do. It gives each one a shape, surfaces only a few at a time, and gets out of the way.

![Open Loops](open-loops-icon-192.png)

---

## What it does

Most productivity tools want you to manage everything. Open Loops does one thing: it helps you stop holding things in your head.

You capture a thought. You clarify it into one of five kinds. You keep only five things in active focus. That's it.

**Five kinds of loop:**

| Kind | What it means |
|------|--------------|
| **Do** | A concrete action you can start now |
| **Decide** | A decision that needs to be named and made |
| **Ask** | Something you need from a specific person |
| **Schedule** | Something that needs time on a calendar |
| **Let go** | Something you're choosing to release |

---

## Features

- **Capture** — Drop a thought as it arrives. Shape it later, or clarify it immediately.
- **5-loop focus cap** — Only 5 active loops visible at once. The constraint is the feature.
- **Inline editing** — Click any loop title to edit it in place.
- **Primary actions** — Each loop kind has a contextual check-in: done, still in progress, or update the next step.
- **Waiting & Released** — Park things without losing them. Let go of things without deleting them.
- **Local-first** — Works entirely offline. No account required.
- **Cross-device sync** — Optional Supabase backend for sync across devices via magic link.
- **PWA** — Installable on desktop and mobile. Works like a native app.

---

## Getting started

### Run locally

```bash
python -m http.server 8000
```

Then open: [http://localhost:8000/open-loops.html](http://localhost:8000/open-loops.html)

No build step. No dependencies. One HTML file.

### Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages → Deploy from branch**.
3. Select your main branch, root folder.
4. Your app will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/open-loops.html`.

---

## Sync setup (optional)

Open Loops works fully without sync. If you want your loops on every device:

### 1. Create a Supabase project

[supabase.com](https://supabase.com) → New project.

### 2. Run the SQL

In the Supabase SQL editor, run `open-loops-supabase.sql`.

### 3. Configure the app

Edit `open-loops-config.js`:

```js
window.OL_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_KEY: 'YOUR_PUBLISHABLE_KEY',
  EMAIL_REDIRECT_TO: null, // null = uses current page URL automatically
};
```

### 4. Add redirect URLs

In Supabase → **Authentication → URL Configuration**, add:

```
http://localhost:8000/open-loops.html
https://YOUR_USERNAME.github.io/REPO_NAME/open-loops.html
```

### 5. Sign in

Open the app, tap **Sync** in the top bar, enter your email. You'll receive a magic link — no password needed.

---

## File structure

```
open-loops.html          ← The entire app (HTML + CSS + JS, single file)
open-loops-config.js     ← Supabase credentials (edit this for sync)
open-loops-supabase.sql  ← Database schema + RLS policies
open-loops-sw.js         ← Service worker (offline support)
open-loops-manifest.json ← PWA manifest
open-loops-icon-192.png  ← App icon
open-loops-icon-512.png  ← App icon (large)
open-loops-setup.md      ← Quick setup reference
index.html               ← Redirects to open-loops.html
```

---

## Design principles

- **One file.** The entire app is `open-loops.html`. No framework, no bundler, no node_modules.
- **Local-first.** Data lives in `localStorage`. Supabase is an optional layer on top.
- **Intentional constraints.** Five loops in active focus. Five kinds. Three statuses. The limits are features.
- **No noise.** No notifications, no streaks, no gamification. Calm is the aesthetic and the function.

---

## License

MIT. Use it, fork it, make it yours.
