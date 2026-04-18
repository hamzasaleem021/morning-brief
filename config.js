// ═══════════════════════════════════════════════════════════════════════
// Morning Brief — Configuration
// Loaded before everything else. Fork-friendly: change values here only.
// ═══════════════════════════════════════════════════════════════════════

window.MB_CONFIG = Object.freeze({
  // ── External services (replace with your own when self-hosting) ──────
  RSS_PROXY:   'https://morning-brief-proxy.hamzasaleem021.workers.dev/?url=',
  SUPABASE_URL: 'https://tsxesheoelbfkhqjpfcu.supabase.co',
  SUPABASE_KEY: 'sb_publishable_BBvieHYmC9Xg1SkftJD6Aw_cms0V0dm',

  // ── Analytics (null to disable entirely) ─────────────────────────────
  // NOTE: If you enable Amplitude, you MUST also update the privacy page
  // and the welcome-screen copy to disclose tracking.
  AMPLITUDE_KEY: null,

  // ── External domains the service worker should NEVER cache ───────────
  EXTERNAL_API_HOSTS: [
    'workers.dev',
    'supabase.co',
    'googleapis',
    'accounts.google',
    'fonts.googleapis',
    'fonts.gstatic',
    'amplitude.com'
  ],

  // ── LocalStorage keys ────────────────────────────────────────────────
  STORAGE_KEY:         'morning_brief_sources',
  ORDER_KEY:           'morning_brief_order',
  THEME_KEY:           'morning_brief_theme',
  SESSION_COUNT_KEY:   'morning_brief_session_count',
  LAST_SESSION_KEY:    'morning_brief_last_session',
  INSTALL_DISMISSED_KEY: 'morning_brief_install_dismissed',
  ANALYTICS_OPTOUT_KEY: 'morning_brief_analytics_optout',
  VOUCHER_LIMIT_KEY:   'morning_brief_voucher_limit',

  // ── Behavior tuning ──────────────────────────────────────────────────
  MAX_SOURCES:       20,
  MAX_SOURCES_HARD_CAP: 200,  // ceiling even voucher codes can't exceed
  FETCH_TIMEOUT:     5000,
  FETCH_CONCURRENCY: 5,
  ARTICLES_PER_SOURCE: 5,

  // ── Voucher codes ────────────────────────────────────────────────────
  // Map of SHA-256 hashed codes to the limit they unlock.
  // Hashing is obscurity, not security — but fine for a personal tool.
  // To add a new code: run `sha256('YOURCODE')` and paste the hex here.
  //   MANOTUTU -> 50
  VOUCHERS: {
    // SHA-256('MANOTUTU') → 50 sources
    'fd021c1c743deec215e7183e575fb545411dce6dd130f76555cb3ce21eb710ae': 50
  },

  // Install prompt trigger: show after Nth session AND Mth source
  INSTALL_MIN_SESSIONS: 2,
  INSTALL_MIN_SOURCES:  3,
  SESSION_IDLE_MS:      30 * 60 * 1000, // 30 min

  // ── Starter pack — curated first-run set ─────────────────────────────
  STARTER_PACK: [
    { name: 'The Verge',              url: 'https://www.theverge.com/rss/index.xml',        domain: 'theverge.com' },
    { name: 'Ars Technica',           url: 'https://feeds.arstechnica.com/arstechnica/index', domain: 'arstechnica.com' },
    { name: 'Foreign Policy',         url: 'https://foreignpolicy.com/feed/',                domain: 'foreignpolicy.com' },
    { name: 'NASA Breaking News',     url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', domain: 'nasa.gov' },
    { name: 'Longreads',              url: 'https://longreads.com/feed/',                    domain: 'longreads.com' },
    { name: 'Roger Ebert',            url: 'https://www.rogerebert.com/feed',                domain: 'rogerebert.com' }
  ],

  // ── Curated bundles (Tier 1.7) ───────────────────────────────────────
  BUNDLES: [
    {
      name: 'Morning News',
      description: 'Global affairs and geopolitics, one pass every morning.',
      sources: [
        { name: 'Foreign Policy',  url: 'https://foreignpolicy.com/feed/',    domain: 'foreignpolicy.com' },
        { name: 'The Diplomat',    url: 'https://thediplomat.com/feed/',      domain: 'thediplomat.com' },
        { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml', domain: 'aljazeera.com' },
        { name: 'Foreign Affairs', url: 'https://www.foreignaffairs.com/rss.xml', domain: 'foreignaffairs.com' }
      ]
    },
    {
      name: 'Tech Weekly',
      description: 'What shipped, what broke, what matters.',
      sources: [
        { name: 'The Verge',     url: 'https://www.theverge.com/rss/index.xml',          domain: 'theverge.com' },
        { name: 'Ars Technica',  url: 'https://feeds.arstechnica.com/arstechnica/index', domain: 'arstechnica.com' },
        { name: 'Wired',         url: 'https://www.wired.com/feed/rss',                  domain: 'wired.com' },
        { name: 'Engadget',      url: 'https://www.engadget.com/rss.xml',                domain: 'engadget.com' },
        { name: 'TechCrunch',    url: 'https://techcrunch.com/feed/',                    domain: 'techcrunch.com' }
      ]
    },
    {
      name: 'Long Reads',
      description: 'Essays and features worth your Saturday.',
      sources: [
        { name: 'Longreads',          url: 'https://longreads.com/feed/',           domain: 'longreads.com' },
        { name: 'Longform',           url: 'https://longform.org/feed.xml',         domain: 'longform.org' },
        { name: 'Arts & Letters Daily', url: 'https://www.aldaily.com/rss/all/',    domain: 'aldaily.com' },
        { name: 'The New York Review', url: 'https://www.nybooks.com/feed/',        domain: 'nybooks.com' }
      ]
    }
  ]
});
