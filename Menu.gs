/***** Menu.gs (no triggers; one-click manual run) *****/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JustTCG')
    .addItem('Sync This File (Now)', 'SYNC_THIS_FILE_NOW')
    .addToUi();
}
