/**
 * Home Hub v2 — Universal Google Sheets Apps Script Bridge
 *
 * Works for BOTH:
 *   1. Your Shared Household Google Sheet (all 9 tabs)
 *   2. Any member's Personal Private Google Sheet (Categories, Projects, Tasks, TaskInstances)
 *
 * Setup (~2 minutes, no Google Cloud account required):
 * 1. Create a blank Google Sheet.
 * 2. Open Extensions -> Apps Script, replace all code with this file.
 * 3. Optional: Set API_TOKEN below to any secret phrase.
 * 4. Click Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone).
 * 5. Copy the Web App URL into GOOGLE_APPS_SCRIPT_URL (shared) or your Profile Settings (personal).
 */

const API_TOKEN = '';
const ALLOWED_TABS = [
  'Households',
  'Members',
  'Invites',
  'ApiKeys',
  'Categories',
  'Projects',
  'Tasks',
  'TaskInstances',
  'Notifications',
];

function checkToken(token) {
  if (API_TOKEN && token !== API_TOKEN) {
    throw new Error('Unauthorized: invalid API token');
  }
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet(e) {
  try {
    var token = (e && e.parameter && e.parameter.token) || '';
    checkToken(token);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = {};

    ss.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (ALLOWED_TABS.indexOf(name) === -1) return;
      var values = sheet.getDataRange().getValues();
      tabs[name] = values.map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) return cell.toISOString();
          return cell === null || cell === undefined ? '' : String(cell);
        });
      });
    });

    return jsonResponse({ ok: true, tabs: tabs });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var payload = JSON.parse(raw);
    checkToken(payload.token || '');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = payload.tabs || {};

    Object.keys(tabs).forEach(function (name) {
      if (ALLOWED_TABS.indexOf(name) === -1) return;
      var rows = tabs[name];
      var sheet = getOrCreateSheet(ss, name);
      sheet.clearContents();
      if (rows && rows.length > 0 && rows[0].length > 0) {
        sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
        sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}
