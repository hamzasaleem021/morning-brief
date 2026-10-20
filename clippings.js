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
//   window.Clippings.open()     — go to the Clippings view (#/clippings)
//   window.Clippings.close()    — go back
//   window.Clippings.render()   — render into #clippings-root
//   window.Clippings.count()    — number of stored clippings
//   window.Clippings.latest(n)  — the n newest clippings (desktop aside)
//
// Fires 'mb:clippings-changed' on document whenever the list changes.
//
// Tear-down: delete this file + remove the <script src="./clippings.js">
// tag + the Clippings view, tab and share view. State.* / UI.* / Sync.*
// in the main app remain untouched.
// ═══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────
  const STORAGE_KEY = 'morning_brief_clippings';
  const TABLE       = 'user_clippings';
  const INBOX_CACHE = 'clippings-inbox';
  const INBOX_KEY   = '/clippings-pending';
  const LAST_ARTICLE_KEY = 'morning_brief_last_article_context';
  const LAST_ARTICLE_TTL_MS = 6 * 60 * 60 * 1000;
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
  let shareBusy = false;           // the inbox is one-shot; this only stops overlap
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

  function normalizeClipId(id) {
    const s = String(id || '');
    return s.startsWith('clp_') ? s.slice(4) : s;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function stripWWW(host) { return String(host || '').replace(/^www\./i, '').toLowerCase(); }

  function comparableUrl(url) {
    try {
      const u = new URL(url, location.href);
      u.hash = '';
      return u.href;
    } catch {
      return String(url || '').split('#')[0];
    }
  }

  function sameArticleUrl(a, b) {
    return comparableUrl(a) === comparableUrl(b);
  }

  function cleanSharedUrl(url) {
    return String(url || '').trim().replace(/[)\].,;!?]+$/g, '');
  }

  function extractSharedUrl(text) {
    let nextText = String(text || '').trim();
    let url = '';

    const trailing = nextText.match(/(?:^|\s)(https?:\/\/\S+)\s*$/i);
    if (trailing) {
      url = cleanSharedUrl(trailing[1]);
      nextText = nextText.slice(0, trailing.index).trim();
      return { text: nextText, url };
    }

    const leading = nextText.match(/^\s*(https?:\/\/\S+)(?:\s+|$)/i);
    if (leading) {
      url = cleanSharedUrl(leading[1]);
      nextText = nextText.slice(leading[0].length).trim();
    }

    return { text: nextText, url };
  }

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

  function describeDbError(e) {
    if (!e) return '';
    const parts = [e.code, e.message || e.details || e.hint].filter(Boolean);
    return parts.join(': ').slice(0, 220);
  }

  // The technical reason goes to the console; people get plain words.
  function toastCloudError(e) {
    console.warn('[Clippings] save failed:', describeDbError(e) || e);
    toast(navigator.onLine
      ? "Couldn't save this clipping. Try again in a minute."
      : "Couldn't save this clipping. Check your internet connection and try again.");
  }

  function looksLikeUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || ''));
  }

  function sourceIdAsUuid(sourceId) {
    const raw = String(sourceId || '');
    const stripped = raw.startsWith('src_') ? raw.slice(4) : raw;
    return looksLikeUuid(stripped) ? stripped : raw;
  }

  function shouldRetrySourceId(error) {
    const msg = [
      error && error.code,
      error && error.message,
      error && error.details,
      error && error.hint
    ].filter(Boolean).join(' ').toLowerCase();
    return msg.includes('source_id')
      || msg.includes('invalid input syntax for type uuid')
      || (msg.includes('schema cache') && msg.includes('column'));
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
      const live = window.MB.lookupArticle(articleUrl);
      if (live) return live;
    }
    return readRecentArticleContext(articleUrl);
  }

  function readRecentArticleContext(articleUrl) {
    try {
      const raw = localStorage.getItem(LAST_ARTICLE_KEY);
      if (!raw) return null;
      const ctx = JSON.parse(raw);
      if (!ctx || !ctx.url || !ctx.at) return null;
      if (Date.now() - ctx.at > LAST_ARTICLE_TTL_MS) return null;
      if (articleUrl && !sameArticleUrl(ctx.url, articleUrl)) return null;
      return ctx;
    } catch {
      return null;
    }
  }

  function rememberArticleContext(url, fallbackTitle) {
    if (!url) return;
    const meta = lookupArticleMeta(url) || {};
    const matched = matchSource(url);
    const ctx = {
      url: comparableUrl(url),
      title: (meta.title || fallbackTitle || '').trim(),
      dateISO: meta.dateISO || '',
      sourceId: (matched && matched.id) || meta.sourceId || null,
      sourceName: (matched && matched.name) || meta.sourceName || '',
      sourceDomain: (matched && matched.domain) || meta.sourceDomain || '',
      at: Date.now()
    };
    try { localStorage.setItem(LAST_ARTICLE_KEY, JSON.stringify(ctx)); } catch {}
  }

  function rememberOutboundArticleClick(e) {
    const link = e.target && e.target.closest
      ? e.target.closest('a.story')
      : null;
    if (!link) return;
    const url = link.href || link.getAttribute('href') || '';
    const titleEl = link.querySelector('.story-title');
    const title = titleEl ? titleEl.textContent : link.textContent;
    rememberArticleContext(url, title);
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
        let changed = false;
        clippings = parsed.map(c => {
          if (c && typeof c.id === 'string' && c.id.startsWith('clp_')) {
            changed = true;
            return { ...c, id: normalizeClipId(c.id) };
          }
          return c;
        });
        sortNewestFirst();
        if (changed) persist();
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
      toast("This device is out of space, so the clipping wasn't kept here.");
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
    if (!db()) return;
    if (isPulling) return;
    isPulling = true;
    try {
      const user = await currentUser();
      if (!user) return;
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

  async function pushInsert(clip, user) {
    if (!db()) return { ok: false, pending: true };
    try {
      const authUser = user || await currentUser();
      if (!authUser) return { ok: false, pending: true };
      const row = clipToRow(clip, authUser.id);
      let { error } = await db().from(TABLE).insert(row);
      if (error && row.source_id && shouldRetrySourceId(error)) {
        const retryRow = { ...row, source_id: sourceIdAsUuid(row.source_id) };
        if (retryRow.source_id !== row.source_id) {
          const retry = await db().from(TABLE).insert(retryRow);
          if (!retry.error) return { ok: true };
          error = retry.error;
        }
      }
      if (error && row.source_id && shouldRetrySourceId(error)) {
        const fallbackRow = { ...row };
        delete fallbackRow.source_id;
        const fallback = await db().from(TABLE).insert(fallbackRow);
        if (!fallback.error) return { ok: true };
        error = fallback.error;
      }
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[Clippings] insert push failed:', e);
      return { ok: false, error: e };
    }
  }

  async function pushMissingLocal() {
    if (!db() || !clippings.length) return;
    try {
      const user = await currentUser();
      if (!user) return;
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
    if (!db()) return { ok: false, pending: true };
    try {
      const user = await currentUser();
      if (!user) return { ok: false, pending: true };
      const { error } = await db().from(TABLE).delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[Clippings] delete push failed:', e);
      return { ok: false, error: e };
    }
  }

  async function pushUpdate(clip) {
    if (!db()) return { ok: false, pending: true };
    try {
      const user = await currentUser();
      if (!user) return { ok: false, pending: true };
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
      id: normalizeClipId(c.id),
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
    if (!db() || realtimeChannel) return;
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
    if (!text) { toast('There\'s no text to save.'); return null; }
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    let host = '';
    try { host = new URL(articleUrl).hostname; } catch {}
    const matched = source || matchSource(articleUrl);
    const meta = lookupArticleMeta(articleUrl);

    const clip = {
      id: uuid(),
      text,
      note: (note || '').trim(),
      articleUrl: articleUrl || '',
      articleTitle: (articleTitle || (meta && meta.title) || '').trim(),
      articlePubDate: (meta && meta.dateISO) || '',
      sourceId: matched ? matched.id : ((meta && meta.sourceId) || null),
      sourceName: matched ? matched.name : ((meta && meta.sourceName) || (host ? stripWWW(host) : '')),
      sourceDomain: matched ? matched.domain : ((meta && meta.sourceDomain) || (host ? stripWWW(host) : '')),
      savedAt: new Date().toISOString()
    };

    if (!db()) {
      toast('Sign in to keep clippings.');
      return null;
    }

    const user = await currentUser();
    if (!user) {
      toast('Sign in to keep clippings.');
      return null;
    }

    const res = await pushInsert(clip, user);
    if (!res.ok && res.pending) {
      toast('Sign in to keep clippings.');
      return null;
    }
    if (!res.ok && !res.pending) {
      toastCloudError(res.error);
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
    if (!url) { toast("This clipping doesn't have a link to its article."); return; }
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
    if (shareBusy) return;
    shareBusy = true;
    let payload;
    try { payload = await readShareInbox(); }
    finally { shareBusy = false; }
    clearShareHash();
    if (!payload) return;

    // On Android Chrome, the shared "text" is usually the selection; "url" is the
    // page; "title" is the page title. Some apps put the URL inside "text" too —
    // strip any trailing URL from the text field so it doesn't pollute the passage.
    let text = (payload.text || '').trim();
    let url  = (payload.url  || '').trim();
    let title = (payload.title || '').trim();

    // Strip a link riding along in the text either way; use it as the
    // article URL only when the share didn't send one.
    const fromText = extractSharedUrl(text);
    if (fromText.url) {
      if (!url) url = fromText.url;
      text = fromText.text;
    }

    const recent = readRecentArticleContext(url || '');
    if (!url && recent) url = recent.url;
    if (!title && recent && (!url || sameArticleUrl(recent.url, url))) title = recent.title || '';

    if (!text && !url) return;
    openShareView({ text, url, title });
  }

  // ═════════════════════════════════════════════════════════════════════
  // UI: CLIPPINGS VIEW (#clippings-root)
  // Styles live in the main stylesheet. The view is built once, then only
  // the summary, filters and groups re-render.
  // ═════════════════════════════════════════════════════════════════════

  const ICON = {
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    ext: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--ok)"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let filter = 'all';      // 'all' | 'notes'
  let sourceFilter = '';   // a source name, '' = every source
  let searchOpen = false;
  let notifyQueued = false;

  function isActive() {
    const v = document.getElementById('view-clippings');
    return !!(v && v.classList.contains('active'));
  }

  // Tell the rest of the app (the desktop aside) that clippings changed.
  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      document.dispatchEvent(new CustomEvent('mb:clippings-changed'));
    });
  }
  const updateBadge = notify;

  function renderList() {
    notify();
    if (isActive()) render();
  }

  function open() {
    if (window.MB && window.MB.navigate) window.MB.navigate('#/clippings');
  }

  function close() {
    if (window.MB && window.MB.back) window.MB.back('#/');
  }

  function dayDiff(ts) {
    const a = new Date(), b = new Date(ts);
    const sa = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const sb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((sa - sb) / 864e5);
  }

  function clock(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }

  function groupLabel(ts) {
    const dd = dayDiff(ts);
    if (dd <= 0) return 'Today';
    if (dd === 1) return 'Yesterday';
    if (dd < 7) return 'Earlier this week';
    const d = new Date(ts);
    return d.getFullYear() === new Date().getFullYear()
      ? MONTH_NAMES[d.getMonth()]
      : `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }

  function whenLabel(ts) {
    const d = new Date(ts);
    const dd = dayDiff(ts);
    if (dd <= 1) return clock(d);
    if (dd < 7) return DAY_NAMES[d.getDay()];
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
  }

  function sourceFor(c) {
    if (!window.State || typeof State.getSources !== 'function') return null;
    const list = State.getSources();
    return (c.sourceId && list.find(s => s.id === c.sourceId))
      || (c.sourceDomain && list.find(s => stripWWW(s.domain) === stripWWW(c.sourceDomain)))
      || null;
  }

  function neutralPeb(name, size) {
    const m = String(name || '').trim().replace(/^the\s+/i, '').match(/[\p{L}\p{N}]/u);
    return `<span class="peb ${size || ''} neutral" aria-hidden="true">${esc(m ? m[0].toUpperCase() : '•')}</span>`;
  }

  function pebFor(c, size) {
    const src = sourceFor(c);
    if (src && window.MB && typeof window.MB.peb === 'function') return window.MB.peb(src, size);
    return neutralPeb(c.sourceName || c.sourceDomain, size);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function tipHTML() {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) {
      return "On iPhone and iPad the share sheet doesn't offer web apps yet, so passages can't be sent to Morning Brief from there for now.";
    }
    if (/android/i.test(ua) && !isStandalone()) {
      return '<strong>Install first.</strong> Once Morning Brief is on your home screen it shows up in your share sheet. Then select text in any article, tap Share and choose Morning Brief.';
    }
    return 'To clip, select text in any article, tap Share, then choose Morning Brief.';
  }

  function ensureShell() {
    const root = document.getElementById('clippings-root');
    if (!root) return null;
    if (root.dataset.ready) return root;
    root.dataset.ready = '1';
    root.innerHTML = `
      <section class="page-title">
        <div>
          <span class="eyebrow">Kept</span>
          <h1>Clippings</h1>
          <span class="sub tnum" id="clp-summary"></span>
        </div>
      </section>
      <div class="tip">${ICON.share}<p id="clp-tip"></p></div>
      <div class="clip-filters" role="group" aria-label="Filter clippings" id="clp-filters"></div>
      <div class="clip-search collapsed" id="clp-search-row">
        <div class="search-wrap">
          <label for="clp-search" class="sr-only">Search clippings</label>
          ${ICON.search}
          <input id="clp-search" class="field" type="search" placeholder="Search clippings" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="clip-groups" id="clp-groups"></div>`;

    const input = root.querySelector('#clp-search');
    input.value = searchQuery;
    input.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      const val = e.target.value;
      searchDebounceTimer = setTimeout(() => {
        searchQuery = val.trim().toLowerCase();
        renderGroups();
      }, SEARCH_DEBOUNCE_MS);
    });

    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-clp-filter]');
      if (f) { filter = f.dataset.clpFilter; render(); return; }
      const menu = e.target.closest('[data-clp-menu]');
      if (menu) { openMenu(menu.dataset.clpMenu); return; }
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'clp-source') { sourceFilter = e.target.value; render(); }
    });
    return root;
  }

  function filteredClippings() {
    const q = searchQuery;
    return clippings.filter(c => {
      if (filter === 'notes' && !c.note) return false;
      if (sourceFilter && (c.sourceName || c.sourceDomain || '') !== sourceFilter) return false;
      if (!q) return true;
      return (c.text || '').toLowerCase().includes(q)
          || (c.note || '').toLowerCase().includes(q)
          || (c.articleTitle || '').toLowerCase().includes(q)
          || (c.sourceName || '').toLowerCase().includes(q);
    });
  }

  function sourceNames() {
    return Array.from(new Set(clippings.map(c => c.sourceName || c.sourceDomain || '').filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
  }

  function renderFilters() {
    const el = document.getElementById('clp-filters');
    if (!el) return;
    const names = sourceNames();
    if (sourceFilter && !names.includes(sourceFilter)) sourceFilter = '';
    const notes = clippings.filter(c => c.note).length;
    const hadFocus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
    el.innerHTML = `
      <button type="button" class="chip tnum" id="clp-f-all" data-clp-filter="all" aria-pressed="${filter === 'all'}">All ${clippings.length}</button>
      <button type="button" class="chip tnum" id="clp-f-notes" data-clp-filter="notes" aria-pressed="${filter === 'notes'}">With notes ${notes}</button>
      ${names.length > 1 ? `
        <label for="clp-source" class="sr-only">Source</label>
        <select id="clp-source" class="chip chip-select">
          <option value="">Source</option>
          ${names.map(n => `<option value="${esc(n)}"${n === sourceFilter ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>` : ''}`;
    if (hadFocus) document.getElementById(hadFocus)?.focus({ preventScroll: true });
  }

  function renderCard(c) {
    const saved = new Date(c.savedAt || 0).getTime();
    const url = buildScrollUrl(c);
    const title = c.articleTitle || c.articleUrl || '';
    return `
      <article class="card clip">
        <div class="clip-top">
          ${pebFor(c, 'md')}
          <span class="who">${esc(c.sourceName || c.sourceDomain || 'Unknown source')}</span>
          <span class="when tnum">${esc(whenLabel(saved))}</span>
          <button type="button" class="icon-btn" id="clp-m-${esc(c.id)}" data-clp-menu="${esc(c.id)}" aria-label="More for this clipping">${ICON.more}</button>
        </div>
        <blockquote>${esc(c.text)}</blockquote>
        ${c.note ? `<div class="clip-note"><span class="k">Your note</span><span class="v">${esc(c.note)}</span></div>` : ''}
        ${url ? `
          <a class="clip-foot" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
            <span class="title">${esc(title)}</span>
            <span class="go">Open passage ${ICON.ext}</span>
          </a>` : ''}
      </article>`;
  }

  function renderEmpty() {
    const signedIn = isLoggedIn();
    return `
      <div class="clip-empty">
        <h2>Nothing kept yet</h2>
        <p>When a sentence is worth keeping, select it in the article and share it to Morning Brief. It lands here with a link back to that exact spot.</p>
        ${signedIn ? '' : `<p>Clippings are saved to your account, so <button type="button" class="link-btn" data-open-account>sign in</button> first.</p>`}
      </div>`;
  }

  function renderGroups() {
    const el = document.getElementById('clp-groups');
    if (!el) return;
    const hadFocus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
    if (!clippings.length) { el.innerHTML = renderEmpty(); return; }
    const shown = filteredClippings();
    if (!shown.length) {
      el.innerHTML = `<div class="clip-empty"><h2>No matches</h2><p>None of your clippings match that. Try another word or filter.</p></div>`;
      return;
    }
    const groups = [];
    shown.forEach(c => {
      const label = groupLabel(new Date(c.savedAt || 0).getTime());
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) { g = { label, items: [] }; groups.push(g); }
      g.items.push(c);
    });
    el.innerHTML = groups.map(g => `
      <h2 class="eyebrow">${esc(g.label)}</h2>
      ${g.items.map(renderCard).join('')}`).join('');
    if (hadFocus) document.getElementById(hadFocus)?.focus({ preventScroll: true });
  }

  function render() {
    const root = ensureShell();
    if (!root) return;
    const n = clippings.length;
    const sources = sourceNames().length;
    document.getElementById('clp-summary').textContent = n
      ? `${n} ${n === 1 ? 'passage' : 'passages'} from ${sources} ${sources === 1 ? 'source' : 'sources'}`
      : 'Passages you keep from what you read';
    document.getElementById('clp-tip').innerHTML = tipHTML();
    document.getElementById('clp-search-row').classList.toggle('collapsed', !searchOpen);
    document.getElementById('clip-search-btn')?.setAttribute('aria-expanded', String(searchOpen));
    renderFilters();
    renderGroups();
  }

  function toggleSearch() {
    searchOpen = !searchOpen;
    render();
    if (searchOpen) document.getElementById('clp-search')?.focus();
    else if (searchQuery) {
      searchQuery = '';
      const input = document.getElementById('clp-search');
      if (input) input.value = '';
      renderGroups();
    }
  }

  // ── ⋯ menu and the note sheet ───────────────────────────────────────
  function sheet(html, opts) {
    return (window.MB && typeof window.MB.sheet === 'function') ? window.MB.sheet(html, opts) : null;
  }

  function openMenu(id) {
    const c = findById(id);
    if (!c) return;
    const url = buildScrollUrl(c);
    const s = sheet(`
      <p class="lede clip-lede">“${esc(c.text.length > 160 ? c.text.slice(0, 160).trim() + '…' : c.text)}”</p>
      <div class="menu-list" style="margin-top: 12px">
        <button type="button" data-m="note">${c.note ? 'Edit note' : 'Add a note'}</button>
        <button type="button" data-m="copy">Copy passage</button>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open passage ${ICON.ext}</a>` : ''}
        <button type="button" class="danger" data-m="delete">Delete clipping</button>
      </div>`, { title: c.sourceName || 'Clipping' });
    if (!s) return;
    s.sheet.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const what = b.dataset.m;
      s.close();
      if (what === 'note') setTimeout(() => promptEditNote(id), 60);
      else if (what === 'copy') {
        try { await navigator.clipboard.writeText(c.text); toast('Passage copied.'); }
        catch { toast("Couldn't copy. Select the text and copy it instead."); }
      } else if (what === 'delete') {
        setTimeout(() => deleteClipping(id), 60);
      }
    });
  }

  async function promptEditNote(id) {
    const c = findById(id);
    if (!c) return;
    const s = sheet(`
      <div class="body">
        <label class="label" for="clp-note-input">Note</label>
        <textarea id="clp-note-input" class="field" rows="4" maxlength="1000" placeholder="Why you kept this" data-autofocus>${esc(c.note || '')}</textarea>
      </div>
      <div class="actions row">
        <button type="button" class="btn primary" data-save>Save note</button>
        <button type="button" class="btn" data-sheet-close>Cancel</button>
      </div>`, { title: c.note ? 'Edit note' : 'Add a note' });
    if (!s) {
      const next = window.prompt('Note for this clipping:', c.note || '');
      if (next === null) return;
      await updateNote(id, next);
      renderList();
      return;
    }
    const ta = s.sheet.querySelector('#clp-note-input');
    const save = async () => {
      s.close();
      await updateNote(id, ta.value);
      renderList();
    };
    s.sheet.querySelector('[data-save]').addEventListener('click', save);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); });
  }

  // ═════════════════════════════════════════════════════════════════════
  // UI: SAVE CLIPPING (full-screen view-share, opened by the share sheet)
  // ═════════════════════════════════════════════════════════════════════

  let shareState = null;

  function updateCounter() {
    const ta = document.getElementById('clp-save-text');
    const counter = document.getElementById('clp-save-counter');
    if (!ta || !counter) return;
    const n = ta.value.length;
    // Only near the limit — otherwise the hint
    counter.textContent = n >= MAX_TEXT - 200
      ? `${n.toLocaleString()} / ${MAX_TEXT.toLocaleString()}`
      : 'Trim to the part you want';
    counter.classList.toggle('is-error', n >= MAX_TEXT);
  }

  function openShareView({ text, url, title }) {
    const ta = document.getElementById('clp-save-text');
    if (!ta) return;
    const note = document.getElementById('clp-save-note');
    const match = document.getElementById('share-match');
    const matched = matchSource(url || '');
    const meta = lookupArticleMeta(url || '');
    const articleTitle = title || (meta && meta.title) || '';
    let host = '';
    try { host = stripWWW(new URL(url || '').hostname); } catch {}

    ta.maxLength = MAX_TEXT;
    ta.value = (text || '').slice(0, MAX_TEXT);
    note.value = '';
    updateCounter();

    const peb = matched && window.MB && window.MB.peb ? window.MB.peb(matched) : neutralPeb(host || articleTitle);
    match.innerHTML = `
      ${peb}
      <div class="txt">
        <span class="src">${esc(matched ? matched.name : (host || 'A web page'))}</span>
        ${articleTitle ? `<span class="art">${esc(articleTitle)}</span>` : ''}
        <span class="ok">${matched ? `${ICON.check}Matched to a source in your brief` : 'Not from one of your sources'}</span>
      </div>`;

    document.getElementById('clp-save-return').hidden = !url;
    document.getElementById('share-foot').hidden = !url;
    document.getElementById('share-signin').hidden = isLoggedIn();
    shareState = { url: url || '', articleTitle, matched };

    if (window.MB && window.MB.showView) window.MB.showView('share');
    setTimeout(() => ta.focus({ preventScroll: true }), 80);
  }

  async function submitShare(mode) {
    if (!shareState) return;
    const ta = document.getElementById('clp-save-text');
    const note = document.getElementById('clp-save-note');
    const trimmed = ta.value.trim();
    if (!trimmed) { toast('Empty passage. Nothing to save.'); ta.focus(); return; }
    const btns = [document.getElementById('clp-save-return'), document.getElementById('clp-save-open')];
    btns.forEach(b => { b.disabled = true; });
    let saved = null;
    try {
      saved = await saveClipping({
        text: trimmed,
        note: note.value,
        articleUrl: shareState.url,
        articleTitle: shareState.articleTitle,
        source: shareState.matched || null
      });
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
    if (!saved) {
      document.getElementById('share-signin').hidden = isLoggedIn();
      return;
    }
    shareState = null;
    const returnUrl = mode === 'return' ? buildScrollUrl(saved) : '';
    if (returnUrl) {
      toast('Saved. Going back to the article…', { duration: 1600 });
      setTimeout(() => { window.location.href = returnUrl; }, 350);
    } else {
      if (window.MB && window.MB.navigate) window.MB.navigate('#/clippings', { replace: true });
      toast('Clipping saved.', { duration: 2000 });
    }
  }

  function discardShare() {
    shareState = null;
    if (window.MB && window.MB.back) window.MB.back('#/');
  }

  function setupShareView() {
    document.getElementById('clp-save-text')?.addEventListener('input', updateCounter);
    document.getElementById('clp-save-return')?.addEventListener('click', () => submitShare('return'));
    document.getElementById('clp-save-open')?.addEventListener('click', () => submitShare('open'));
    document.getElementById('share-discard')?.addEventListener('click', discardShare);
    document.getElementById('clp-save-text')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitShare('open');
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // INIT
  // ═════════════════════════════════════════════════════════════════════

  function init() {
    loadFromCache();
    updateBadge();
    setupAuthListener();
    setupShareView();
    document.addEventListener('click', rememberOutboundArticleClick, true);
    document.getElementById('clip-search-btn')?.addEventListener('click', toggleSearch);

    // Pull from cloud if already signed in. The Supabase session is the source
    // of truth here; Sync.isLoggedIn() can lag during a cold PWA share launch.
    currentUser().then(user => {
      if (user || isLoggedIn()) {
        pullAll().then(pushMissingLocal).then(setupRealtime);
        return;
      }

      // Best effort: poll briefly for login (Sync.init is async on cold start)
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        const polledUser = await currentUser();
        if (polledUser || isLoggedIn()) {
          clearInterval(poll);
          pullAll().then(pushMissingLocal).then(setupRealtime);
        } else if (tries > 20) {
          clearInterval(poll);
        }
      }, 500);
    });

    // Landed directly on #/clippings before this file loaded
    if (isActive()) render();

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
    render,
    count: getCount,
    latest: (n) => clippings.slice(0, n || 2),
    // Exposed for debugging / future inline-save flows
    _save: saveClipping
  };
})();
