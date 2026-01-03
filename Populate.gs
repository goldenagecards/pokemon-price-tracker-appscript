/***** Populate.gs (USD version) *****/

// EDIT THESE PER WORKBOOK
const CFG = {
  GAME: 'pokemon',
  LANGUAGE: 'English',
  ALLOWED_TAB: 'AllowedSets',
  CATALOG_TAB: 'Catalog',
  PRICES_TAB: 'Prices',
  PAGE_LIMIT: 100,
  PAGE_SLEEP_MS: 100,
  BETWEEN_SET_MS: 200
};

function SYNC_POKEMON_ALLOWED_TO_PRICES() {
  const ss = SpreadsheetApp.getActive();

  const allowed = ss.getSheetByName(CFG.ALLOWED_TAB) || ss.insertSheet(CFG.ALLOWED_TAB);
  const catalog = ss.getSheetByName(CFG.CATALOG_TAB) || ss.insertSheet(CFG.CATALOG_TAB);
  const prices  = ss.getSheetByName(CFG.PRICES_TAB) || ss.insertSheet(CFG.PRICES_TAB);

  if (!allowed.getRange('A1').getValue()) {
    allowed.getRange('A1').setValue('Set Name (paste one per row starting A2)');
  }

  const setNames = allowed.getRange('A2:A').getValues().flat().map(v => String(v || '').trim()).filter(Boolean);
  if (!setNames.length) throw new Error('No set names found in ' + CFG.ALLOWED_TAB + '! Paste them starting A2.');

  // map set name -> id
  const nameToId = JTCG_RESOLVE_SET_IDS_(setNames, CFG.GAME);

  // write catalog header
  catalog.clear();
  const catHead = ['Card Name','Set','Number','Printing','Condition','Price (USD)'];
  catalog.getRange(1,1,1,catHead.length).setValues([catHead]);

  // fetch rows
  const allRows = [];
  setNames.forEach(n => {
    const id = nameToId[n];
    if (!id) {
      Logger.log('Could not resolve set: ' + n);
      return;
    }
    const rows = JTCG_FETCH_CARDS_FOR_SET_(id, {
      game: CFG.GAME,
      language: CFG.LANGUAGE,
      limit: CFG.PAGE_LIMIT,
      sleepMs: CFG.PAGE_SLEEP_MS
    });
    if (rows && rows.length) allRows.push(...rows);
    if (CFG.BETWEEN_SET_MS > 0) Utilities.sleep(CFG.BETWEEN_SET_MS);
  });

  if (allRows.length) {
    catalog.getRange(2,1,allRows.length,catHead.length).setValues(allRows);
  }

  buildPricesSummary_(catalog, prices, setNames);
}

function buildPricesSummary_(catalogSheet, pricesSheet, allowedSetOrder) {
  pricesSheet.clear();

  const data = catalogSheet.getDataRange().getValues();
  if (data.length < 2) {
    pricesSheet.getRange(1,1).setValue('No data yet.');
    return;
  }

  const head = data[0], rows = data.slice(1);
  const idx = {}; head.forEach((h,i)=> idx[h]=i);

  // use AllowedSets order for set sorting
  const setRank = {};
  (allowedSetOrder || []).forEach((nm, i) => setRank[nm] = i);

  const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const median = arr => {
    const a = (arr||[]).filter(v=>v!=null).sort((x,y)=>x-y);
    if (!a.length) return '';
    const m = Math.floor(a.length/2);
    return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
  };
  const round2 = x => (x === '' ? '' : Math.round(x * 100) / 100);

  const normCond = raw => {
    const s = String(raw||'').trim().toLowerCase();
    if (s==='nm' || s.startsWith('near')) return 'NM';
    if (s==='lp' || s.startsWith('light')) return 'LP';
    if (s==='mp' || s.startsWith('moder')) return 'MP';
    if (s==='hp' || s.includes('heav')) return 'HP';
    if (s==='dm' || s==='dmg' || s.includes('damag')) return 'DM';
    return null;
  };

  // group by card+set+number+printing, collect prices per condition
  const groups = {};
  rows.forEach(r => {
    const card = r[idx['Card Name']] || '';
    const set  = r[idx['Set']] || '';
    const num  = r[idx['Number']] || '';
    const pr   = r[idx['Printing']] || '';
    const cond = normCond(r[idx['Condition']]);
    const price = toNum(r[idx['Price (USD)']]);
    if (!cond || price == null) return;

    const key = [card,set,num,pr].join('||');
    if (!groups[key]) groups[key] = { card, set, num, pr, by: {NM:[],LP:[],MP:[],HP:[],DM:[]} };
    groups[key].by[cond].push(price);
  });

  // natural sort of number (e.g., 4 < 10 < 10a)
  const naturalNum = s => {
    const m = String(s||'').match(/^(\d+)([a-z]*)$/i);
    return m ? {n:Number(m[1]), t:(m[2]||'')} : {n:1e9, t:String(s||'')};
  };

  // sort by card name, then set by allowed order (fallback alpha), then number, then printing
  const sorted = Object.values(groups).sort((a,b) => {
    const c = String(a.card).localeCompare(String(b.card), undefined, {sensitivity:'base'});
    if (c) return c;

    const ra = (a.set in setRank) ? setRank[a.set] : 1e9;
    const rb = (b.set in setRank) ? setRank[b.set] : 1e9;
    if (ra !== rb) return ra - rb;

    if (ra === 1e9) {
      const cs = String(a.set).localeCompare(String(b.set), undefined, {sensitivity:'base'});
      if (cs) return cs;
    }

    const na = naturalNum(a.num), nb = naturalNum(b.num);
    if (na.n !== nb.n) return na.n - nb.n;
    if (na.t !== nb.t) return na.t.localeCompare(nb.t);

    return String(a.pr).localeCompare(String(b.pr), undefined, {sensitivity:'base'});
  });

  // Output: 2 rows per card entry
  const outHead = ['Card Name','Set','Number','Printing','NM','LP','MP','HP','DM'];
  pricesSheet.getRange(1,1,1,outHead.length).setValues([outHead]);
  pricesSheet.setFrozenRows(1);

  const out = [];
  const greenRows = [];

  const low = x => (x === '' ? '' : round2(x * 0.70));

  sorted.forEach(g => {
    const medNM = round2(median(g.by.NM));
    const medLP = round2(median(g.by.LP));
    const medMP = round2(median(g.by.MP));
    const medHP = round2(median(g.by.HP));
    const medDM = round2(median(g.by.DM));

    out.push([g.card, g.set, g.num, g.pr, medNM, medLP, medMP, medHP, medDM]);

    // compute sheet row index for the 70% row (header is row 1, out begins at row 2)
    const nextSheetRow = 1 + out.length + 1;
    greenRows.push(nextSheetRow);

    out.push(['','','','', low(medNM), low(medLP), low(medMP), low(medHP), low(medDM)]);
  });

  if (out.length) pricesSheet.getRange(2,1,out.length,outHead.length).setValues(out);

  // format currency columns
  const lastRow = pricesSheet.getLastRow();
  if (lastRow >= 2) pricesSheet.getRange(2,5,lastRow-1,5).setNumberFormat('$#,##0.00');

  // shade the 70% rows
  greenRows.forEach(r => pricesSheet.getRange(r,1,1,outHead.length).setBackground('#e6ffe6'));
}
