// ═══════════════════════════════════════════════════════════════════════
// Morning Brief — Clippings module
//
// Self-contained. Owns its own state, persistence, sync, and UI.
// Loads after the main app so window.State / window.UI / window._sbClient
// are already defined. Mirrors the discovery.js loading pattern.
//
// Storage:
//   - localStorage:  morning_brief_clippings  (JSON array)
//   - Supabase:      user_clippings table (one row per clipping)
//   - SW Cache:      clippings-inbox / clippings-pending (Web Share intake)
//
// Public API:
//   window.Clippings.open()   — open the browse modal
//   window.Clippings.close()  — close the browse modal
//   window.Clippings.count()  — number of stored clippings
//
// Tear-down: delete this file + remove the <script src="./clippings.js">
// tag + remove the masthead button and overlay div. State.* / UI.* / Sync.*
// in the main app remain untouched.
// ═══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────
  const STORAGE_KEY = 'morning_brief_clippings';
  const TABLE       = 'user_clippings';
  const INBOX_CACHE = 'clippings-inbox';
  const INBOX_KEY   = '/clippings-pending';
  const MAX_TEXT    = 2000;   // hard cap on saved passage length
  const SEARCH_DEBOUNCE_MS = 150;

  // ── Module state ──────────────────────────────────────────────────────
  let clippings = [];          // array, newest first
  let searchQuery = '';
  let realtimeChannel = null;
  let authSubscription = null;
  let isPulling = false;
  let realtimeNonce = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random();
  let hasInjectedStyles = false;
  let hasHandledShareThisLoad = false;
  let searchDebounceTimer = null;

  // ── Utilities ─────────────────────────────────────────────────────────
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function stripWWW(host) { return String(host || '').replace(/^www\./i, '').toLowerCase(); }

  function rootDomain(host) {
    // Last two segments. Good enough for English-language news sites.
    // Handles theverge.com from www.theverge.com, arstechnica.com from feeds.arstechnica.com.
    const parts = stripWWW(host).split('.');
    return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
  }

  function compactName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function toast(msg, opts) {
    if (window.UI && typeof UI.toast === 'function') UI.toast(msg, opts || {});
  }

  function confirmDialog(message, opts) {
    if (window.UI && typeof UI.confirm === 'function') return UI.confirm(message, opts || {});
    return Promise.resolve(window.confirm(message));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Match an article URL to one of the user's current sources ─────────
  function matchSource(articleUrl) {
    let host;
    try { host = new URL(articleUrl).hostname; } catch { return null; }
    if (!host) return null;
    const articleRoot = rootDomain(host);
    const sources = (window.State && State.getSources) ? State.getSources() : [];
    const meta = lookupArticleMeta(articleUrl);

    if (meta && meta.sourceId) {
      const byMetaId = sources.find(s => s.id === meta.sourceId);
      if (byMetaId) return byMetaId;
    }

    // Exact (after www-strip) first
    const exact = sources.find(s => stripWWW(s.domain) === stripWWW(host));
    if (exact) return exact;
    // Root-domain fallback (handles feeds.arstechnica.com → arstechnica.com)
    const fuzzy = sources.find(s => rootDomain(s.domain) === articleRoot);
    if (fuzzy) return fuzzy;

    const rssHost = sources.find(s => {
      if (!s.rss) return false;
      try { return rootDomain(new URL(s.rss).hostname) === articleRoot; }
      catch { return false; }
    });
    if (rssHost) return rssHost;

    const articleCompact = compactName(articleRoot);
    const nameMatch = sources.find(s => {
      const sourceCompact = compactName(s.name);
      return sourceCompact && (articleCompact.includes(sourceCompact) || sourceCompact.includes(articleCompact));
    });
    return nameMatch || null;
  }

  // ── Look up parsed RSS data for a given article URL (best-effort) ─────
  function lookupArticleMeta(articleUrl) {
    if (window.MB && typeof window.MB.lookupArticle === 'function') {
      return window.MB.lookupArticle(articleUrl) || null;
    }
    return null;
  }

  // ═════════════════════════════════════════════════════════════════════
  // LAYER: STATE + PERSIST
  // ═════════════════════════════════════════════════════════════════════

  function loadFromCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        clippings = parsed;
        sortNewestFirst();
      }
    } catch (e) {
      console.warn('[Clippings] cache parse failed, ignoring:', e);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clippings));
    } catch (e) {
      console.warn('[Clippings] persist failed:', e);
      toast("Couldn't save clipping locally — storage may be full.");
    }
  }

  function sortNewestFirst() {
    clippings.sort((a, b) => {
      const ta = new Date(a.savedAt || 0).getTime();
      const tb = new Date(b.savedAt || 0).getTime();
      return tb - ta;
    });
  }

  function getCount() { return clippings.length; }
  function getAll()   { return clippings.slice(); }

  function findById(id) { return clippings.find(c => c.id === id) || null; }

  function addLocal(clip) {
    if (!clip || !clip.id) return;
    const idx = clippings.findIndex(c => c.id === clip.id);
    if (idx === -1) clippings.unshift(clip);
    else clippings[idx] = clip;
    sortNewestFirst();
    persist();
    updateBadge();
  }

  function removeLocal(id) {
    const idx = clippings.findIndex(c => c.id === id);
    if (idx === -1) return false;
    clippings.splice(idx, 1);
    persist();
    updateBadge();
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════
  // LAYER: SYNC (Supabase)
  // Uses the same auth session as the main app via window._sbClient.
  // No-op when not signed in; the local copy remains authoritative.
  // ═════════════════════════════════════════════════════════════════════

  function db() {
    return window._sbClient || null;
  }

  function isLoggedIn() {
    return !!(window.Sync && typeof Sync.isLoggedIn === 'function' && Sync.isLoggedIn());
  }

  async function currentUser() {
    if (!db() || !db().auth || typeof db().auth.getSession !== 'function') return null;
    try {
      const { data } = await db().auth.getSession();
      return data && data.session ? data.session.user : null;
    } catch {
      return null;
    }
  }

  async function pullAll() {
    if (!db() || !isLoggedIn()) return;
    if (isPulling) return;
    isPulling = true;
    try {
      const { data, error } = await db().from(TABLE).select('*').order('saved_at', { ascending: false });
      if (error) { console.warn('[Clippings] pull failed:', error); return; }
      if (!Array.isArray(data)) return;
      const localBeforePull = clippings.slice();
      const remote = data.map(rowToClip);
      const remoteIds = new Set(remote.map(c => c.id));
      const localOnly = localBeforePull.filter(c => c && c.id && !remoteIds.has(c.id));

      clippings = remote.concat(localOnly);
      sortNewestFirst();
      persist();
      updateBadge();
      renderList();

      for (const clip of localOnly) {
        await pushInsert(clip);
      }
    } catch (e) {
      console.warn('[Clippings] pull exception:', e);
    } finally {
      isPulling = false;
    }
  }

  async function pushInsert(clip) {
    if (!db() || !isLoggedIn()) return { ok: false, pending: true };
    try {
      const user = await currentUser();
      const { error } = await db().from(TABLE).insert(clipToRow(clip, user && user.id));
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[Clippings] insert push failed:', e);
      return { ok: false, error: e };
    }
  }

  async function pushMissingLocal() {
    if (!db() || !isLoggedIn() || !clippings.length) return;
    try {
      const { data, error } = await db().from(TABLE).select('id');
      if (error) throw error;
      const remoteIds = new Set((Array.isArray(data) ? data : []).map(r => r.id));
      for (const clip of clippings) {
        if (clip && clip.id && !remoteIds.has(clip.id)) {
          await pushInsert(clip);
        }
      }
    } catch (e) {
      console.warn('[Clippings] local sync retry failed:', e);
    }
  }

  async function pushDelete(id) {
    if (!db() || !isLoggedIn()) return { ok: false, pending: true };
    try {
      const { error } = await db().from(TABLE).delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[Clippings] delete push failed:', e);
      return { ok: false, error: e };
    }
  }

  async function pushUpdate(clip) {
    if (!db() || !isLoggedIn()) return { ok: false, pending: true };
    try {
      const { error } = await db().from(TABLE).update({
        text: clip.text,
        note: clip.note || null
      }).eq('id', clip.id);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[Clippings] update push failed:', e);
      return { ok: false, error: e };
    }
  }

  function clipToRow(c, userId) {
    const row = {
      id: c.id,
      text: c.text,
      note: c.note || null,
      article_url: c.articleUrl,
      article_title: c.articleTitle || null,
      article_pub_date: c.articlePubDate || null,
      source_id: c.sourceId || null,
      source_name: c.sourceName || null,
      source_domain: c.sourceDomain || null,
      saved_at: c.savedAt
    };
    if (userId) row.user_id = userId;
    return row;
  }

  function rowToClip(r) {
    return {
      id: r.id,
      text: r.text,
      note: r.note || '',
      articleUrl: r.article_url,
      articleTitle: r.article_title || '',
      articlePubDate: r.article_pub_date || '',
      sourceId: r.source_id || null,
      sourceName: r.source_name || '',
      sourceDomain: r.source_domain || '',
      savedAt: r.saved_at
    };
  }

  async function setupRealtime() {
    if (!db() || !isLoggedIn() || realtimeChannel) return;
    try {
      const user = await currentUser();
      if (!user) return;
      realtimeChannel = db()
        .channel('clippings-changes-' + user.id)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` },
          (payload) => {
            if (payload.eventType === 'INSERT' && payload.new) {
              // Skip our own echoes by id presence
              if (!findById(payload.new.id)) addLocal(rowToClip(payload.new));
              renderList();
            } else if (payload.eventType === 'DELETE' && payload.old) {
              if (removeLocal(payload.old.id)) renderList();
            } else if (payload.eventType === 'UPDATE' && payload.new) {
              addLocal(rowToClip(payload.new));
              renderList();
            }
          })
        .subscribe();
    } catch (e) {
      console.warn('[Clippings] realtime setup failed:', e);
    }
  }

  function teardownRealtime() {
    if (!realtimeChannel || !db() || typeof db().removeChannel !== 'function') {
      realtimeChannel = null;
      return;
    }
    db().removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  function setupAuthListener() {
    if (authSubscription || !db() || !db().auth || typeof db().auth.onAuthStateChange !== 'function') return;
    try {
      const { data } = db().auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          teardownRealtime();
          setTimeout(() => pullAll().then(pushMissingLocal).then(setupRealtime), 500);
        } else if (event === 'SIGNED_OUT') {
          teardownRealtime();
        }
      });
      authSubscription = data && data.subscription ? data.subscription : true;
    } catch (e) {
      console.warn('[Clippings] auth listener setup failed:', e);
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // PUBLIC ACTIONS
  // ═════════════════════════════════════════════════════════════════════

  async function saveClipping({ text, note, articleUrl, articleTitle, source }) {
    text = String(text || '').trim();
    if (!text) { toast('Empty selection — nothing to save.'); return null; }
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    let host = '';
    try { host = new URL(articleUrl).hostname; } catch {}
    const matched = source || matchSource(articleUrl);
    const meta = lookupArticleMeta(articleUrl);

    const clip = {
      id: 'clp_' + uuid(),
      text,
      note: (note || '').trim(),
      articleUrl: articleUrl || '',
      articleTitle: (articleTitle || (meta && meta.title) || '').trim(),
      articlePubDate: (meta && meta.dateISO) || '',
      sourceId: matched ? matched.id : null,
      sourceName: matched ? matched.name : (host ? stripWWW(host) : ''),
      sourceDomain: matched ? matched.domain : (host ? stripWWW(host) : ''),
      savedAt: new Date().toISOString()
    };

    if (!db() || !isLoggedIn()) {
      toast('Sign in to save clippings across devices.');
      return null;
    }

    const res = await pushInsert(clip);
    if (!res.ok && res.pending) {
      toast('Sign in to save clippings across devices.');
      return null;
    }
    if (!res.ok && !res.pending) {
      toast("Couldn't save clipping to the cloud. Check your sign-in and Supabase setup.");
      return null;
    }
    addLocal(clip);
    renderList();
    return clip;
  }

  async function deleteClipping(id) {
    const ok = await confirmDialog('Delete this clipping?', { okText: 'Delete', cancelText: 'Keep' });
    if (!ok) return;
    removeLocal(id);
    renderList();
    await pushDelete(id);
  }

  async function updateNote(id, note) {
    const c = findById(id);
    if (!c) return;
    c.note = String(note || '').trim();
    persist();
    await pushUpdate(c);
  }

  // ═════════════════════════════════════════════════════════════════════
  // TEXT FRAGMENT URL — return-to-position
  // Constructs a #:~:text= URL that scrolls to and highlights the passage.
  // Long passages use textStart,textEnd form for tolerance to whitespace drift.
  // ═════════════════════════════════════════════════════════════════════

  function buildScrollUrl(clip) {
    if (!clip || !clip.articleUrl) return '';
    const base = String(clip.articleUrl).split('#')[0];
    const norm = String(clip.text || '').trim().replace(/\s+/g, ' ');
    if (!norm) return base;
    const words = norm.split(' ');
    let frag;
    if (words.length <= 8) {
      frag = encodeURIComponent(norm);
    } else {
      const start = words.slice(0, 5).join(' ');
      const end   = words.slice(-4).join(' ');
      frag = encodeURIComponent(start) + ',' + encodeURIComponent(end);
    }
    return base + '#:~:text=' + frag;
  }

  function openClipping(id) {
    const c = findById(id);
    if (!c) return;
    const url = buildScrollUrl(c);
    if (!url) { toast("That clipping has no article URL."); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ═════════════════════════════════════════════════════════════════════
  // WEB SHARE TARGET INTAKE
  // SW catches the POST and stashes the payload in caches.open('clippings-inbox')
  // at key '/clippings-pending'. We read it on hash change to '#clippings/share'.
  // ═════════════════════════════════════════════════════════════════════

  async function readShareInbox() {
    if (!('caches' in window)) return null;
    try {
      const cache = await caches.open(INBOX_CACHE);
      const res = await cache.match(INBOX_KEY);
      if (!res) return null;
      const payload = await res.json();
      // One-shot — consume it so a hard refresh of #clippings/share doesn't replay
      await cache.delete(INBOX_KEY);
      return payload;
    } catch (e) {
      console.warn('[Clippings] readShareInbox failed:', e);
      return null;
    }
  }

  function clearShareHash() {
    if (location.hash === '#clippings/share') {
      // Replace state to remove the hash without scrolling or pushing history.
      const clean = location.pathname + location.search;
      try { history.replaceState(null, '', clean); }
      catch { location.hash = ''; }
    }
  }

  async function handleSharedPayloadIfAny() {
    if (location.hash !== '#clippings/share') return;
    if (hasHandledShareThisLoad) return;
    hasHandledShareThisLoad = true;

    const payload = await readShareInbox();
    clearShareHash();
    if (!payload) return;

    // On Android Chrome, the shared "text" is usually the selection; "url" is the
    // page; "title" is the page title. Some apps put the URL inside "text" too —
    // strip any trailing URL from the text field so it doesn't pollute the passage.
    let text = (payload.text || '').trim();
    let url  = (payload.url  || '').trim();
    let title = (payload.title || '').trim();

    if (!url && /^https?:\/\//i.test(text)) {
      // Some share sources put only the URL in `text`.
      const urlMatch = text.match(/https?:\/\/\S+/);
      if (urlMatch) { url = urlMatch[0]; text = text.replace(urlMatch[0], '').trim(); }
    }
    // Strip a trailing URL that some apps append to selection text.
    text = text.replace(/\s*https?:\/\/\S+\s*$/, '').trim();

    if (!text && !url) return;
    openSaveSheet({ text, url, title });
  }

  // ═════════════════════════════════════════════════════════════════════
  // UI: STYLES (injected once)
  // Uses existing CSS variables from morning-brief.html, so theme + dark
  // mode + reduced motion all inherit.
  // ═════════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (hasInjectedStyles) return;
    hasInjectedStyles = true;
    const style = document.createElement('style');
    style.setAttribute('data-clippings', '');
    style.textContent = `
      .clp-search-bar {
        position: sticky; top: 0; z-index: 4;
        padding: 12px 28px;
        background: var(--paper);
        border-bottom: 1px solid var(--rule);
      }
      .clp-search-wrap { position: relative; }
      .clp-search {
        width: 100%;
        padding: 9px 14px 9px 38px;
        font-family: var(--body);
        font-size: 0.88rem;
        border: 1px solid var(--rule);
        border-radius: 8px;
        background: var(--bg);
        color: var(--ink);
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .clp-search:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      .clp-search-icon {
        position: absolute; left: 12px; top: 50%;
        transform: translateY(-50%);
        color: var(--ink-muted);
        pointer-events: none;
      }
      .clp-content { padding: 18px 28px 28px; }

      .clp-empty {
        padding: 40px 16px 30px;
        text-align: center;
        color: var(--ink-muted);
      }
      .clp-empty h3 {
        font-family: var(--display);
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--ink);
        margin-bottom: 8px;
      }
      .clp-empty p {
        font-size: 0.88rem;
        line-height: 1.6;
        margin: 6px auto;
        max-width: 460px;
      }
      .clp-empty ol {
        text-align: left;
        max-width: 380px;
        margin: 18px auto 0;
        padding-left: 22px;
        font-size: 0.85rem;
        line-height: 1.7;
        color: var(--ink-light);
      }
      .clp-empty ol strong { color: var(--ink); font-weight: 500; }

      .clp-group { margin-bottom: 30px; }
      .clp-group-header {
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding-bottom: 8px;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--rule);
      }
      .clp-group-name {
        font-family: var(--display);
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--ink);
      }
      .clp-group-count {
        font-size: 0.7rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-muted);
      }

      .clp-card {
        background: var(--paper);
        border: 1px solid var(--rule);
        border-left: 3px solid var(--accent);
        border-radius: 4px;
        padding: 16px 18px;
        margin-bottom: 12px;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
      }
      .clp-card:hover {
        background: var(--accent-soft);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }
      .clp-card:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      .clp-passage {
        font-family: var(--display);
        font-style: italic;
        font-size: 1rem;
        line-height: 1.6;
        color: var(--ink);
        margin-bottom: 10px;
      }
      .clp-note {
        font-size: 0.82rem;
        color: var(--ink-light);
        line-height: 1.5;
        margin: 6px 0 10px;
        padding: 8px 10px;
        background: var(--bg);
        border-radius: 4px;
        border-left: 2px solid var(--rule);
      }
      .clp-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        font-size: 0.72rem;
        color: var(--ink-muted);
        padding-top: 8px;
        border-top: 1px solid var(--rule);
      }
      .clp-meta-title {
        color: var(--ink-light);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }
      .clp-meta-sep { color: var(--rule); }
      .clp-actions {
        margin-left: auto;
        display: flex;
        gap: 6px;
      }
      .clp-action-btn {
        background: none;
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 0.7rem;
        color: var(--ink-muted);
        cursor: pointer;
        font-family: var(--body);
      }
      .clp-action-btn:hover {
        color: var(--accent);
        border-color: var(--accent);
      }
      .clp-action-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--accent-soft);
      }

      /* ── Save sheet ─────────────────────────────────────────── */
      .clp-save-overlay {
        position: fixed; inset: 0;
        background: rgba(26,24,20,0.6);
        backdrop-filter: blur(2px);
        z-index: 10003;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
      }
      .clp-save-overlay.visible {
        opacity: 1; pointer-events: auto;
      }
      .clp-save-box {
        background: var(--paper);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 22px;
        width: 100%;
        max-width: 480px;
        max-height: min(80dvh, 80vh);
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      }
      .clp-save-title {
        font-family: var(--display);
        font-size: 1.15rem;
        font-weight: 700;
        margin-bottom: 4px;
        color: var(--ink);
      }
      .clp-save-sub {
        font-size: 0.78rem;
        font-style: italic;
        font-family: var(--display);
        color: var(--ink-muted);
        margin-bottom: 16px;
      }
      .clp-save-source-line {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.78rem;
        color: var(--ink-light);
        margin-bottom: 14px;
        padding: 8px 10px;
        background: var(--accent-soft);
        border-radius: 4px;
      }
      .clp-save-source-line strong { color: var(--ink); font-weight: 500; }
      .clp-save-source-line .clp-source-warn { color: var(--accent); }
      .clp-save-textarea, .clp-save-note {
        width: 100%;
        font-family: var(--body);
        font-size: 0.92rem;
        color: var(--ink);
        background: var(--bg);
        border: 1px solid var(--rule);
        border-radius: 6px;
        padding: 10px 12px;
        outline: none;
        resize: vertical;
        transition: border-color 0.15s, box-shadow 0.15s;
        margin-bottom: 12px;
      }
      .clp-save-textarea:focus, .clp-save-note:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      .clp-save-textarea { min-height: 90px; font-size: 0.95rem; line-height: 1.55; }
      .clp-save-note { min-height: 50px; }
      .clp-save-counter {
        font-size: 0.72rem;
        color: var(--ink-muted);
        text-align: right;
        margin-top: -8px;
        margin-bottom: 10px;
      }
      .clp-save-counter.over { color: var(--accent); }
      .clp-save-label {
        display: block;
        font-size: 0.72rem;
        color: var(--ink-muted);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 5px;
      }
      .clp-save-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 6px;
      }
      .clp-save-actions button {
        font-family: var(--body);
        font-size: 0.88rem;
        padding: 8px 18px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid var(--rule);
        background: transparent;
        color: var(--ink);
      }
      .clp-save-actions button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      .clp-save-cancel:hover { background: var(--bg); }
      .clp-save-ok {
        background: var(--ink);
        color: var(--paper);
        border-color: var(--ink);
      }
      .clp-save-ok:hover { background: var(--accent); border-color: var(--accent); }
      .clp-save-ok:disabled { opacity: 0.5; cursor: not-allowed; }

      @media (max-width: 699px) {
        .clp-search-bar { padding: 10px 16px; }
        .clp-content { padding: 14px 16px 24px; }
        .clp-save-overlay { align-items: flex-end; padding: 0; }
        .clp-save-box {
          border-radius: 16px 16px 0 0;
          max-width: 100%;
          padding: 20px 18px;
          padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ═════════════════════════════════════════════════════════════════════
  // UI: BROWSE MODAL
  // ═════════════════════════════════════════════════════════════════════

  function open() {
    injectStyles();
    const overlay = document.getElementById('clippings-overlay');
    if (!overlay) return;
    ensureBodyShell();
    overlay.classList.add('open');
    renderList();
    // Focus search input
    setTimeout(() => {
      const input = document.getElementById('clp-search');
      if (input) input.focus();
    }, 80);
  }

  function close() {
    document.getElementById('clippings-overlay')?.classList.remove('open');
  }

  function ensureBodyShell() {
    const body = document.getElementById('clippings-body');
    if (!body) return;
    if (body.querySelector('.clp-content')) return; // already mounted
    body.innerHTML = `
      <div class="clp-search-bar">
        <div class="clp-search-wrap">
          <svg class="clp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="clp-search" class="clp-search" type="text"
                 placeholder="Search clippings…" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="clp-content" id="clp-content"></div>
    `;
    const input = document.getElementById('clp-search');
    if (input) {
      input.value = searchQuery;
      input.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        const val = e.target.value;
        searchDebounceTimer = setTimeout(() => {
          searchQuery = val.trim().toLowerCase();
          renderList();
        }, SEARCH_DEBOUNCE_MS);
      });
    }
    // Card click delegation (open, edit-note, delete)
    body.addEventListener('click', (e) => {
      const action = e.target.closest('[data-clp-action]');
      if (action) {
        e.stopPropagation();
        const id = action.getAttribute('data-id');
        const what = action.getAttribute('data-clp-action');
        if (what === 'delete') deleteClipping(id);
        else if (what === 'edit-note') promptEditNote(id);
        else if (what === 'open') openClipping(id);
        return;
      }
      const card = e.target.closest('[data-clp-id]');
      if (card) openClipping(card.getAttribute('data-clp-id'));
    });
  }

  function filteredClippings() {
    if (!searchQuery) return clippings;
    const q = searchQuery;
    return clippings.filter(c => {
      return (c.text || '').toLowerCase().includes(q)
          || (c.note || '').toLowerCase().includes(q)
          || (c.articleTitle || '').toLowerCase().includes(q)
          || (c.sourceName || '').toLowerCase().includes(q);
    });
  }

  function renderList() {
    const content = document.getElementById('clp-content');
    if (!content) return;

    const shown = filteredClippings();

    if (!clippings.length) {
      content.innerHTML = renderEmpty();
      return;
    }
    if (!shown.length) {
      content.innerHTML = `<div class="clp-empty"><h3>No matches</h3><p>Nothing in your clippings matches "${esc(searchQuery)}".</p></div>`;
      return;
    }

    // Group by source
    const groups = new Map();
    shown.forEach(c => {
      const key = c.sourceName || c.sourceDomain || 'Unknown source';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });

    content.innerHTML = Array.from(groups.entries()).map(([sourceName, clips]) => `
      <div class="clp-group">
        <div class="clp-group-header">
          <span class="clp-group-name">${esc(sourceName)}</span>
          <span class="clp-group-count">${clips.length} ${clips.length === 1 ? 'clipping' : 'clippings'}</span>
        </div>
        ${clips.map(renderCard).join('')}
      </div>
    `).join('');
  }

  function renderCard(c) {
    const pubDate = fmtDate(c.articlePubDate);
    const savedDate = fmtDate(c.savedAt);
    const dateLine = pubDate
      ? `from ${esc(pubDate)} · saved ${esc(savedDate)}`
      : `saved ${esc(savedDate)}`;
    const title = c.articleTitle ? esc(c.articleTitle) : esc(c.articleUrl);
    const note = c.note ? `<div class="clp-note">${esc(c.note)}</div>` : '';
    return `
      <div class="clp-card" data-clp-id="${esc(c.id)}" role="button" tabindex="0">
        <div class="clp-passage">"${esc(c.text)}"</div>
        ${note}
        <div class="clp-meta">
          <span class="clp-meta-title" title="${esc(c.articleTitle || c.articleUrl)}">${title}</span>
          <span class="clp-meta-sep">·</span>
          <span>${dateLine}</span>
          <span class="clp-actions">
            <button class="clp-action-btn" data-clp-action="edit-note" data-id="${esc(c.id)}" type="button">${c.note ? 'Edit note' : 'Add note'}</button>
            <button class="clp-action-btn" data-clp-action="delete" data-id="${esc(c.id)}" type="button">Delete</button>
          </span>
        </div>
      </div>
    `;
  }

  function renderEmpty() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    return `
      <div class="clp-empty">
        <h3>Nothing saved yet</h3>
        <p>Clippings collects passages worth remembering from the articles you read through Morning Brief.</p>
        ${standalone ? `
          <p>To save a clipping:</p>
          <ol>
            <li>Open any article from your brief</li>
            <li>Long-press to select text — a passage, a sentence, a phrase</li>
            <li>Tap <strong>Share</strong>, choose <strong>Morning Brief</strong></li>
            <li>Confirm in the save sheet</li>
          </ol>
          <p style="margin-top:18px;">Tap any saved clipping to return to the article at that exact passage.</p>
        ` : `
          <p style="margin-top:14px;"><strong>Install Morning Brief first.</strong> Web Share Target — the system feature that puts Morning Brief in your phone's share sheet — only works on installed PWAs.</p>
          <p style="margin-top:8px;">Use the install link in Manage Sources, or your browser's <em>Add to Home Screen</em>.</p>
        `}
      </div>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════
  // UI: SAVE SHEET (opened by share-target intake)
  // ═════════════════════════════════════════════════════════════════════

  function openSaveSheet({ text, url, title }) {
    injectStyles();
    let overlay = document.getElementById('clp-save-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'clp-save-overlay';
      overlay.className = 'clp-save-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'clp-save-title');
      overlay.innerHTML = `
        <div class="clp-save-box">
          <h3 id="clp-save-title" class="clp-save-title">Save clipping</h3>
          <p class="clp-save-sub">Trim the passage, add a note, save.</p>
          <div class="clp-save-source-line" id="clp-save-source-line"></div>
          <label class="clp-save-label" for="clp-save-text">Passage</label>
          <textarea id="clp-save-text" class="clp-save-textarea" spellcheck="false"></textarea>
          <div class="clp-save-counter" id="clp-save-counter">0 / ${MAX_TEXT}</div>
          <label class="clp-save-label" for="clp-save-note">Note (optional)</label>
          <textarea id="clp-save-note" class="clp-save-note" placeholder="Why does this matter?" spellcheck="true"></textarea>
          <div class="clp-save-actions">
            <button type="button" class="clp-save-cancel" id="clp-save-cancel">Cancel</button>
            <button type="button" class="clp-save-ok" id="clp-save-ok">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const ta    = overlay.querySelector('#clp-save-text');
    const note  = overlay.querySelector('#clp-save-note');
    const ok    = overlay.querySelector('#clp-save-ok');
    const cancel = overlay.querySelector('#clp-save-cancel');
    const counter = overlay.querySelector('#clp-save-counter');
    const srcLine = overlay.querySelector('#clp-save-source-line');

    ta.value = (text || '').slice(0, MAX_TEXT);
    note.value = '';
    updateCounter();

    // Show matched source (or warn)
    const matched = matchSource(url || '');
    const meta = lookupArticleMeta(url || '');
    const articleTitle = title || (meta && meta.title) || '';

    if (matched) {
      srcLine.innerHTML = `Saving to <strong>${esc(matched.name)}</strong>${articleTitle ? ` · ${esc(articleTitle)}` : ''}`;
    } else {
      let host = '';
      try { host = stripWWW(new URL(url || '').hostname); } catch {}
      srcLine.innerHTML = `<span class="clp-source-warn">⚠</span> Not from one of your sources${host ? ` (${esc(host)})` : ''} — still saving as a clipping.`;
    }

    function updateCounter() {
      const n = ta.value.length;
      counter.textContent = `${n} / ${MAX_TEXT}`;
      counter.classList.toggle('over', n >= MAX_TEXT);
    }
    function cleanup() {
      overlay.classList.remove('visible');
      ta.oninput = null; ok.onclick = null; cancel.onclick = null;
      overlay.onclick = null;
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') cleanup();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
    }
    async function submit() {
      const trimmed = ta.value.trim();
      if (!trimmed) { toast('Empty passage — nothing to save.'); return; }
      ok.disabled = true;
      ok.textContent = 'Saving…';
      try {
        const saved = await saveClipping({
          text: trimmed,
          note: note.value,
          articleUrl: url || '',
          articleTitle,
          source: matched || null
        });
        if (!saved) return;
        cleanup();
        toast('Clipping saved.', { duration: 2000 });
      } finally {
        ok.disabled = false;
        ok.textContent = 'Save';
      }
    }

    ta.oninput = updateCounter;
    ok.onclick = submit;
    cancel.onclick = cleanup;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
    document.addEventListener('keydown', onKey);

    overlay.classList.add('visible');
    setTimeout(() => ta.focus(), 60);
  }

  async function promptEditNote(id) {
    const c = findById(id);
    if (!c) return;
    // Tiny inline prompt — keep it simple, this isn't a frequent action
    const next = window.prompt('Note for this clipping:', c.note || '');
    if (next === null) return; // cancelled
    await updateNote(id, next);
    renderList();
  }

  // ═════════════════════════════════════════════════════════════════════
  // Masthead badge — "Clippings (12)"
  // ═════════════════════════════════════════════════════════════════════

  function updateBadge() {
    const el = document.getElementById('clippings-count-badge');
    if (!el) return;
    const n = clippings.length;
    el.textContent = n > 0 ? `(${n})` : '';
  }

  // ═════════════════════════════════════════════════════════════════════
  // INIT
  // ═════════════════════════════════════════════════════════════════════

  function init() {
    loadFromCache();
    updateBadge();
    setupAuthListener();

    // Pull from cloud if already signed in. If not, the next sign-in will pull.
    if (isLoggedIn()) {
      pullAll().then(pushMissingLocal).then(setupRealtime);
    } else {
      // Best effort: poll briefly for login (Sync.init is async on cold start)
      let tries = 0;
      const poll = setInterval(() => {
        tries++;
        if (isLoggedIn()) {
          clearInterval(poll);
          pullAll().then(pushMissingLocal).then(setupRealtime);
        } else if (tries > 20) {
          clearInterval(poll);
        }
      }, 500);
    }

    // Handle a share-target redirect on initial load
    handleSharedPayloadIfAny();
    // …and on subsequent hashchanges, in case the user re-shares
    window.addEventListener('hashchange', handleSharedPayloadIfAny);
    window.addEventListener('online', pushMissingLocal);
    window.addEventListener('focus', pushMissingLocal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.Clippings = {
    open,
    close,
    count: getCount,
    // Exposed for debugging / future inline-save flows
    _save: saveClipping
  };
})();
