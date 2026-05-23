/**
 * Identifies the caller via Session.getActiveUser().getEmail() and looks
 * them up in the Employees sheet. The web app must be deployed with
 * "Execute as: User accessing" for this to work.
 */

function getCurrentUser_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) {
    return { role: 'UNAUTHORIZED', email: '', reason: 'NOT_LOGGED_IN' };
  }
  var employees = listEmployees_(/* includeInactive */ true);
  for (var i = 0; i < employees.length; i++) {
    var e = employees[i];
    if ((e.email || '').toLowerCase() === email) {
      if (!e.active) {
        return { role: 'UNAUTHORIZED', email: email, reason: 'INACTIVE' };
      }
      return {
        role: e.is_admin ? 'ADMIN' : 'MEMBER',
        email: email,
        name_en: e.name_en,
        name_zh: e.name_zh,
        team: e.team
      };
    }
  }
  return { role: 'UNAUTHORIZED', email: email, reason: 'NOT_LISTED' };
}

function requireAuthenticated_() {
  var u = getCurrentUser_();
  if (u.role === 'UNAUTHORIZED') {
    throw new Error('Not authorized: ' + (u.reason || 'unknown'));
  }
  return u;
}

function requireAdmin_() {
  var u = getCurrentUser_();
  if (u.role !== 'ADMIN') {
    throw new Error('Admin privilege required.');
  }
  return u;
}
