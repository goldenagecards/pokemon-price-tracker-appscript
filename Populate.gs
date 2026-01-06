/***** Populate.gs (single-shot sync; no triggers) *****/

const CONFIG = {
  WORKBOOK_LABEL: 'Gen1-3',          // <- change per file
  GAME: 'pokemon',
  ALLOWED_SHEET: 'AllowedSets',
  CATALOG_SHEET: 'Catalog',
  PRICES_SHEET: 'Prices',
  DELETE_CATALOG_AFTER_BUILD: false,
  MAX_SETS: 9999,
  PAGE_LIMIT: 100,
  PAGE_SLEEP_MS: 100,
  SET_SLEEP_MS: 200,
};

const NUM = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const MED = arr => { const a=(arr||[]).filter(v=>v!=null).sort((x,y)=>x-y); if (!a.length) return ''; const m=Math.floor(a.length/2); return (a.length%2)?a[m]:(a[m-1]+a[m])/2; };
const ROUND$ = n => (n==='' ? '' : Math.round(n*100)/100);

function recreateSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  return ss.insertSheet(name);
}

function shrinkSheetToData_(sheet, minCols) {
  const lastRow = Math.max(1, sheet.getLastRow());
  const lastCol = Math.max(minCols || 1, sheet.getLastColumn());
  const maxRows = sheet.getMaxRows();
  const maxCols = sheet.getMaxColumns();
  if (maxRows > lastRow) sheet.deleteRows(lastRow + 1, maxRows - lastRow);
  if (maxCols > lastCol) sheet.deleteColumns(lastCol + 1, maxCols - lastCol);
}

function readAllowedSetNames_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.ALLOWED_SHEET) || ss.insertSheet(CONFIG.ALLOWED_SHEET);
  if (!sh.getRange('A1').getValue()) {
    sh.getRange('A1').setValue('Set Name');
  }
  const names = sh.getRange('A2:A').getValues().flat()
    .map(v => String(v||'').trim()).filter(Boolean);
  return names.slice(0, CONFIG.MAX_SETS);
}

function buildPricesSummary_() {
  const ss = SpreadsheetApp.getActive();
  const cat = ss.getSheetByName(CONFIG.CATALOG_SHEET);
  if (!cat) throw new Error('Missing sheet: ' + CONFIG.CATALOG_SHEET);

  const allowedOrder = readAllowedSetNames_();
  const setRank = {};
  allowedOrder.forEach((name, i) => setRank[name] = i);

  const out = (function recreate(name){
    const existing = ss.getSheetByName(name);
    if (existing) ss.deleteSheet(existing);
    return ss.insertSheet(name);
  })(CONFIG.PRICES_SHEET);

  const data = cat.getDataRange().getValues();
  if (!data.length) return;

  const head = data[0], rows = data.slice(1);
  const idx = {}; head.forEach((h,i)=> idx[h]=i);

  const normCond = raw => {
    const s = String(raw||'').trim().toLowerCase();
    if (!s) return null;
    if (s==='nm' || s.startsWith('near')) return 'NM';
    if (s==='lp' || s.startsWith('light')) return 'LP';
    if (s==='mp' || s.startsWith('moder')) return 'MP';
    if (s==='hp' || s.includes('heav')) return 'HP';
    if (s==='dm' || s==='dmg' || s.includes('damag')) return 'DM';
    return null;
  };

  const keyFields = ['Card Name','Set','Number','Printing'];
  const groups = {};
  rows.forEach(r => {
    const cond = normCond(r[idx['Condition']]);
    if (!cond) return;
    const key = keyFields.map(k => String(r[idx[k]] || '')).join('||');
    if (!groups[key]) {
      groups[key] = {
        ref: keyFields.map(k => r[idx[k]] || ''),
        by: { NM:[], LP:[], MP:[], HP:[], DM:[] }
      };
    }
    const priceCad = NUM(r[idx['Price (CAD)']]);
    if (priceCad != null) groups[key].by[cond].push(priceCad);
  });

  const naturalNum = s => {
    const m = String(s||'').match(/^(\d+)([a-z]*)$/i);
    return m ? {n: Number(m[1]), t: (m[2]||'')} : {n: Number.POSITIVE_INFINITY, t: String(s||'')};
  };

  const sorted = Object.values(groups).sort((g1, g2) => {
    const [name1,set1,num1,print1] = g1.ref;
    const [name2,set2,num2,print2] = g2.ref;
    const cmpName = String(name1).localeCompare(String(name2), undefined, {sensitivity:'base'});
    if (cmpName) return cmpName;

    const r1 = (set1 in setRank) ? setRank[set1] : 1e9;
    const r2 = (set2 in setRank) ? setRank[set2] : 1e9;
    if (r1 !== r2) return r1 - r2;

    const a = naturalNum(num1), b = naturalNum(num2);
    if (a.n !== b.n) return a.n - b.n;
    if (a.t !== b.t) return a.t.localeCompare(b.t);
    return String(print1||'').localeCompare(String(print2||''), undefined, {sensitivity:'base'});
  });

  const header = ['Card Name','Set','Number','Printing','NM','LP','MP','HP','DM'];
  out.getRange(1,1,1,header.length).setValues([header]);

  const outRows = [];
  const greenRows = [];
  sorted.forEach(g => {
    const med = {};
    ['NM','LP','MP','HP','DM'].forEach(c => {
      const m = MED(g.by[c]);
      med[c] = (m==='' ? '' : ROUND$(m));
    });

    outRows.push([g.ref[0], g.ref[1], g.ref[2], g.ref[3], med.NM, med.LP, med.MP, med.HP, med.DM]);

    const low = {};
    ['NM','LP','MP','HP','DM'].forEach(c => {
      low[c] = (med[c]==='' ? '' : ROUND$(med[c]*0.70));
    });
    const nextRow = 1 + outRows.length + 1;
    greenRows.push(nextRow);
    outRows.push(['','','','', low.NM, low.LP, low.MP, low.HP, low.DM]);
  });

  if (outRows.length) {
    out.getRange(2,1,outRows.length,header.length).setValues(outRows);
    greenRows.forEach(r => out.getRange(r,1,1,header.length).setBackground('#e6ffe6'));
  }

  out.setFrozenRows(1);
  const lastRow = out.getLastRow();
  if (lastRow >= 2) {
    out.getRange(2,5,lastRow-1,5).setNumberFormat('$#,##0.00');
  }
  const lastCol = header.length;
  const maxRows = out.getMaxRows();
  const maxCols = out.getMaxColumns();
  if (maxRows > lastRow) out.deleteRows(lastRow + 1, maxRows - lastRow);
  if (maxCols > lastCol) out.deleteColumns(lastCol + 1, maxCols - lastCol);
}

function SYNC_THIS_FILE_NOW() {
  const start = Date.now();
  const ss = SpreadsheetApp.getActive();
  SpreadsheetApp.getActiveSpreadsheet().toast(`${CONFIG.WORKBOOK_LABEL}: syncing…`, 'JustTCG', 3);

  const names = readAllowedSetNames_();
  if (!names.length) throw new Error('No set names in AllowedSets!A:A.');

  const map = JTCG_RESOLVE_SET_IDS_(names, CONFIG.GAME);
  const ids = names.map(n => map[n]).filter(Boolean);

  const cat = recreateSheet_(CONFIG.CATALOG_SHEET);

  // UPDATED headers (12 columns; live-only)
  const headers = [
    'Game','Card Name','Set','Number','Printing','Condition',
    'Price (CAD)','Last Updated','TCGplayer ID','Card ID','Variant ID','Language'
  ];
  cat.getRange(1,1,1,headers.length).setValues([headers]);
  shrinkSheetToData_(cat, headers.length);

  ids.forEach((setId, idx) => {
    const rows = JTCG_FETCH_CARDS_FOR_SET_(setId, {
      game: CONFIG.GAME,
      language: 'English',
      limit: CONFIG.PAGE_LIMIT,
      sleepMs: CONFIG.PAGE_SLEEP_MS
    });
    if (rows && rows.length) {
      const startRow = Math.max(2, cat.getLastRow() + 1);
      cat.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
      shrinkSheetToData_(cat, headers.length);
    }
    if (CONFIG.SET_SLEEP_MS > 0) Utilities.sleep(CONFIG.SET_SLEEP_MS);
  });

  buildPricesSummary_();

  if (CONFIG.DELETE_CATALOG_AFTER_BUILD) {
    const catSheet = ss.getSheetByName(CONFIG.CATALOG_SHEET);
    if (catSheet) ss.deleteSheet(catSheet);
  }

  const secs = Math.round((Date.now() - start)/1000);
  SpreadsheetApp.getActiveSpreadsheet().toast(`${CONFIG.WORKBOOK_LABEL}: done in ${secs}s`, 'JustTCG', 5);
}
