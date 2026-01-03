# Pokémon Price Tracker (Google Sheets)

A Google Apps Script project that pulls live Pokémon card prices from the JustTCG API
and builds a fast, show-friendly pricing sheet.

## Features
- Median live pricing per condition (NM / LP / MP / HP / DM)
- Automatic 70% buy price rows (highlighted)
- Sorted for fast buying at card shows
- Uses Google Sheets as the UI
- No external servers required

## Tech Stack
- Google Apps Script (JavaScript)
- Google Sheets
- JustTCG API

## Setup
1. Create a Google Sheet
2. Extensions → Apps Script
3. Paste the `.gs` files into the editor
4. Add your JustTCG API key:
   - Project Settings → Script Properties
   - Key: `JUSTTCG_API_KEY`
5. Reload the sheet and use the `JustTCG` menu

## Notes
- Prices are pulled in USD
- API key is not stored in code

