// ═══════════════════════════════════════════════════════════════════════
// Morning Brief — OPML Import / Export
// Standalone module, same pattern as discovery.js / clippings.js.
// Talks to the app only through window.MB.sources (bridge exposed in
// morning-brief.html). All adds flow State → Persist → Sync → UI via the
// importSources orchestrator — this file never touches State directly.
// ═══════════════════════════════════════════════════════════════════════
(() => {
  'use strict';

  // ── XML helpers ─────────────────────────────────────────────────────

  function xmlEsc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // OPML in the wild is messy: xmlUrl / xmlurl / XMLURL all exist.
  // XML getAttribute is case-sensitive, so scan attributes ourselves.
  function attrCI(el, name) {
    const want = name.toLowerCase();
    for (const a of el.attributes) {
      if (a.name.toLowerCase() === want) return a.value;
    }
    return null;
  }

  function normalizeUrl(u) {
    return String(u || '').trim().replace(/\/+$/, '');
  }

  // ── Parse an OPML string → [{ name, rss }] ──────────────────────────
  // Returns { ok, feeds } or { ok: false, reason }
  function parseOPML(text) {
    let xml;
    try {
      xml = new DOMParser().parseFromString(text, 'text/xml');
    } catch (e) {
      return { ok: false, reason: 'parse' };
    }
    if (xml.querySelector('parsererror')) return { ok: false, reason: 'parse' };

    const outlines = Array.from(xml.getElementsByTagName('outline'));
    if (!outlines.length) return { ok: false, reason: 'empty' };

    const seen = new Set();
    const feeds = [];
    for (const o of outlines) {
      const rss = String(attrCI(o, 'xmlUrl') || '').trim();
      if (!rss) continue;                       // folder/category node — skip
      try { new URL(rss); } catch { continue; } // malformed URL — skip
      const key = normalizeUrl(rss);            // dedupe key only — store the
      if (seen.has(key)) continue;              // original URL untouched
      seen.add(key);

      let name = (attrCI(o, 'title') || attrCI(o, 'text') || '').trim();
      if (!name) {
        try { name = new URL(rss).hostname.replace(/^www\./i, ''); }
        catch { name = rss; }
      }
      feeds.push({ name, rss });
    }

    if (!feeds.length) return { ok: false, reason: 'empty' };
    return { ok: true, feeds };
  }

  // ── Import flow ─────────────────────────────────────────────────────

  async function handleImportFile(file) {
    const MB = window.MB && window.MB.sources;
    if (!MB) return;

    let text;
    try { text = await file.text(); }
    catch (e) { MB.toast("Couldn't read that file."); return; }

    const parsed = parseOPML(text);
    if (!parsed.ok) {
      MB.toast(parsed.reason === 'empty'
        ? 'No feeds found in that file.'
        : "That doesn't look like a valid OPML file.");
      return;
    }

    // Pre-filter feeds we already have so the confirm copy is honest.
    // Compare on normalized URLs (trailing-slash-insensitive) but keep
    // the original URL for storage and fetching.
    const existing = new Set(MB.list().map(s => normalizeUrl(s.rss)));
    const fresh = parsed.feeds.filter(f => !existing.has(normalizeUrl(f.rss)));
    const alreadyHave = parsed.feeds.length - fresh.length;

    if (!fresh.length) {
      MB.toast(`All ${parsed.feeds.length} feeds in that file are already in your brief.`);
      return;
    }

    const room = Math.max(0, MB.limit() - MB.count());
    if (room === 0) {
      MB.toast('Your source list is full.', {
        duration: 5000, actionText: 'Redeem a code', action: () => MB.promptVoucher()
      });
      return;
    }

    const toImport = fresh.slice(0, room);
    const overflow = fresh.length - toImport.length;

    const msg = overflow > 0
      ? `Found ${fresh.length} new feeds, but you have room for ${room}. Import the first ${room}?`
      : `Import ${toImport.length} feed${toImport.length === 1 ? '' : 's'} from this file?`;
    const ok = await MB.confirm(msg, { okText: 'Import', cancelText: 'Cancel' });
    if (!ok) return;

    const result = await MB.importSources(toImport);

    const bits = [];
    if (result.added) bits.push(`Imported ${result.added} source${result.added === 1 ? '' : 's'}`);
    if (alreadyHave || result.dupes) bits.push(`${alreadyHave + result.dupes} already added`);
    if (overflow || result.limited) bits.push(`${overflow + result.limited} over your limit`);

    if (overflow || result.limited) {
      MB.toast(bits.join(' · '), {
        duration: 6000, actionText: 'Redeem a code', action: () => MB.promptVoucher()
      });
    } else {
      MB.toast(bits.join(' · ') || 'Nothing to import.', { duration: 4000 });
    }
  }

  // ── Export flow ─────────────────────────────────────────────────────

  function buildOPML(sources) {
    const now = new Date().toUTCString();
    const lines = sources.map(s => {
      const html = s.domain ? `https://${s.domain}` : '';
      return `    <outline type="rss" text="${xmlEsc(s.name)}" title="${xmlEsc(s.name)}" xmlUrl="${xmlEsc(s.rss)}"${html ? ` htmlUrl="${xmlEsc(html)}"` : ''}/>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Morning Brief sources</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${lines.join('\n')}
  </body>
</opml>
`;
  }

  function handleExport() {
    const MB = window.MB && window.MB.sources;
    if (!MB) return;
    const sources = MB.list();
    if (!sources.length) { MB.toast('Nothing to export yet — add a source first.'); return; }

    const blob = new Blob([buildOPML(sources)], { type: 'text/x-opml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `morning-brief-sources-${stamp}.opml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    MB.toast(`Exported ${sources.length} source${sources.length === 1 ? '' : 's'}.`);
  }

  // ── Wiring ──────────────────────────────────────────────────────────

  function init() {
    const importBtn = document.getElementById('opml-import-btn');
    const exportBtn = document.getElementById('opml-export-btn');
    if (!importBtn || !exportBtn) return; // markup not present — fail quiet

    // Hidden file input, created once.
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.opml,.xml,text/xml,text/x-opml,application/xml';
    picker.style.display = 'none';
    document.body.appendChild(picker);

    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      picker.value = ''; // allow re-selecting the same file
      if (file) handleImportFile(file);
    });

    importBtn.addEventListener('click', () => picker.click());
    exportBtn.addEventListener('click', handleExport);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
