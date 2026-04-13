// ═══════════════════════════════════════════════════════════════════════
// DISCOVERY FEATURE - NETFLIX-STYLE BROWSE
// Simple category-based browsing with horizontal scroll
// ═══════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const CONFIG = {
    jsonUrl: './discovery-sources.json',
    cacheKey: 'morning_brief_discovery_cache',
    versionKey: 'morning_brief_discovery_version'
  };

  let discoveryData = null;
  let isOpen = false;
  let isAdding = false; // Prevent rapid-fire adding

  // ═══════════════════════════════════════════════════════════════════════
  // INJECT CSS
  // ═══════════════════════════════════════════════════════════════════════

  function injectCSS() {
    const css = `
/* Discovery Modal */
.discovery-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
.discovery-modal.show { display: flex; opacity: 1; }
.discovery-container { background: var(--bg); width: 90%; max-width: 1200px; max-height: 90vh; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }

/* Header */
.discovery-header { padding: 20px 24px; border-bottom: 1px solid var(--rule); display: flex; align-items: center; justify-content: space-between; background: var(--paper); }
.discovery-title { font-family: var(--display); font-size: 1.3rem; font-weight: 600; color: var(--ink); }
.discovery-close { width: 32px; height: 32px; border: none; background: transparent; color: var(--ink-muted); cursor: pointer; font-size: 1.5rem; line-height: 1; transition: color 0.15s; }
.discovery-close:hover { color: var(--ink); }
.discovery-close:focus { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Stats Bar */
.discovery-stats { padding: 16px 24px; background: var(--bg); border-bottom: 1px solid var(--rule); display: flex; gap: 16px; }
.stat-item { flex: 1; text-align: center; }
.stat-label { font-size: 0.75rem; color: var(--ink-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
.stat-value { font-size: 1.2rem; font-weight: 600; color: var(--ink); }
.stat-value.warning { color: #f59e0b; }
.stat-value.full { color: #ef4444; }

/* Search */
.discovery-search { padding: 16px 24px; background: var(--paper); border-bottom: 1px solid var(--rule); }
.search-input { width: 100%; padding: 12px 16px 12px 40px; font-family: var(--body); font-size: 0.95rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg); color: var(--ink); transition: all 0.2s; }
.search-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search-container { position: relative; }
.search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-muted); font-size: 0.9rem; pointer-events: none; }

/* Content Area */
.discovery-content { flex: 1; overflow-y: auto; padding: 24px; background: var(--bg); }
.discovery-content::-webkit-scrollbar { width: 8px; }
.discovery-content::-webkit-scrollbar-track { background: transparent; }
.discovery-content::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 4px; }

/* Category Row */
.category-row { margin-bottom: 32px; }
.category-row:last-child { margin-bottom: 0; }
.category-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.category-name { font-family: var(--body); font-size: 1rem; font-weight: 600; color: var(--ink); }
.category-count { font-size: 0.85rem; color: var(--ink-muted); }

/* Sources Scroll - With peek effect */
.sources-scroll { display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden; padding-bottom: 8px; padding-right: 90px; scroll-behavior: smooth; position: relative; }
.sources-scroll::-webkit-scrollbar { height: 6px; }
.sources-scroll::-webkit-scrollbar-track { background: transparent; }
.sources-scroll::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 3px; }
.sources-scroll::-webkit-scrollbar-thumb:hover { background: var(--ink-muted); }

/* Scroll peek indicator */
.sources-scroll::after { content: ''; position: absolute; right: 0; top: 0; bottom: 8px; width: 80px; background: linear-gradient(to right, transparent, var(--bg) 70%); pointer-events: none; }

/* Source Card */
.source-card { flex: 0 0 180px; background: var(--paper); border: 1px solid var(--rule); border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; gap: 8px; }
.source-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.source-card:focus { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
.source-card.added { opacity: 0.6; cursor: not-allowed; }
.source-card.added:hover { transform: none; box-shadow: none; border-color: var(--rule); }
.source-card.added:focus { outline: 1px solid var(--rule); }
.source-name { font-size: 0.9rem; font-weight: 500; color: var(--ink); line-height: 1.3; min-height: 38px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.source-domain { font-size: 0.75rem; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-btn { margin-top: auto; padding: 8px 12px; background: var(--accent); border: none; border-radius: 6px; color: white; font-family: var(--body); font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: all 0.15s; }
.add-btn:hover { background: var(--ink); }
.add-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.add-btn.adding { background: var(--ink-muted); cursor: wait; }
.add-btn.added { background: transparent; color: var(--accent); border: 1px solid var(--accent); cursor: not-allowed; }

/* Empty State */
.empty-state { padding: 64px 24px; text-align: center; }
.empty-state-icon { font-size: 3rem; margin-bottom: 16px; opacity: 0.3; }
.empty-state-title { font-size: 1.1rem; font-weight: 500; color: var(--ink); margin-bottom: 8px; }
.empty-state-text { font-size: 0.9rem; color: var(--ink-muted); }

/* Loading with spinner */
.discovery-loading { padding: 64px 24px; text-align: center; color: var(--ink-muted); }
.spinner { width: 40px; height: 40px; margin: 0 auto 16px; border: 3px solid var(--rule); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Toast */
.discovery-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px); background: var(--ink); color: var(--paper); padding: 12px 24px; border-radius: 8px; font-family: var(--body); font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10001; opacity: 0; transition: all 0.3s; }
.discovery-toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }

/* Responsive */
@media (max-width: 768px) {
  .discovery-container { width: 100%; max-width: 100%; height: 100vh; max-height: 100vh; border-radius: 0; }
  .discovery-header { padding: 16px 20px; }
  .discovery-stats { flex-wrap: wrap; }
  .stat-item { flex: 0 0 calc(33.333% - 12px); }
  .discovery-search { padding: 12px 20px; }
  .discovery-content { padding: 20px; }
  .source-card { flex: 0 0 160px; }
  .category-name { font-size: 0.9rem; }
}

@media (max-width: 480px) {
  .source-card { flex: 0 0 140px; padding: 12px; }
  .source-name { font-size: 0.85rem; min-height: 34px; }
  .discovery-stats { gap: 8px; }
  .stat-item { flex: 0 0 calc(33.333% - 6px); }
  .stat-value { font-size: 1rem; }
  /* Larger touch targets for mobile */
  .add-btn { padding: 12px 16px; min-height: 44px; font-size: 0.9rem; }
  .discovery-close { width: 44px; height: 44px; }
}
    `;

    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ═══════════════════════════════════════════════════════════════════════

  function loadDiscoveryData() {
    return fetch(CONFIG.jsonUrl)
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function(data) {
        if (!data.categories) throw new Error('Invalid JSON');
        
        localStorage.setItem(CONFIG.cacheKey, JSON.stringify(data));
        localStorage.setItem(CONFIG.versionKey, data.version);
        
        discoveryData = data;
        return data;
      })
      .catch(function(error) {
        console.error('Discovery load failed:', error);
        var cached = localStorage.getItem(CONFIG.cacheKey);
        if (cached) {
          discoveryData = JSON.parse(cached);
          return discoveryData;
        }
        throw error;
      });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI RENDERING
  // ═══════════════════════════════════════════════════════════════════════

  function createModal() {
    const modal = document.createElement('div');
    modal.className = 'discovery-modal';
    modal.id = 'discovery-modal';
    
    modal.innerHTML = `
      <div class="discovery-container" role="dialog" aria-labelledby="discovery-title" aria-modal="true">
        <div class="discovery-header">
          <h2 class="discovery-title" id="discovery-title">Discover Sources</h2>
          <button class="discovery-close" 
                  onclick="window.closeDiscovery()"
                  aria-label="Close discovery modal">&times;</button>
        </div>
        
        <div class="discovery-stats" role="status" aria-live="polite">
          <div class="stat-item">
            <div class="stat-label">Categories</div>
            <div class="stat-value" id="stat-categories" aria-label="Total categories available">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total Sources</div>
            <div class="stat-value" id="stat-sources" aria-label="Total sources available">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Your Sources</div>
            <div class="stat-value" id="stat-yours" aria-label="Your current source count">0/20</div>
          </div>
        </div>
        
        <div class="discovery-search">
          <div class="search-container">
            <span class="search-icon" aria-hidden="true">🔍</span>
            <input 
              type="text" 
              class="search-input" 
              id="category-search"
              placeholder="Filter categories..."
              autocomplete="off"
              aria-label="Search and filter categories"
            >
          </div>
        </div>
        
        <div class="discovery-content" id="discovery-content" role="main">
          <div class="discovery-loading">
            <div class="spinner" aria-hidden="true"></div>
            <p>Loading categories...</p>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeDiscovery();
      }
    });
    
    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeDiscovery();
      }
    });
    
    // Search listener
    document.getElementById('category-search').addEventListener('input', (e) => {
      filterCategories(e.target.value);
    });
  }

  function renderCategories(filterQuery = '') {
    const content = document.getElementById('discovery-content');
    if (!discoveryData) return;
    
    const categories = Object.entries(discoveryData.categories);
    const query = filterQuery.toLowerCase();
    
    // Filter categories
    const filteredCategories = query 
      ? categories.filter(([name]) => name.toLowerCase().includes(query))
      : categories;
    
    if (filteredCategories.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-title">No categories found</div>
          <div class="empty-state-text">Try a different search term</div>
        </div>
      `;
      return;
    }
    
    // Render category rows
    content.innerHTML = filteredCategories.map(([categoryName, sources]) => {
      return `
        <div class="category-row">
          <div class="category-header">
            <span class="category-name">${escapeHtml(categoryName)}</span>
            <span class="category-count">(${sources.length})</span>
          </div>
          <div class="sources-scroll">
            ${sources.map(source => renderSourceCard(source, categoryName)).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSourceCard(source, category) {
    const added = isSourceAlreadyAdded(source.url);
    const ariaLabel = added 
      ? `${source.name} already added to your sources`
      : `Add ${source.name} to your sources. Press Enter to add.`;
    
    return `
      <div class="source-card ${added ? 'added' : ''}" 
           data-source-url="${escapeHtml(source.url)}" 
           tabindex="${added ? '-1' : '0'}"
           role="button"
           aria-label="${escapeHtml(ariaLabel)}"
           aria-pressed="${added ? 'true' : 'false'}"
           onclick="window.addFromDiscovery('${escapeHtml(source.name)}', '${escapeHtml(source.url)}', '${escapeHtml(category)}')"
           onkeydown="if(event.key==='Enter' && !this.classList.contains('added')) { event.preventDefault(); this.click(); }">
        <div class="source-name">${escapeHtml(source.name)}</div>
        <div class="source-domain">${escapeHtml(source.domain)}</div>
        <button class="add-btn ${added ? 'added' : ''}" 
                aria-hidden="true"
                tabindex="-1"
                onclick="event.stopPropagation();">
          ${added ? '✓ Added' : '+ Add'}
        </button>
      </div>
    `;
  }

  function updateStats() {
    if (!discoveryData) return;
    
    const categoryCount = Object.keys(discoveryData.categories).length;
    const sourceCount = discoveryData.source_count || 0;
    const yourCount = typeof State !== 'undefined' ? State.getCount() : 0;
    
    document.getElementById('stat-categories').textContent = categoryCount;
    document.getElementById('stat-sources').textContent = sourceCount.toLocaleString();
    
    const yourStat = document.getElementById('stat-yours');
    yourStat.textContent = `${yourCount}/20`;
    
    // Add warning/full state colors
    yourStat.className = 'stat-value';
    if (yourCount >= 20) {
      yourStat.classList.add('full');
    } else if (yourCount >= 18) {
      yourStat.classList.add('warning');
    }
    
    // Show toast warning when approaching limit
    if (yourCount === 19) {
      showToast('⚠️ One source slot remaining (19/20)');
    }
  }

  function filterCategories(query) {
    renderCategories(query);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  function addSource(name, url, category) {
    // PREVENT RAPID-FIRE ADDING - Only one source at a time
    if (isAdding) {
      showToast('⏳ Please wait... adding source');
      return;
    }

    // Check if already added
    if (isSourceAlreadyAdded(url)) {
      showToast(`✓ ${name} is already in your sources`);
      return;
    }

    // Check limit
    if (typeof State !== 'undefined' && State.getCount() >= 20) {
      alert(`You've reached your 20-source limit.\n\nRemove a source to add: ${name}`);
      return;
    }

    // Set adding state - BLOCKS all other adds
    isAdding = true;
    disableAllAddButtons();
    updateSourceButton(url, 'adding'); // Show loading state

    // Auto-populate and add
    const nameInput = document.getElementById('new-source-name');
    const urlInput = document.getElementById('new-source-url');
    
    if (nameInput && urlInput) {
      nameInput.value = name;
      urlInput.value = url;
      
      if (typeof addSource === 'function') {
        // Call the existing addSource function
        window.addSource();
        
        // Analytics
        if (typeof Analytics !== 'undefined') {
          Analytics.track('source_added_from_discovery', {
            source_name: name,
            category: category,
            method: 'netflix_browse'
          });
        }
        
        showToast(`✓ ${name} added`);
        updateSourceButton(url, 'added');
        updateStats();
        
        // COOLDOWN: Wait 800ms before allowing next add
        setTimeout(() => {
          isAdding = false;
          enableAllAddButtons();
        }, 800);
      } else {
        // If addSource function doesn't exist, reset state
        isAdding = false;
        enableAllAddButtons();
      }
    } else {
      // If inputs don't exist, reset state
      isAdding = false;
      enableAllAddButtons();
    }
  }

  function isSourceAlreadyAdded(url) {
    if (typeof State === 'undefined') return false;
    return State.getSources().some(s => s.rss === url);
  }

  function updateSourceButton(url, state) {
    const card = document.querySelector(`[data-source-url="${url}"]`);
    if (!card) return;
    
    if (state === 'adding') {
      // Show loading state
      const btn = card.querySelector('.add-btn');
      if (btn) {
        btn.classList.add('adding');
        btn.textContent = '⏳ Adding...';
        btn.disabled = true;
      }
    } else if (state === 'added') {
      card.classList.add('added');
      const btn = card.querySelector('.add-btn');
      if (btn) {
        btn.classList.add('added');
        btn.classList.remove('adding');
        btn.textContent = '✓ Added';
        btn.disabled = true;
      }
    }
  }

  function disableAllAddButtons() {
    const buttons = document.querySelectorAll('.add-btn:not(.added)');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    });
  }

  function enableAllAddButtons() {
    const buttons = document.querySelectorAll('.add-btn:not(.added)');
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    });
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'discovery-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML.replace(/'/g, '&#39;');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MODAL CONTROL
  // ═══════════════════════════════════════════════════════════════════════

  function openDiscovery() {
    if (isOpen) return;
    
    var modal = document.getElementById('discovery-modal');
    if (!modal) {
      createModal();
    }
    
    // Load data if not loaded
    var loadPromise = discoveryData ? Promise.resolve() : loadDiscoveryData();
    
    loadPromise.then(function() {
      // Render
      renderCategories();
      updateStats();
      
      // Show modal
      var modalEl = document.getElementById('discovery-modal');
      modalEl.classList.add('show');
      isOpen = true;
      
      // Focus search
      setTimeout(function() {
        document.getElementById('category-search').focus();
      }, 100);
    }).catch(function(error) {
      console.error('Failed to open discovery:', error);
      alert('Failed to load discovery sources. Please try again.');
    });
  }

  function closeDiscovery() {
    const modal = document.getElementById('discovery-modal');
    if (modal) {
      modal.classList.remove('show');
    }
    isOpen = false;
    
    // Clear search
    const searchInput = document.getElementById('category-search');
    if (searchInput) {
      searchInput.value = '';
      renderCategories();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GLOBAL FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  window.openDiscovery = openDiscovery;
  window.closeDiscovery = closeDiscovery;
  window.addFromDiscovery = addSource;

  // ═══════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════

  function initialize() {
    console.log('🎬 Discovery (Netflix-style) initializing...');
    
    injectCSS();
    
    // Preload data in background
    loadDiscoveryData().then(function() {
      console.log('✓ Discovery data loaded');
    }).catch(function(err) {
      console.error('Discovery data load failed:', err);
    });
    
    console.log('✓ Discovery ready! Call openDiscovery() to show.');
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
