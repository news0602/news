/**
 * Lightweight self-test harness — no external framework available in
 * Apps Script, so we roll our own. Run `runAllTests()` from the script
 * editor; output goes to Logger.
 *
 * These tests exercise the pure rules engine with synthetic data only,
 * so they never touch the live spreadsheet.
 */

function runAllTests() {
  var results = [];
  var tests = [
    test_consultantWfhCap,
    test_consultantLeaveOrWfhCap,
    test_consultantCapAllowsHalfDayAtBoundary,
    test_consultantCapRejectsAboveBoundaryWithHalf,
    test_consultantWfhBlockedWhenLeaveFull,
    test_consultantWfhAllowedWhenLeaveBelowThreshold,
    test_personalFridayWfhCap,
    test_sameWeekdayStreak,
    test_noWfhStraddleWeekend,
    test_noWeekendWfh,
    test_noHolidayWfh,
    test_noDuplicate,
    test_coordinationPair,
    test_edisonOverlap,
    test_longHolidayBlocksWfh,
    test_csvParser
  ];
  for (var i = 0; i < tests.length; i++) {
    try {
      tests[i]();
      results.push({ name: tests[i].name, ok: true });
    } catch (err) {
      results.push({ name: tests[i].name, ok: false, error: err.message || String(err) });
    }
  }
  var passed = results.filter(function (r) { return r.ok; }).length;
  Logger.log('Passed ' + passed + '/' + results.length);
  results.forEach(function (r) {
    Logger.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.error ? ' — ' + r.error : ''));
  });
  return results;
}

/* ---------------- fixtures ---------------- */

function fixtureEmployees_() {
  return [
    { name_en: 'Ivan',   team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'Albert', team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'YP',     team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'Cheer',  team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'News',   team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'Laura',  team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'James',  team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'Jeremy', team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'Joe',    team: 'CONSULTANT',  email: '', is_admin: false, active: true },
    { name_en: 'Carol',  team: 'MAINTENANCE', email: '', is_admin: false, active: true },
    { name_en: 'JJ',     team: 'MAINTENANCE', email: '', is_admin: false, active: true },
    { name_en: 'Edison', team: 'MAINTENANCE', email: '', is_admin: false, active: true }
  ];
}

function makeReq_(name, dateIso, type) {
  return { name_en: name, date: parseIsoDate_(dateIso), type: type, note: '' };
}

function evalWith_(req, requests, holidays) {
  return evaluateRules({
    name_en: req.name_en,
    date: req.date,
    type: req.type,
    existingRequests: requests || [],
    holidays: holidays || [],
    employees: fixtureEmployees_()
  });
}

function assert_(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function assertReject_(verdict, needle) {
  assert_(!verdict.allowed, 'expected rejection but got allowed (' + verdict.reasons.join('|') + ')');
  if (needle) {
    var hit = verdict.reasons.some(function (r) { return r.indexOf(needle) !== -1; });
    assert_(hit, 'expected reason containing "' + needle + '" but got: ' + verdict.reasons.join(' | '));
  }
}

/* ---------------- tests ---------------- */

function test_consultantWfhCap() {
  // 2026-05-13 is a Wednesday
  var existing = [
    makeReq_('Albert', '2026-05-13', 'WFH'),
    makeReq_('YP',     '2026-05-13', 'WFH'),
    makeReq_('Cheer',  '2026-05-13', 'WFH')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'WFH'), existing);
  assertReject_(v, 'WFH 已達 3 人');
}

function test_consultantLeaveOrWfhCap() {
  // 4 full records already → candidate would push to 5 > 4 → reject
  var existing = [
    makeReq_('Albert', '2026-05-13', 'WFH'),
    makeReq_('YP',     '2026-05-13', 'FULL_LEAVE'),
    makeReq_('Cheer',  '2026-05-13', 'WFH'),
    makeReq_('News',   '2026-05-13', 'FULL_LEAVE')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'FULL_LEAVE'), existing);
  assertReject_(v, '4 人上限');
}

function test_consultantCapAllowsHalfDayAtBoundary() {
  // 3 full + 1 half = 3.5 existing; adding a half = 4.0 → exactly at cap, allowed.
  var existing = [
    makeReq_('Albert', '2026-05-13', 'FULL_LEAVE'),
    makeReq_('YP',     '2026-05-13', 'FULL_LEAVE'),
    makeReq_('Cheer',  '2026-05-13', 'WFH'),
    makeReq_('News',   '2026-05-13', 'HALF_LEAVE_AM')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'HALF_LEAVE_PM'), existing);
  assert_(v.allowed, 'expected allowed at total weight 4.0, got: ' + v.reasons.join('|'));
}

function test_consultantCapRejectsAboveBoundaryWithHalf() {
  // 4 full existing; candidate half = 4.5 > 4 → reject
  var existing = [
    makeReq_('Albert', '2026-05-13', 'WFH'),
    makeReq_('YP',     '2026-05-13', 'FULL_LEAVE'),
    makeReq_('Cheer',  '2026-05-13', 'WFH'),
    makeReq_('News',   '2026-05-13', 'FULL_LEAVE')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'HALF_LEAVE_AM'), existing);
  assertReject_(v, '4 人上限');
}

function test_consultantWfhBlockedWhenLeaveFull() {
  // Wednesday with leave weight >= 3 → no WFH
  var existing = [
    makeReq_('Albert', '2026-05-13', 'FULL_LEAVE'),
    makeReq_('YP',     '2026-05-13', 'FULL_LEAVE'),
    makeReq_('Cheer',  '2026-05-13', 'FULL_LEAVE')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'WFH'), existing);
  assertReject_(v, '不再開放 WFH');
}

function test_consultantWfhAllowedWhenLeaveBelowThreshold() {
  // 2 full + 1 half = 2.5 < 3 → WFH still allowed
  var existing = [
    makeReq_('Albert', '2026-05-13', 'FULL_LEAVE'),
    makeReq_('YP',     '2026-05-13', 'FULL_LEAVE'),
    makeReq_('Cheer',  '2026-05-13', 'HALF_LEAVE_AM')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'WFH'), existing);
  assert_(v.allowed, 'expected allowed at leave weight 2.5, got: ' + v.reasons.join('|'));
}

function test_personalFridayWfhCap() {
  // Fridays in May 2026: 1, 8, 15, 22, 29
  var existing = [
    makeReq_('Ivan', '2026-05-01', 'WFH'),
    makeReq_('Ivan', '2026-05-08', 'WFH')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-15', 'WFH'), existing);
  assertReject_(v, '週五 WFH 已達 2 次');
}

function test_sameWeekdayStreak() {
  // Three consecutive Wednesdays
  var existing = [
    makeReq_('Ivan', '2026-04-29', 'WFH'),
    makeReq_('Ivan', '2026-05-06', 'FULL_LEAVE')
  ];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'WFH'), existing);
  assertReject_(v, '連續兩週');
}

function test_noWfhStraddleWeekend() {
  // Fri 2026-05-15 WFH, then Mon 2026-05-18 WFH
  var existing = [makeReq_('Ivan', '2026-05-15', 'WFH')];
  var v = evalWith_(makeReq_('Ivan', '2026-05-18', 'WFH'), existing);
  assertReject_(v, '不可橫跨週末');
}

function test_noWeekendWfh() {
  // 2026-05-16 is Saturday
  var v = evalWith_(makeReq_('Ivan', '2026-05-16', 'WFH'));
  assertReject_(v, '週六或週日');
}

function test_noHolidayWfh() {
  var holidays = [{ date: '2026-05-01', type: 'HOLIDAY', name: '勞動節' }];
  var v = evalWith_(makeReq_('Ivan', '2026-05-01', 'WFH'), [], holidays);
  assertReject_(v, '國定假日');
}

function test_noDuplicate() {
  var existing = [makeReq_('Ivan', '2026-05-13', 'WFH')];
  var v = evalWith_(makeReq_('Ivan', '2026-05-13', 'FULL_LEAVE'), existing);
  assertReject_(v, '已有紀錄');
}

function test_coordinationPair() {
  var existing = [makeReq_('JJ', '2026-05-13', 'FULL_LEAVE')];
  var v = evalWith_(makeReq_('Carol', '2026-05-13', 'WFH'), existing);
  assertReject_(v, '對方已有紀錄');
}

function test_edisonOverlap() {
  var existing = [makeReq_('Carol', '2026-05-13', 'WFH')];
  var v = evalWith_(makeReq_('Edison', '2026-05-13', 'WFH'), existing);
  assertReject_(v, 'Edison');
}

function test_longHolidayBlocksWfh() {
  // 2026-02-27 ~ 03-01 假設為 4 天連假
  var holidays = [
    { date: '2026-02-27', type: 'HOLIDAY', name: '和平紀念日連假' },
    { date: '2026-02-28', type: 'HOLIDAY', name: '和平紀念日' },
    { date: '2026-03-01', type: 'HOLIDAY', name: '和平紀念日連假' }
  ];
  // Adjacent business day: Monday 2026-03-02. 連假 = Fri-Sat-Sun-? = need 4 contiguous off days.
  // Feb 27 = Fri, Feb 28 = Sat, Mar 1 = Sun, plus Mar 2 makeup? We marked Mar 1 as HOLIDAY too.
  // Block: Feb 27 (Hol) + Feb 28 (Sat) + Mar 1 (Sun marked Hol but Sun anyway) → 3 days actually.
  // Add Mar 2 holiday to push to 4.
  holidays.push({ date: '2026-03-02', type: 'HOLIDAY', name: '和平紀念日補假' });
  var v = evalWith_(makeReq_('Ivan', '2026-03-03', 'WFH'), [], holidays);
  assertReject_(v, '連假');
}

function test_csvParser() {
  var line = 'a,"b,c",d';
  var parts = splitCsvLine_(line);
  assert_(parts.length === 3, 'expected 3 parts, got ' + parts.length);
  assert_(parts[1] === 'b,c', 'expected b,c got ' + parts[1]);
}
