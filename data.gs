/**
 * Sheet CRUD layer. Hides spreadsheet quirks (1-based indices, Date
 * coercion, header lookup) from the rest of the codebase.
 *
 * Schemas (header rows must match exactly, case-insensitive):
 *   Employees: name_en | name_zh | team | email | is_admin | active
 *   Requests : id | name_en | date | type | created_at | created_by_email | note
 *   Holidays : date | type | name
 */

var SHEET_EMPLOYEES = 'Employees';
var SHEET_REQUESTS = 'Requests';
var SHEET_HOLIDAYS = 'Holidays';

var REQUEST_TYPES = ['FULL_LEAVE', 'HALF_LEAVE_AM', 'HALF_LEAVE_PM', 'WFH'];
var HOLIDAY_TYPES = ['HOLIDAY', 'MAKEUP_WORKDAY'];

function validateType_(type) {
  if (REQUEST_TYPES.indexOf(type) === -1) {
    throw new Error('Invalid request type: ' + type);
  }
}

function getSpreadsheet_() {
  var bound = SpreadsheetApp.getActive();
  if (bound) return bound;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('No bound spreadsheet and no SPREADSHEET_ID script property set.');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Missing sheet tab: ' + name);
  return sh;
}

function readTable_(name) {
  var sh = getSheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length === 0) return { headers: [], rows: [], sheet: sh };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blank = row.every(function (v) { return v === '' || v === null; });
    if (blank) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj.__rowIndex = r + 1; // 1-based sheet row including header
    rows.push(obj);
  }
  return { headers: headers, rows: rows, sheet: sh };
}

function headerIndex_(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase() === name.toLowerCase()) return i;
  }
  return -1;
}

/* ---------------- Employees ---------------- */

function listEmployees_(includeInactive) {
  var t = readTable_(SHEET_EMPLOYEES);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var active = coerceBool_(r.active, true);
    if (!includeInactive && !active) continue;
    out.push({
      name_en: String(r.name_en || '').trim(),
      name_zh: String(r.name_zh || '').trim(),
      team: String(r.team || '').trim().toUpperCase(),
      email: String(r.email || '').trim(),
      is_admin: coerceBool_(r.is_admin, false),
      active: active,
      __rowIndex: r.__rowIndex
    });
  }
  return out;
}

function upsertEmployee_(payload) {
  var t = readTable_(SHEET_EMPLOYEES);
  var sh = t.sheet;
  var headers = t.headers;
  var idx = {
    name_en: headerIndex_(headers, 'name_en'),
    name_zh: headerIndex_(headers, 'name_zh'),
    team: headerIndex_(headers, 'team'),
    email: headerIndex_(headers, 'email'),
    is_admin: headerIndex_(headers, 'is_admin'),
    active: headerIndex_(headers, 'active')
  };
  var name = String(payload.name_en || '').trim();
  if (!name) throw new Error('name_en is required');

  var existing = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].name_en || '').trim().toLowerCase() === name.toLowerCase()) {
      existing = t.rows[i];
      break;
    }
  }

  var row = new Array(headers.length).fill('');
  row[idx.name_en] = name;
  row[idx.name_zh] = String(payload.name_zh || '').trim();
  row[idx.team] = String(payload.team || '').trim().toUpperCase();
  row[idx.email] = String(payload.email || '').trim();
  row[idx.is_admin] = coerceBool_(payload.is_admin, false);
  row[idx.active] = coerceBool_(payload.active, true);

  if (existing) {
    sh.getRange(existing.__rowIndex, 1, 1, headers.length).setValues([row]);
    return { ok: true, updated: true };
  } else {
    sh.appendRow(row);
    return { ok: true, created: true };
  }
}

/* ---------------- Requests ---------------- */

function listRequestsBetween_(startDate, endDate) {
  var t = readTable_(SHEET_REQUESTS);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var d = coerceDate_(r.date);
    if (!d) continue;
    if (d < startDate || d > endDate) continue;
    out.push({
      id: String(r.id || ''),
      name_en: String(r.name_en || '').trim(),
      date: d,
      dateIso: formatIso_(d),
      type: String(r.type || '').trim(),
      created_at: coerceDate_(r.created_at),
      created_by_email: String(r.created_by_email || '').trim(),
      note: String(r.note || '')
    });
  }
  return out;
}

function insertRequest_(payload) {
  var t = readTable_(SHEET_REQUESTS);
  var sh = t.sheet;
  var headers = t.headers;
  var idx = {
    id: headerIndex_(headers, 'id'),
    name_en: headerIndex_(headers, 'name_en'),
    date: headerIndex_(headers, 'date'),
    type: headerIndex_(headers, 'type'),
    created_at: headerIndex_(headers, 'created_at'),
    created_by_email: headerIndex_(headers, 'created_by_email'),
    note: headerIndex_(headers, 'note')
  };

  // Reject same person + same date duplicates at the data layer too.
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var d = coerceDate_(r.date);
    if (d && sameDay_(d, payload.date)
        && String(r.name_en).trim().toLowerCase() === payload.name_en.toLowerCase()) {
      throw new Error('Duplicate: ' + payload.name_en + ' already has a record on ' + formatIso_(payload.date));
    }
  }

  var id = Utilities.getUuid();
  var row = new Array(headers.length).fill('');
  row[idx.id] = id;
  row[idx.name_en] = payload.name_en;
  row[idx.date] = payload.date;
  row[idx.type] = payload.type;
  row[idx.created_at] = new Date();
  row[idx.created_by_email] = payload.created_by_email || '';
  row[idx.note] = payload.note || '';
  sh.appendRow(row);
  return {
    id: id,
    name_en: payload.name_en,
    dateIso: formatIso_(payload.date),
    type: payload.type,
    note: payload.note || ''
  };
}

function deleteRequestById_(id) {
  var t = readTable_(SHEET_REQUESTS);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].id) === id) {
      t.sheet.deleteRow(t.rows[i].__rowIndex);
      return true;
    }
  }
  return false;
}

function updateRequestById_(id, updates) {
  var t = readTable_(SHEET_REQUESTS);
  var headers = t.headers;
  var typeCol = headerIndex_(headers, 'type') + 1;
  var noteCol = headerIndex_(headers, 'note') + 1;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].id) === id) {
      if (updates.type) t.sheet.getRange(t.rows[i].__rowIndex, typeCol).setValue(updates.type);
      if (typeof updates.note === 'string') {
        t.sheet.getRange(t.rows[i].__rowIndex, noteCol).setValue(updates.note);
      }
      return true;
    }
  }
  return false;
}

/* ---------------- Holidays ---------------- */

function listHolidaysBetween_(startDate, endDate) {
  var t = readTable_(SHEET_HOLIDAYS);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var d = coerceDate_(r.date);
    if (!d) continue;
    if (d < startDate || d > endDate) continue;
    out.push({
      date: d,
      dateIso: formatIso_(d),
      type: String(r.type || '').trim().toUpperCase(),
      name: String(r.name || '').trim()
    });
  }
  return out;
}

function listAllHolidays_() {
  var t = readTable_(SHEET_HOLIDAYS);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var d = coerceDate_(r.date);
    if (!d) continue;
    out.push({
      date: d,
      dateIso: formatIso_(d),
      type: String(r.type || '').trim().toUpperCase(),
      name: String(r.name || '').trim()
    });
  }
  return out;
}

/* ---------------- helpers ---------------- */

function coerceBool_(v, def) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === '') return def;
  var s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  return def;
}

function coerceDate_(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v === 'number') {
    var d = new Date(v);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  var s = String(v).trim();
  if (!s) return null;
  var parsed = parseIsoDate_(s);
  if (parsed) return parsed;
  var d2 = new Date(s);
  if (isNaN(d2.getTime())) return null;
  return new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
}

function parseIsoDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatIso_(d) {
  if (!d) return '';
  var mm = d.getMonth() + 1;
  var dd = d.getDate();
  return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
}

function sameDay_(a, b) {
  return a && b
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function firstDayOfMonth_(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function lastDayOfMonth_(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths_(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Returns { start, end } covering monthOffset months on either side of anchor. */
function monthWindow_(anchor, monthOffset) {
  var start = firstDayOfMonth_(addMonths_(anchor, -monthOffset));
  var end = lastDayOfMonth_(addMonths_(anchor, monthOffset));
  return { start: start, end: end };
}

function ruleContextFor_(date) {
  // Pull a generous window so weekly/streak rules have enough history.
  var start = addDays_(date, -60);
  var end = addDays_(date, 60);
  return {
    requests: listRequestsBetween_(start, end),
    holidays: listHolidaysBetween_(start, end),
    employees: listEmployees_()
  };
}
