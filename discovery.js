// ═══════════════════════════════════════════════════════════════════════
// Morning Brief — Discover Module
// Rebuilt in the app's design language. Uses UI.toast, State.addSource,
// renders into the pre-existing #discover-overlay modal shell.
// ═══════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const CFG = window.MB_CONFIG;
  let catalog = null;
  let catalogLoading = false;
  let catalogPromise = null;
  let lastSearch = '';

  // ── Catalog loader with cache fallback ────────────────────────────
  async function loadCatalog() {
    if (catalog) return catalog;
    if (catalogPromise) return catalogPromise;

    catalogPromise = (async () => {
      try {
        const res = await fetch('./discovery-sources.json');
        if (!res.ok) throw new Error('Failed to load catalog');
        const data = await res.json();
        catalog = data;
        try { localStorage.setItem('morning_brief_discover_cache', JSON.stringify(data)); } catch(e) {}
        return data;
      } catch(e) {
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

  // ── Render helpers ────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function updateStats(data) {
    const userCount = State.getCount();
    const max = CFG.MAX_SOURCES;
    document.getElementById('stat-categories').textContent = Object.keys(data.categories).length;
    document.getElementById('stat-total').textContent = data.source_count || '—';
    const yours = document.getElementById('stat-yours');
    yours.textContent = `${userCount} / ${max}`;
    const wrap = document.getElementById('stat-yours-wrap');
    wrap.classList.toggle('warning', userCount >= max);
  }

  function renderStarterPack(container) {
    if (State.getCount() > 0) return ''; // Only show at zero state
    const pack = CFG.STARTER_PACK;
    return `
      <div class="starter-pack">
        <div class="starter-pack-title">Not sure where to start?</div>
        <div class="starter-pack-desc">Six hand-picked publications across news, tech, science, and culture — a good default morning.</div>
        <div class="starter-pack-list">
          ${pack.map(s => `<span>${esc(s.name)}</span>`).join('')}
        </div>
        <button type="button" class="starter-pack-cta" data-starter-pack>Add all 6</button>
      </div>
    `;
  }

  function renderBundles() {
    return `
      <div class="discover-section-title">Curated Bundles</div>
      <div class="bundles-row">
        ${CFG.BUNDLES.map((b, i) => `
          <div class="bundle-card">
            <h4>${esc(b.name)}</h4>
            <p>${esc(b.description)}</p>
            <div class="bundle-sources">${b.sources.map(s => esc(s.name)).join(' · ')}</div>
            <button type="button" class="bundle-add-btn" data-bundle-idx="${i}">Add all ${b.sources.length}</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderCategories(filtered) {
    if (!Object.keys(filtered).length) {
      return `<div class="discover-empty">No sources match your search.</div>`;
    }
    return Object.entries(filtered).map(([cat, sources]) => `
      <div class="category-row">
        <div class="category-header">
          <span class="category-name">${esc(cat)}</span>
          <span class="category-count">${sources.length} sources</span>
        </div>
        <div class="sources-scroll">
          ${sources.map(s => renderSourceCard(s)).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderSourceCard(src) {
    const added = State.hasByRss(src.url);
    const full = State.getCount() >= CFG.MAX_SOURCES && !added;
    const disabledAttr = (added || full) ? 'disabled' : '';
    const cls = added ? 'source-card added' : 'source-card';
    const btnCls = added ? 'source-card-add added' : 'source-card-add';
    const label = added ? 'Added' : (full ? 'Full' : 'Add');
    return `
      <div class="${cls}">
        <div class="source-card-name">${esc(src.name)}</div>
        <div class="source-card-domain">${esc(src.domain || '')}</div>
        <button type="button" class="${btnCls}" data-add-url="${esc(src.url)}" data-add-name="${esc(src.name)}" data-add-domain="${esc(src.domain || '')}" ${disabledAttr}>${label}</button>
      </div>
    `;
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
    if (!catalog) return;
    const content = document.getElementById('discover-content');
    if (!content) return;
    const filtered = filterCatalog(catalog, lastSearch);
    const html =
      (lastSearch ? '' : renderStarterPack(content)) +
      (lastSearch ? '' : renderBundles()) +
      (lastSearch ? '' : `<div class="discover-section-title">All Categories</div>`) +
      renderCategories(filtered);
    content.innerHTML = html;
    updateStats(catalog);
  }

  // ── Bulk-add helper (used by starter pack + bundles) ──────────────
  async function bulkAdd(list, successMsg) {
    let added = 0, skipped = 0;
    for (const src of list) {
      if (State.getCount() >= CFG.MAX_SOURCES) { skipped++; continue; }
      if (State.hasByRss(src.url)) { skipped++; continue; }
      // addSource() is on window (exposed by main HTML)
      const result = await window.addSource(src.name, src.url);
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
    const overlay = document.getElementById('discover-overlay');
    if (!overlay) return;

    // Search — re-render on input
    const searchInput = document.getElementById('discover-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        lastSearch = e.target.value.trim();
        renderContent();
      });
    }

    // Click delegation within overlay
    overlay.addEventListener('click', async (e) => {
      const t = e.target;

      // Starter pack
      if (t.closest('[data-starter-pack]')) {
        t.closest('[data-starter-pack]').disabled = true;
        await bulkAdd(CFG.STARTER_PACK, 'Starter pack added');
        return;
      }

      // Bundle
      const bundleBtn = t.closest('[data-bundle-idx]');
      if (bundleBtn) {
        const idx = parseInt(bundleBtn.dataset.bundleIdx, 10);
        const bundle = CFG.BUNDLES[idx];
        if (bundle) {
          bundleBtn.disabled = true;
          await bulkAdd(bundle.sources, `"${bundle.name}" added`);
        }
        return;
      }

      // Single source add
      const addBtn = t.closest('[data-add-url]');
      if (addBtn && !addBtn.disabled) {
        const name = addBtn.dataset.addName;
        const url  = addBtn.dataset.addUrl;
        addBtn.disabled = true;
        addBtn.textContent = 'Adding…';
        const result = await window.addSource(name, url);
        if (result && result.ok) {
          addBtn.textContent = 'Added';
          addBtn.classList.add('added');
          UI.toast(`${name} added to your brief.`);
        } else {
          addBtn.disabled = false;
          addBtn.textContent = 'Add';
        }
        // Update stats
        updateStats(catalog);
        return;
      }
    });

    // Escape key + close on backdrop click handled in main app click delegator
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) {
        overlay.classList.remove('open');
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  async function open() {
    const overlay = document.getElementById('discover-overlay');
    if (!overlay) return;
    overlay.classList.add('open');

    const content = document.getElementById('discover-content');
    if (content && !catalog) {
      content.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">Loading catalog…</p></div>`;
    }

    try {
      await loadCatalog();
      renderContent();
    } catch(e) {
      if (content) {
        content.innerHTML = `<div class="discover-empty">Couldn't load the catalog. Check your connection and try again.</div>`;
      }
    }

    // Focus search input for keyboard users
    setTimeout(() => {
      document.getElementById('discover-search-input')?.focus();
    }, 100);
  }

  function close() {
    document.getElementById('discover-overlay')?.classList.remove('open');
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    setupHandlers();
  }

  // Wait for DOM + main app to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Discover = { open, close };
})();
