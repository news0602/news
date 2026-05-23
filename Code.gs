/**
 * Entry points and HTML template helpers.
 *
 * This Apps Script project is deployed as a Web App with:
 *   - Execute as: User accessing the web app
 *   - Who has access: Anyone with a Google account (or domain-restricted)
 *
 * The bound (or referenced) Google Sheet contains three required tabs:
 *   Employees, Requests, Holidays
 *
 * Set the spreadsheet id via Script Properties under key SPREADSHEET_ID,
 * or bind this script to the sheet directly (then SpreadsheetApp.getActive()
 * works without a property).
 */

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'calendar';
  var template;
  switch (page) {
    case 'admin':
      template = HtmlService.createTemplateFromFile('AdminPanel');
      break;
    case 'calendar':
    default:
      template = HtmlService.createTemplateFromFile('Calendar');
      break;
  }
  return template
    .evaluate()
    .setTitle('Team Leave / WFH Planner')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Used inside HTML templates: <?!= include('styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Bootstrap data shipped to the client on first load. Combines several
 * smaller calls into one round-trip so the calendar paints quickly.
 */
function getBootstrap(monthIso) {
  var user = getCurrentUser_();
  var admins = listAdmins_();
  var webAppUrl = ScriptApp.getService().getUrl();
  if (user.role === 'UNAUTHORIZED') {
    return { user: user, admins: admins, webAppUrl: webAppUrl };
  }
  var anchor = monthIso ? parseIsoDate_(monthIso + '-01') : new Date();
  var range = monthWindow_(anchor, 1); // prev/current/next month
  return {
    user: user,
    admins: admins,
    webAppUrl: webAppUrl,
    employees: listEmployees_(),
    holidays: listHolidaysBetween_(range.start, range.end),
    requests: listRequestsBetween_(range.start, range.end),
    monthAnchor: formatIso_(firstDayOfMonth_(anchor)),
    stats: buildStats_(anchor)
  };
}

/** Refresh just the dynamic parts after a write/delete. */
function getCalendarData(monthIso) {
  requireAuthenticated_();
  var anchor = monthIso ? parseIsoDate_(monthIso + '-01') : new Date();
  var range = monthWindow_(anchor, 1);
  return {
    requests: listRequestsBetween_(range.start, range.end),
    holidays: listHolidaysBetween_(range.start, range.end),
    stats: buildStats_(anchor),
    monthAnchor: formatIso_(firstDayOfMonth_(anchor))
  };
}

/**
 * Dry-run for MEMBER users: evaluates the rules engine without writing.
 * Returns { allowed, reasons, conflicts }.
 */
function checkRequest(payload) {
  requireAuthenticated_();
  var name = String(payload.name_en || '').trim();
  var date = parseIsoDate_(payload.date);
  var type = String(payload.type || '').trim();
  validateType_(type);

  var ctx = ruleContextFor_(date);
  return evaluateRules({
    name_en: name,
    date: date,
    type: type,
    existingRequests: ctx.requests,
    holidays: ctx.holidays,
    employees: ctx.employees
  });
}

/**
 * Admin-only: write a new request. The rules engine still runs; if it
 * rejects, the call requires payload.override === true to proceed and
 * the resulting row is tagged with note "OVERRIDE: <reasons>".
 */
function addRequest(payload) {
  var admin = requireAdmin_();
  var name = String(payload.name_en || '').trim();
  var date = parseIsoDate_(payload.date);
  var type = String(payload.type || '').trim();
  validateType_(type);

  var ctx = ruleContextFor_(date);
  var verdict = evaluateRules({
    name_en: name,
    date: date,
    type: type,
    existingRequests: ctx.requests,
    holidays: ctx.holidays,
    employees: ctx.employees
  });

  var note = String(payload.note || '');
  if (!verdict.allowed) {
    if (!payload.override) {
      return { ok: false, verdict: verdict };
    }
    note = ('OVERRIDE: ' + verdict.reasons.join('; ') + (note ? ' | ' + note : '')).trim();
  }

  var row = insertRequest_({
    name_en: name,
    date: date,
    type: type,
    created_by_email: admin.email,
    note: note
  });
  return { ok: true, request: row };
}

function deleteRequest(id) {
  requireAdmin_();
  return { ok: deleteRequestById_(String(id)) };
}

function updateRequest(payload) {
  requireAdmin_();
  var id = String(payload.id);
  var updates = {};
  if (payload.type) {
    validateType_(payload.type);
    updates.type = payload.type;
  }
  if (typeof payload.note === 'string') updates.note = payload.note;
  return { ok: updateRequestById_(id, updates) };
}

function importHolidaysCsv(csvText) {
  requireAdmin_();
  return importHolidays_(csvText);
}

function listEmployeesAdmin() {
  requireAdmin_();
  return listEmployees_(/* includeInactive */ true);
}

function upsertEmployee(payload) {
  requireAdmin_();
  return upsertEmployee_(payload);
}
