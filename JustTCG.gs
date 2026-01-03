/***** JustTCG.gs (USD version) *****/

const JTCG_BASE = 'https://api.justtcg.com/v1';

// Read API key from Script Properties
function JTCG_HEADERS() {
  const key = PropertiesService.getScriptProperties().getProperty('JUSTTCG_API_KEY');
  if (!key) throw new Error('JUSTTCG_API_KEY is not set in Script Properties.');
  return { 'X-API-Key': key, 'Accept': 'application/json' };
}

// Build query string manually (works in all runtimes)
function buildQuery_(params) {
  params = params || {};
  const out = [];
  for (var k in params) {
    if (!params.hasOwnProperty(k)) continue;
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return out.length ? ('?' + out.join('&')) : '';
}

// Helper to read integer script properties with a default
function getPropInt_(name, defVal) {
  const v = Number(PropertiesService.getScriptProperties().getProperty(name));
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : defVal;
}

// Minimal GET with steady throttle + exponential backoff, honoring Retry-After
function jtcgFetch_(path, params) {
  const url = JTCG_BASE + path + buildQuery_(params);
  const headers = Object.assign({ 'Accept': 'application/json' }, JTCG_HEADERS());

  // Steady throttle between ALL requests (default 120ms; raise if you see 429s)
  const baseSleepMs = getPropInt_('JUSTTCG_SLEEP_MS', 120);

  let attempt = 0;
  while (attempt < 6) {
    if (baseSleepMs > 0) Utilities.sleep(baseSleepMs);

    const resp = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
    const code = resp.getResponseCode();

    // Success
    if (code >= 200 && code < 300) {
      return JSON.parse(resp.getContentText());
    }

    // Retryable? (rate limits / server errors)
    if (code === 429 || (code >= 500 && code < 600)) {
      const hdrs = resp.getAllHeaders && resp.getAllHeaders();
      const retryAfterSec = hdrs && (Number(hdrs['Retry-After']) || Number(hdrs['retry-after'])) || 0;

      // Exponential backoff + jitter; ensure at least Retry-After
      const exp = Math.min(8000, Math.pow(2, attempt) * 400); // 0.4s,0.8s,1.6s,... cap 8s
      const waitMs = Math.max(retryAfterSec * 1000, exp) + Math.floor(Math.random() * 150);

      Utilities.sleep(waitMs);
      attempt++;
      continue;
    }

    // Non-retryable error
    throw new Error('JustTCG error ' + code + ': ' + resp.getContentText());
  }

  throw new Error('Exceeded retries on JustTCG API (429/5xx).');
}

// Resolve set names -> set IDs (exact match, fallback to contains)
function JTCG_RESOLVE_SET_IDS_(names, game) {
  game = game || 'pokemon';
  const res = jtcgFetch_('/sets', { game: game });
  const sets = (res && res.data) ? res.data : [];
  const byLower = {};

  sets.forEach(s => {
    const nm = String(s.name || s.set_name || '').trim().toLowerCase();
    if (nm) byLower[nm] = s;
  });

  const mapping = {};
  names.forEach(raw => {
    const name = String(raw || '').trim();
    if (!name) return;
    const lower = name.toLowerCase();
    let hit = byLower[lower];
    if (!hit) hit = sets.find(s => String(s.name || s.set_name || '').toLowerCase().includes(lower));
    if (hit) mapping[name] = hit.id;
  });

  return mapping;
}

// Fetch cards for a set (light payload, USD prices)
function JTCG_FETCH_CARDS_FOR_SET_(setId, opts) {
  opts = opts || {};
  const game = opts.game || 'pokemon';
  const language = opts.language || 'English';

  const limitProp = getPropInt_('JUSTTCG_LIMIT', 100);
  const LIMIT = Math.max(1, Math.min(Number(opts.limit || limitProp || 100), 100));
  const SLEEP = Number(opts.sleepMs || getPropInt_('JUSTTCG_PAGE_SLEEP_MS', 100));

  let offset = 0;
  const rows = [];

  while (true) {
    const resp = jtcgFetch_('/cards', {
      game: game,
      set: setId,
      limit: LIMIT,
      offset: offset
    });

    const cards = (resp && resp.data) || [];
    if (!cards.length) break;

    cards.forEach(card => {
      const name = card.name || '';
      const setName = card.set_name || card.set || '';
      const number = card.number || '';
      const variants = card.variants || [];

      variants
        .filter(v => !language || (v.language || 'English') === language)
        .forEach(v => {
          const priceUsd = (v.price != null) ? Number(v.price) : '';
          rows.push([
            name,             // Card Name
            setName,          // Set
            number,           // Number
            v.printing || '', // Printing
            v.condition || '',// Condition
            priceUsd          // Price (USD)
          ]);
        });
    });

    if (cards.length < LIMIT) break;
    offset += LIMIT;
    if (SLEEP > 0) Utilities.sleep(SLEEP);
  }

  return rows;
}
