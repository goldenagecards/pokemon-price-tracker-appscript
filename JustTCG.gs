/***** JustTCG.gs (shared helpers) *****/

const JTCG_BASE = 'https://api.justtcg.com/v1';

function PURGE_ALL_TRIGGERS_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); n++; });
  SpreadsheetApp.getUi().alert('Deleted ' + n + ' triggers in this project.');
}

function JTCG_HEADERS() {
  const key = PropertiesService.getScriptProperties().getProperty('JUSTTCG_API_KEY');
  if (!key) throw new Error('JUSTTCG_API_KEY is not set in Script Properties.');
  return { 'X-API-Key': key, 'Accept': 'application/json' };
}

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

function getPropInt_(name, defVal) {
  const v = Number(PropertiesService.getScriptProperties().getProperty(name));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : defVal;
}

function getUsdToCad_() {
  const sp = PropertiesService.getScriptProperties();
  const override = Number(sp.getProperty('OVERRIDE_USD_TO_CAD'));
  if (override && isFinite(override) && override > 0) return override;

  const cached = Number(sp.getProperty('FX_USD_CAD'));
  const ts = Number(sp.getProperty('FX_USD_CAD_TS')) || 0;
  if (cached && isFinite(cached) && (Date.now() - ts) < 24*60*60*1000) return cached;

  const resp = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/USD', { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('FX API error: ' + resp.getContentText());
  const json = JSON.parse(resp.getContentText());
  const rate = Number(json && json.rates && json.rates.CAD);
  if (!rate || !isFinite(rate)) throw new Error('FX API missing CAD rate.');
  sp.setProperty('FX_USD_CAD', String(rate));
  sp.setProperty('FX_USD_CAD_TS', String(Date.now()));
  return rate;
}

function jtcgFetch_(path, params) {
  const url = JTCG_BASE + path + buildQuery_(params);
  const headers = Object.assign({ 'Accept': 'application/json' }, JTCG_HEADERS());
  const baseSleepMs = getPropInt_('JUSTTCG_SLEEP_MS', 150);

  let attempt = 0;
  while (attempt < 6) {
    if (baseSleepMs > 0) Utilities.sleep(baseSleepMs);

    const resp = UrlFetchApp.fetch(url, { method: 'get', headers, muteHttpExceptions: true });
    const code = resp.getResponseCode();

    if (code >= 200 && code < 300) return JSON.parse(resp.getContentText());

    if (code === 429 || (code >= 500 && code < 600)) {
      const hdrs = resp.getAllHeaders && resp.getAllHeaders();
      const retryAfterSec = hdrs && (Number(hdrs['Retry-After']) || Number(hdrs['retry-after'])) || 0;
      const exp = Math.min(8000, Math.pow(2, attempt) * 400);
      const waitMs = Math.max(retryAfterSec * 1000, exp) + Math.floor(Math.random() * 150);
      Utilities.sleep(waitMs);
      attempt++;
      continue;
    }
    throw new Error('JustTCG error ' + code + ': ' + resp.getContentText());
  }
  throw new Error('Exceeded retries on JustTCG API (429/5xx).');
}

function JTCG_RESOLVE_SET_IDS_(names, game) {
  game = game || 'pokemon';
  const res = jtcgFetch_('/sets', { game });
  const sets = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
  const byLower = {};
  sets.forEach(s => byLower[(s.name || s.set_name || '').toLowerCase()] = s);
  const mapping = {};

  names.forEach(raw => {
    const name = String(raw || '').trim();
    if (!name) return;
    let hit = byLower[name.toLowerCase()];
    if (!hit) hit = sets.find(s => ((s.name || s.set_name || '') + '').toLowerCase().includes(name.toLowerCase()));
    if (hit) mapping[name] = hit.id;
  });
  return mapping;
}

/**
 * LIVE PRICE ONLY (no include_statistics)
 * Returns rows with these 12 columns:
 *  Game, Card Name, Set, Number, Printing, Condition,
 *  Price (CAD), Last Updated, TCGplayer ID, Card ID, Variant ID, Language
 */
function JTCG_FETCH_CARDS_FOR_SET_(setId, opts) {
  opts = opts || {};
  const game = opts.game || 'pokemon';
  const language = opts.language || 'English';

  const limitProp = getPropInt_('JUSTTCG_LIMIT', 100);
  const LIMIT = Math.max(1, Math.min(Number(opts.limit || limitProp || 100), 100));
  const SLEEP = Number(opts.sleepMs || getPropInt_('JUSTTCG_PAGE_SLEEP_MS', 100));
  const fx = getUsdToCad_();

  let offset = 0;
  const rows = [];

  while (true) {
    const resp = jtcgFetch_('/cards', {
      game, set: setId, limit: LIMIT, offset
    });

    const cards = (resp && resp.data) || [];
    if (!cards.length) break;

    cards.forEach(card => {
      const name = card.name || '';
      const setName = card.set_name || card.set || '';
      const number = card.number || '';
      const tcgplayerId = card.tcgplayerId || card.tcgplayer_id || '';
      const cardId = card.id || '';
      const variants = card.variants || [];

      variants
        .filter(v => !language || (v.language || 'English') === language)
        .forEach(v => {
          const priceCad = (v.price != null) ? Number(v.price) * fx : '';
          rows.push([
            game.charAt(0).toUpperCase() + game.slice(1),
            name, setName, number,
            v.printing || '', v.condition || '',
            priceCad, v.lastUpdated ? new Date(v.lastUpdated * 1000) : '',
            tcgplayerId, cardId, v.id || '', v.language || ''
          ]);
        });
    });

    if (cards.length < LIMIT) break;
    offset += LIMIT;
    if (SLEEP > 0) Utilities.sleep(SLEEP);
  }
  return rows;
}
