// ═══════════════════════════════════════════════════════════════════════
// Morning Brief — Discover Module
// Renders the catalog into #discover-content inside the Discover view.
// Adds go through window.addSource, so State → Persist → Sync → UI holds.
// ═══════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const CFG = window.MB_CONFIG;
  const TOPIC_CHIPS = 6;
  const SEARCH_LIMIT = 80;
  let catalog = null;
  let catalogPromise = null;
  let lastSearch = '';
  let topic = null;          // null = All topics
  let showAllTopics = false;
  let searchTimer = null;
  let justAdded = '';        // the row just added pops once

  // ── Catalog loader with cache fallback ────────────────────────────
  async function loadCatalog() {
    if (catalog) return catalog;
    if (catalogPromise) return catalogPromise;

    catalogPromise = (async () => {
      // 8s timeout — if the JSON stalls on a slow network, fall through to
      // the localStorage cache (if present) rather than spinning forever.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch('./discovery-sources.json', { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('Failed to load catalog');
        const data = await res.json();
        catalog = data;
        try { localStorage.setItem('morning_brief_discover_cache', JSON.stringify(data)); } catch(e) {}
        return data;
      } catch(e) {
        clearTimeout(timer);
        catalogPromise = null;
        // Fall back to cache if available
        try {
          const cached = localStorage.getItem('morning_brief_discover_cache');
          if (cached) {
            catalog = JSON.parse(cached);
            return catalog;
          }
        } catch(err) {}
        throw e;
      }
    })();
    return catalogPromise;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

  // Chip labels: drop parentheticals, "Artificial Intelligence" → "AI",
  // and cut at " & " when the label runs long.
  function shortTopic(name) {
    let s = String(name).replace(/\s*\([^)]*\)/g, '').replace(/Artificial Intelligence/gi, 'AI').trim();
    if (s.length > 24) {
      const i = s.indexOf(' & ');
      if (i >= 8) s = s.slice(0, i);
    }
    return s;
  }

  function findSource(url) {
    return State.getSources().find(s => s.rss === url) || null;
  }

  function pebFor(src) {
    const mine = findSource(src.url);
    if (mine && window.MB && window.MB.peb) return window.MB.peb(mine);
    const letter = String(src.name || '').trim().replace(/^the\s+/i, '').match(/[\p{L}\p{N}]/u);
    return `<span class="peb neutral" aria-hidden="true">${esc(letter ? letter[0].toUpperCase() : '•')}</span>`;
  }

  function isFull() { return State.getCount() >= State.getLimit(); }

  // User's topics first (most of their sources), then catalog order.
  function orderedTopics() {
    const entries = Object.entries(catalog.categories);
    const mine = new Map(entries.map(([cat, list]) => [cat, list.filter(s => State.hasByRss(s.url)).length]));
    return entries
      .map(([cat], i) => ({ cat, i, n: mine.get(cat) }))
      .sort((a, b) => (b.n > 0) - (a.n > 0) || b.n - a.n || a.i - b.i)
      .map(x => x.cat);
  }

  function updateCounts() {
    const text = `${State.getCount()} of ${State.getLimit()}`;
    const pill = document.getElementById('discover-count');
    const bar = document.getElementById('discover-bar-count');
    if (pill) pill.textContent = text;
    if (bar) bar.textContent = `${text} sources`;
  }

  // ── Render pieces ─────────────────────────────────────────────────
  function rowHTML(src) {
    const added = State.hasByRss(src.url);
    const full = !added && isFull();
    let btn;
    if (added) {
      btn = `<button type="button" class="d-add added" aria-disabled="true" aria-label="${esc(src.name)} is in your brief"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Added</button>`;
    } else if (full) {
      btn = `<button type="button" class="d-add full" data-full aria-label="Your brief is full. Add ${esc(src.name)} by making room">Full</button>`;
    } else {
      btn = `<button type="button" class="d-add" data-add-url="${esc(src.url)}" data-add-name="${esc(src.name)}" data-add-domain="${esc(src.domain || '')}" aria-label="Add ${esc(src.name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add</button>`;
    }
    return `
      <div class="d-row${justAdded && src.url === justAdded ? ' just' : ''}">
        ${pebFor(src)}
        <div class="txt"><span class="name">${esc(src.name)}</span><span class="dom">${esc(src.domain || '')}</span></div>
        ${btn}
      </div>`;
  }

  function chipsHTML() {
    const topics = orderedTopics();
    const shown = showAllTopics ? topics : topics.slice(0, TOPIC_CHIPS);
    // Keep the selected topic visible even when it's past the first six
    if (topic && !shown.includes(topic)) shown.push(topic);
    const more = topics.length - TOPIC_CHIPS;
    return `
      <div class="topics" role="group" aria-label="Topics" style="padding-top: 16px">
        <button type="button" class="chip" data-topic="" aria-pressed="${!topic}">All topics</button>
        ${shown.map(cat => `<button type="button" class="chip" data-topic="${esc(cat)}" aria-pressed="${topic === cat}" title="${esc(cat)}">${esc(shortTopic(cat))}</button>`).join('')}
        ${more > 0 ? `<button type="button" class="chip outline" data-more-topics aria-expanded="${showAllTopics}">${showAllTopics ? 'Fewer' : `${more} more`}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="${showAllTopics ? 'transform: rotate(180deg)' : ''}"><path d="M6 9l6 6 6-6"/></svg></button>` : ''}
      </div>`;
  }

  function starterHTML() {
    if (State.getCount() > 0) return ''; // only at zero sources
    const pack = CFG.STARTER_PACK;
    return `
      <div class="card bundle" style="margin-top: 20px">
        <h3>Not sure where to start?</h3>
        <p>${pack.length} hand-picked publications across news, tech, science and culture. A good default morning.</p>
        <span class="who">${pack.map(s => esc(s.name)).join(' · ')}</span>
        <button type="button" class="btn primary small" data-starter-pack>Add all ${pack.length}</button>
      </div>`;
  }

  function bundlesHTML() {
    return `
      <div class="d-title"><h2>Bundles</h2><span>A few sources that read well together</span></div>
      <div class="bundles">
        ${CFG.BUNDLES.map((b, i) => {
          const fresh = b.sources.filter(s => !State.hasByRss(s.url)).length;
          return `
            <div class="card bundle">
              <h3>${esc(b.name)}</h3>
              <p>${esc(b.description)}</p>
              <span class="who">${b.sources.map(s => esc(s.name)).join(' · ')}</span>
              <button type="button" class="btn small" data-bundle-idx="${i}"${fresh ? '' : ' disabled'}>${fresh ? `Add ${fresh === b.sources.length ? 'all ' : ''}${fresh}` : 'All added'}</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  function topicListHTML() {
    const topics = orderedTopics();
    return `
      <div class="d-title"><h2>All topics</h2><span class="tnum">${topics.length} topics · ${catalog.source_count || ''} sources</span></div>
      <div class="card d-list">
        ${topics.map(cat => {
          const list = catalog.categories[cat];
          const mine = list.filter(s => State.hasByRss(s.url)).length;
          return `
            <button type="button" class="topic-row" data-topic="${esc(cat)}">
              <span class="name">${esc(cat)}</span>
              <span class="n tnum">${list.length}${mine ? ` · ${mine} yours` : ''}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform: rotate(-90deg); color: var(--text-3)"><path d="M6 9l6 6 6-6"/></svg>
            </button>`;
        }).join('')}
      </div>`;
  }

  function topicHTML(cat) {
    const list = catalog.categories[cat] || [];
    const mine = list.filter(s => State.hasByRss(s.url)).length;
    return `
      <div class="d-title"><h2 id="d-topic-title" tabindex="-1">${esc(cat)}</h2><span class="tnum">${plural(list.length, 'source')}${mine ? ` · ${mine} already in your brief` : ''}</span></div>
      <div class="card d-list">${list.map(rowHTML).join('')}</div>`;
  }

  function searchHTML(q) {
    const seen = new Set();
    const hits = [];
    const query = q.toLowerCase();
    for (const [cat, sources] of Object.entries(filterCatalog(catalog, q))) {
      const catHit = cat.toLowerCase().includes(query);
      for (const s of sources) {
        if (seen.has(s.url)) continue;
        if (catHit || (s.name || '').toLowerCase().includes(query) || (s.domain || '').toLowerCase().includes(query)) {
          seen.add(s.url);
          hits.push(s);
        }
      }
    }
    if (!hits.length) {
      return `<p class="d-empty">Nothing matches “${esc(q)}”. You can also paste any website address in Sources.</p>`;
    }
    return `
      <div class="d-title"><h2>Results</h2><span class="tnum">${plural(hits.length, 'source')}${hits.length > SEARCH_LIMIT ? `, showing the first ${SEARCH_LIMIT}` : ''}</span></div>
      <div class="card d-list">${hits.slice(0, SEARCH_LIMIT).map(rowHTML).join('')}</div>`;
  }

  function filterCatalog(data, query) {
    if (!query) {
      // Show all categories
      return data.categories;
    }
    const q = query.toLowerCase();
    const out = {};
    for (const [cat, sources] of Object.entries(data.categories)) {
      // Category name match — include all sources
      if (cat.toLowerCase().includes(q)) {
        out[cat] = sources;
        continue;
      }
      // Source name / domain match
      const matching = sources.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.domain || '').toLowerCase().includes(q)
      );
      if (matching.length) out[cat] = matching;
    }
    return out;
  }

  function renderContent() {
    const content = document.getElementById('discover-content');
    if (!content || !catalog) return;
    // Keep focus on the control the user just pressed across re-renders
    const active = document.activeElement;
    const focusKey = active && content.contains(active)
      ? (active.dataset.topic !== undefined ? `[data-topic="${CSS.escape(active.dataset.topic)}"]`
        : active.hasAttribute('data-more-topics') ? '[data-more-topics]' : '')
      : '';
    let html;
    if (lastSearch) html = searchHTML(lastSearch);
    else if (topic) html = chipsHTML() + topicHTML(topic);
    else html = chipsHTML() + starterHTML() + bundlesHTML() + topicListHTML();
    content.innerHTML = html;
    updateCounts();
    if (focusKey) content.querySelector(focusKey)?.focus({ preventScroll: true });
  }

  // ── Bulk-add helper (used by starter pack + bundles) ──────────────
  async function bulkAdd(list, successMsg) {
    let added = 0, skipped = 0;
    for (const src of list) {
      if (State.getCount() >= State.getLimit()) { skipped++; continue; }
      if (State.hasByRss(src.url)) { skipped++; continue; }
      // addSource() is on window (exposed by main HTML)
      const result = await window.addSource(src.name, src.url, src.domain);
      if (result && result.ok) added++;
      else skipped++;
    }
    if (added > 0) {
      UI.toast(`${successMsg} (${added} added${skipped ? `, ${skipped} skipped` : ''})`);
    } else {
      UI.toast('No new sources added.');
    }
    renderContent();
  }

  // ── Event handlers ────────────────────────────────────────────────
  function setupHandlers() {
    const view = document.getElementById('view-discover');
    if (!view) return;

    const searchInput = document.getElementById('discover-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const val = e.target.value.trim();
        searchTimer = setTimeout(() => { lastSearch = val; renderContent(); }, 120);
      });
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    }

    view.addEventListener('click', async (e) => {
      const t = e.target;

      const topicBtn = t.closest('[data-topic]');
      if (topicBtn) {
        const next = topicBtn.dataset.topic || null;
        const fromList = topicBtn.classList.contains('topic-row');
        topic = next;
        renderContent();
        if (fromList) {
          document.getElementById('d-topic-title')?.focus({ preventScroll: true });
          document.getElementById('discover-content')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        return;
      }

      if (t.closest('[data-more-topics]')) {
        showAllTopics = !showAllTopics;
        renderContent();
        return;
      }

      if (t.closest('[data-full]')) {
        if (window.MB && window.MB.sources) window.MB.sources.promptVoucher();
        return;
      }

      // Starter pack
      if (t.closest('[data-starter-pack]')) {
        t.closest('[data-starter-pack]').disabled = true;
        await bulkAdd(CFG.STARTER_PACK, 'Starter pack added');
        return;
      }

      // Bundle
      const bundleBtn = t.closest('[data-bundle-idx]');
      if (bundleBtn) {
        const bundle = CFG.BUNDLES[parseInt(bundleBtn.dataset.bundleIdx, 10)];
        if (bundle) {
          bundleBtn.disabled = true;
          await bulkAdd(bundle.sources, `${bundle.name} added`);
        }
        return;
      }

      // Single source add
      const addBtn = t.closest('[data-add-url]');
      if (addBtn && !addBtn.disabled) {
        const name = addBtn.dataset.addName;
        addBtn.disabled = true;
        addBtn.textContent = 'Adding…';
        const result = await window.addSource(name, addBtn.dataset.addUrl, addBtn.dataset.addDomain);
        if (result && result.ok) {
          justAdded = addBtn.dataset.addUrl;
          UI.toast(`${name} added to your brief.`);
        }
        renderContent();
        justAdded = '';
        // Focus lands back on the row's button (now "Added")
        const rows = Array.from(document.querySelectorAll('#discover-content .d-row'));
        const row = rows.find(r => r.querySelector('.name')?.textContent === name);
        row?.querySelector('.d-add')?.focus({ preventScroll: true });
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  async function render() {
    const content = document.getElementById('discover-content');
    if (!content) return;
    updateCounts();
    if (!catalog) {
      content.innerHTML = `<div class="card skeleton" style="margin-top: 16px" aria-label="Loading the catalog"><span class="t"></span><span></span><span class="s"></span></div>`;
      try {
        await loadCatalog();
      } catch(e) {
        content.innerHTML = `<p class="d-empty">Couldn't load the catalog. Check your connection and try again.</p>`;
        return;
      }
    }
    renderContent();
  }

  function open() {
    if (window.MB && window.MB.navigate) window.MB.navigate('#/discover');
  }

  function close() {
    if (window.MB && window.MB.back) window.MB.back('#/sources');
  }

  // Public refresh — re-render Add/Added/Full after the list or limit
  // changes. Safe to call when the catalog isn't loaded.
  function refresh() {
    if (catalog) renderContent();
    else updateCounts();
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    setupHandlers();
    // Landed directly on #/discover before this file loaded
    if (document.getElementById('view-discover')?.classList.contains('active')) render();
  }

  // Wait for DOM + main app to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Discover = { open, close, refresh, render };
})();
