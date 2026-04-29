/**
 * Google Sheets - Read only (no auth).
 * Sheet must be shared as "Anyone with the link can view".
 * Output is always written to local CSV.
 */

const fetch = require('node-fetch');

/**
 * Parse Google Sheets URL to get spreadsheet ID and optional sheet GID
 */
function parseSheetUrl(url) {
  // Match: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=SHEET_GID
  const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/edit)?(?:\?[^#]*)?(?:#gid=(\d+))?/);
  if (match) {
    return { spreadsheetId: match[1], gid: match[2] || '0' };
  }
  return null;
}

/**
 * Read from Google Sheets via CSV export (no auth required).
 * Sheet must be shared as "Anyone with the link can view".
 */
async function readFromSheetCsv(sheetUrl) {
  const parsed = parseSheetUrl(sheetUrl);
  if (!parsed) {
    throw new Error('Invalid Google Sheets URL. Use format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=SHEET_GID');
  }

  const exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/export?format=csv&gid=${parsed.gid}`;
  const response = await fetch(exportUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch sheet (${response.status}). Ensure the sheet is shared as "Anyone with the link can view".`);
  }

  const csvText = await response.text();
  return parseCsvText(csvText);
}

/**
 * Parse CSV text to array of objects
 */
function parseCsvText(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    results.push(row);
  }

  return results;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' && !inQuotes) || char === '\r') {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

module.exports = {
  parseSheetUrl,
  readFromSheetCsv,
};
