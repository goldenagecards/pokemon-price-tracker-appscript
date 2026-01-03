/***** Menu.gs (USD version) *****/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JustTCG')
    .addItem('Sync Prices (Now)', 'SYNC_POKEMON_ALLOWED_TO_PRICES')
    .addSeparator()
    .addItem('Rebuild Prices (from Catalog)', 'REBUILD_FROM_CATALOG_')
    .addToUi();
}

function REBUILD_FROM_CATALOG_() {
  const ss = SpreadsheetApp.getActive();
  const allowed = ss.getSheetByName(CFG.ALLOWED_TAB);
  const catalog = ss.getSheetByName(CFG.CATALOG_TAB);
  const prices  = ss.getSheetByName(CFG.PRICES_TAB);
  if (!allowed || !catalog || !prices) throw new Error('Missing one or more tabs: AllowedSets, Catalog, Prices.');
  const setNames = allowed.getRange('A2:A').getValues().flat().map(v => String(v || '').trim()).filter(Boolean);
  buildPricesSummary_(catalog, prices, setNames);
}
