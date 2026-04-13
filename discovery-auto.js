// ═══════════════════════════════════════════════════════════════════════
// DISCOVERY FEATURE - AUTO-INJECT VERSION
// Just add <script src="./discovery-auto.js"></script> to your HTML
// Everything else happens automatically!
// ═══════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const CONFIG = {
    jsonUrl: './discovery-sources.json',
    cacheKey: 'morning_brief_discovery_cache',
    versionKey: 'morning_brief_discovery_version'
  };

  // ── State ──────────────────────────────────────────────────────────────
  let discoveryData = null;
  let isLoadingDiscovery = false;

  // ═══════════════════════════════════════════════════════════════════════
  // AUTO-INJECT CSS
  // ═══════════════════════════════════════════════════════════════════════
  
  function injectCSS() {
    const css = `
/* Discovery Feature Styles */
.discovery-section { margin-top: 32px; padding-top: 32px; border-top: 1px solid var(--rule); }
.discovery-section h3 { font-family: var(--display); font-size: 1.1rem; margin-bottom: 16px; color: var(--ink); }
.discovery-search-container { margin-bottom: 20px; }
.discovery-search-input { width: 100%; padding: 12px 16px; font-family: var(--body); font-size: 0.95rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg); color: var(--ink); transition: all 0.2s; }
.discovery-search-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.discovery-search-input::placeholder { color: var(--ink-muted); }
.discovery-results { display: none; margin-bottom: 20px; }
.discovery-search-results h4 { font-family: var(--body); font-size: 0.85rem; font-weight: 500; color: var(--ink-muted); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
.discovery-no-results { padding: 32px; text-align: center; color: var(--ink-muted); }
.discovery-hint { font-size: 0.85rem; color: var(--ink-muted); }
.discovery-categories { display: block; }
.discovery-category { margin-bottom: 8px; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; background: var(--paper); transition: all 0.2s; }
.discovery-category:hover { border-color: var(--ink-muted); }
.category-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer; user-select: none; transition: background 0.15s; }
.category-header:hover { background: var(--accent-soft); }
.category-icon { font-size: 0.7rem; color: var(--ink-muted); flex-shrink: 0; width: 16px; transition: transform 0.2s; }
.category-name { flex: 1; font-family: var(--body); font-size: 0.95rem; font-weight: 500; color: var(--ink); }
.category-count { font-size: 0.8rem; color: var(--ink-muted); background: var(--bg); padding: 2px 8px; border-radius: 12px; flex-shrink: 0; }
.category-sources { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.discovery-category.expanded .category-sources { max-height: 2000px; }
.discovery-source { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--rule); transition: background 0.15s; }
.discovery-source:hover { background: var(--accent-soft); }
.discovery-source.added { opacity: 0.6; background: var(--bg); }
.source-info { flex: 1; min-width: 0; }
.source-name { font-family: var(--body); font-size: 0.9rem; color: var(--ink); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-domain { font-size: 0.75rem; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-add, .btn-added { flex-shrink: 0; padding: 8px 16px; font-family: var(--body); font-size: 0.85rem; font-weight: 500; border-radius: 6px; cursor: pointer; transition: all 0.15s; border: none; white-space: nowrap; min-height: 44px; min-width: 70px; }
.btn-add { background: var(--accent); color: white; border: 1px solid var(--accent); }
.btn-add:hover { background: var(--ink); border-color: var(--ink); transform: translateY(-1px); }
.btn-added { background: transparent; color: var(--accent); border: 1px solid var(--accent); cursor: not-allowed; opacity: 0.7; }
.discovery-loading, .discovery-error { padding: 48px 24px; text-align: center; color: var(--ink-muted); }
.discovery-error { background: var(--accent-soft); border-radius: 8px; margin: 16px 0; }
.toast-notification { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px); background: var(--ink); color: var(--paper); padding: 12px 24px; border-radius: 8px; font-family: var(--body); font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); z-index: 10000; opacity: 0; transition: all 0.3s ease; }
.toast-notification.show { transform: translateX(-50%) translateY(0); opacity: 1; }
@media (max-width: 768px) {
  .discovery-section { margin-top: 24px; padding-top: 24px; }
  .discovery-search-input { font-size: 16px; }
  .source-name { font-size: 0.85rem; }
  .source-domain { font-size: 0.7rem; }
  @media (max-width: 375px) { .source-domain { display: none; } }
}
    `;

    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTO-FIND MODAL AND INJECT HTML
  // ═══════════════════════════════════════════════════════════════════════

  function injectHTML() {
    // Find the modal body
    const modalBody = document.querySelector('.modal-body');
    if (!modalBody) {
      console.error('Discovery: Could not find .modal-body');
      return false;
    }

    // Find the add-source-form
    const addSourceForm = modalBody.querySelector('.add-source-form');
    if (!addSourceForm) {
      console.error('Discovery: Could not find .add-source-form');
      return false;
    }

    // Create discovery container
    const discoveryContainer = document.createElement('div');
    discoveryContainer.id = 'discovery-container';
    
    // Insert after the add-source-form
    addSourceForm.insertAdjacentElement('afterend', discoveryContainer);
    
    console.log('✓ Discovery container injected');
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORE FUNCTIONS (same as before)
  // ═══════════════════════════════════════════════════════════════════════

  async function loadDiscoveryData() {
    if (isLoadingDiscovery) return;
    isLoadingDiscovery = true;

    try {
      const response = await fetch(CONFIG.jsonUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      if (!data.categories) throw new Error('Invalid JSON structure');
      
      localStorage.setItem(CONFIG.cacheKey, JSON.stringify(data));
      localStorage.setItem(CONFIG.versionKey, data.version);
      
      discoveryData = data;
      console.log(`✓ Discovery loaded: ${data.source_count} sources`);
      
    } catch (error) {
      console.error('Discovery load failed:', error);
      
      // Try cache
      const cached = localStorage.getItem(CONFIG.cacheKey);
      if (cached) {
        discoveryData = JSON.parse(cached);
        console.log('✓ Using cached discovery data');
      }
    } finally {
      isLoadingDiscovery = false;
    }
  }

  function isSourceAlreadyAdded(url) {
    if (typeof State === 'undefined') return false;
    const sources = State.getSources();
    return sources.some(s => s.rss === url);
  }

  function quickAddFromDiscovery(name, url, category) {
    // Check if already added
    if (isSourceAlreadyAdded(url)) {
      showToast(`✓ ${name} is already in your sources`);
      return;
    }

    // Check limit
    if (typeof State !== 'undefined' && State.getCount() >= 20) {
      alert(`You've reached your 20-source limit. Remove a source to add: ${name}`);
      return;
    }

    // Save scroll
    const modalBody = document.querySelector('.modal-body');
    const scrollPos = modalBody ? modalBody.scrollTop : 0;

    // Auto-populate
    const nameInput = document.getElementById('new-source-name');
    const urlInput = document.getElementById('new-source-url');
    if (nameInput && urlInput) {
      nameInput.value = name;
      urlInput.value = url;
      
      // Trigger add (if exists)
      if (typeof addSource === 'function') {
        addSource();
        
        // Track analytics
        if (typeof Analytics !== 'undefined') {
          Analytics.track('source_added_from_discovery', {
            source_name: name,
            source_category: category
          });
        }
      }
    }

    // Restore scroll
    if (modalBody) {
      setTimeout(() => { modalBody.scrollTop = scrollPos; }, 100);
    }

    showToast(`✓ ${name} added`);
    updateDiscoverySourceState(url, 'added');
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function updateDiscoverySourceState(url, state) {
    const button = document.querySelector(`[data-source-url="${url}"]`);
    if (!button) return;
    
    if (state === 'added') {
      button.disabled = true;
      button.textContent = '✓ Added';
      button.className = 'btn-added';
    }
  }

  function searchSources(query) {
    if (!query || query.length < 2 || !discoveryData) return null;
    
    const q = query.toLowerCase();
    const results = [];
    
    for (const [category, sources] of Object.entries(discoveryData.categories)) {
      for (const source of sources) {
        let score = 0;
        if (source.name.toLowerCase() === q) score += 100;
        else if (source.name.toLowerCase().startsWith(q)) score += 50;
        else if (source.name.toLowerCase().includes(q)) score += 20;
        if (category.toLowerCase().includes(q)) score += 10;
        if (source.domain && source.domain.includes(q)) score += 5;
        
        if (score > 0) {
          results.push({ ...source, category, score });
        }
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  function renderDiscoveryUI() {
    const container = document.getElementById('discovery-container');
    if (!container) return;

    container.innerHTML = `
      <div class="discovery-section">
        <h3>or browse ${discoveryData.source_count.toLocaleString()}+ curated sources</h3>
        
        <div class="discovery-search-container">
          <input 
            type="search" 
            id="discovery-search" 
            class="discovery-search-input"
            placeholder="Search sources..."
            autocomplete="off"
          >
        </div>
        
        <div id="discovery-results" class="discovery-results"></div>
        
        <div id="discovery-categories" class="discovery-categories">
          ${renderCategories()}
        </div>
      </div>
    `;

    attachListeners();
  }

  function renderCategories() {
    const categories = Object.entries(discoveryData.categories);
    const top10 = categories.slice(0, 10);
    
    return top10.map(([cat, sources]) => `
      <div class="discovery-category collapsed">
        <div class="category-header" onclick="window.discoveryToggleCategory(this)">
          <span class="category-icon">▶</span>
          <span class="category-name">${escapeHtml(cat)}</span>
          <span class="category-count">${sources.length}</span>
        </div>
        <div class="category-sources">
          ${sources.slice(0, 5).map(s => renderSource(s, cat)).join('')}
        </div>
      </div>
    `).join('') + (categories.length > 10 ? `
      <div style="text-align: center; padding: 16px; color: var(--ink-muted); font-size: 0.9rem;">
        ${categories.length - 10} more categories available (search to see all)
      </div>
    ` : '');
  }

  function renderSource(source, category) {
    const added = isSourceAlreadyAdded(source.url);
    return `
      <div class="discovery-source ${added ? 'added' : ''}">
        <div class="source-info">
          <div class="source-name">${escapeHtml(source.name)}</div>
          <div class="source-domain">${escapeHtml(source.domain)}</div>
        </div>
        <button 
          class="${added ? 'btn-added' : 'btn-add'}"
          data-source-url="${escapeHtml(source.url)}"
          onclick="window.discoveryQuickAdd('${escapeHtml(source.name)}', '${escapeHtml(source.url)}', '${escapeHtml(category)}')"
          ${added ? 'disabled' : ''}
        >
          ${added ? '✓ Added' : '+ Add'}
        </button>
      </div>
    `;
  }

  function attachListeners() {
    const searchInput = document.getElementById('discovery-search');
    if (!searchInput) return;

    let timeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => handleSearch(e.target.value), 300);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.target.value = '';
        handleSearch('');
      }
    });
  }

  function handleSearch(query) {
    const resultsDiv = document.getElementById('discovery-results');
    const categoriesDiv = document.getElementById('discovery-categories');
    
    if (!query || query.length < 2) {
      resultsDiv.style.display = 'none';
      categoriesDiv.style.display = 'block';
      return;
    }

    const results = searchSources(query);
    categoriesDiv.style.display = 'none';
    resultsDiv.style.display = 'block';

    if (!results || results.length === 0) {
      resultsDiv.innerHTML = `
        <div class="discovery-no-results">
          <p>No sources found for "${escapeHtml(query)}"</p>
          <p class="discovery-hint">Try: "AI", "tech", "business", or "pakistan"</p>
        </div>
      `;
      return;
    }

    resultsDiv.innerHTML = `
      <div class="discovery-search-results">
        <h4>Found ${results.length} source${results.length !== 1 ? 's' : ''}</h4>
        ${results.slice(0, 20).map(s => renderSource(s, s.category)).join('')}
      </div>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EXPOSE GLOBAL FUNCTIONS (needed for onclick handlers)
  // ═══════════════════════════════════════════════════════════════════════

  window.discoveryQuickAdd = quickAddFromDiscovery;
  
  window.discoveryToggleCategory = function(headerElement) {
    const category = headerElement.closest('.discovery-category');
    const isCollapsed = category.classList.contains('collapsed');
    
    if (isCollapsed) {
      category.classList.remove('collapsed');
      category.classList.add('expanded');
      headerElement.querySelector('.category-icon').textContent = '▼';
    } else {
      category.classList.add('collapsed');
      category.classList.remove('expanded');
      headerElement.querySelector('.category-icon').textContent = '▶';
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // AUTO-INITIALIZE
  // ═══════════════════════════════════════════════════════════════════════

  function initialize() {
    console.log('🔍 Discovery Feature initializing...');
    
    // Step 1: Inject CSS
    injectCSS();
    console.log('✓ CSS injected');
    
    // Step 2: Wait for DOM and inject HTML
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (injectHTML()) {
          loadAndRender();
        }
      });
    } else {
      if (injectHTML()) {
        loadAndRender();
      }
    }
  }

  async function loadAndRender() {
    const container = document.getElementById('discovery-container');
    if (!container) return;

    container.innerHTML = '<div class="discovery-loading"><p>⋯ Loading discovery sources...</p></div>';
    
    await loadDiscoveryData();
    
    if (discoveryData) {
      renderDiscoveryUI();
      console.log('✓ Discovery ready!');
    } else {
      container.innerHTML = `
        <div class="discovery-error">
          <p>Unable to load discovery sources.</p>
          <p>Make sure discovery-sources.json is in the same folder.</p>
        </div>
      `;
    }
  }

  // Start!
  initialize();

})();
