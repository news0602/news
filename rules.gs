/**
 * Rules engine. Pure functions over plain data, so they're easy to unit
 * test in test.gs without touching the spreadsheet.
 *
 * Each rule receives a `req` (the candidate request) plus context arrays
 * already filtered to a useful window. A rule returns either null (pass)
 * or { reason, conflicts? } (fail).
 *
 * For MEMBER dry-runs the result is informational. For ADMIN writes the
 * caller may choose to override.
 */

var CONSULTANT_TEAM = 'CONSULTANT';
var MAINTENANCE_TEAM = 'MAINTENANCE';

var COORDINATION_PAIRS = [
  ['Carol', 'JJ'],
  ['James', 'News']
];

/**
 * Main entry point.
 * @param {{name_en,date,type,existingRequests,holidays,employees}} input
 * @return {{allowed:boolean, reasons:string[], conflicts:Array}}
 */
function evaluateRules(input) {
  var req = {
    name_en: input.name_en,
    date: normalizeDay_(input.date),
    type: input.type
  };
  var ctx = {
    requests: (input.existingRequests || []).map(normalizeRequest_),
    holidays: (input.holidays || []).map(normalizeHoliday_),
    employees: input.employees || []
  };

  var reasons = [];
  var conflicts = [];

  var rules = [
    rule_validInputs_,
    rule_noWeekendWfh_,
    rule_noHolidayWfh_,
    rule_noDuplicate_,
    rule_consultantWfhCap_,
    rule_consultantLeaveOrWfhCap_,
    rule_consultantWfhBlockedByFullLeave_,
    rule_personalFridayWfhMonthlyCap_,
    rule_sameWeekdayStreak_,
    rule_noWfhStraddleWeekend_,
    rule_noFiveDayAbsenceAroundLongWeekend_,
    rule_longHolidayWfhRequiresDiscussion_,
    rule_coordinationPairs_,
    rule_maintenanceTeamOverlap_
  ];

  for (var i = 0; i < rules.length; i++) {
    var result = rules[i](req, ctx);
    if (result) {
      reasons.push(result.reason);
      if (result.conflicts) {
        for (var j = 0; j < result.conflicts.length; j++) conflicts.push(result.conflicts[j]);
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons,
    conflicts: conflicts
  };
}

/* ----------------- individual rules ----------------- */

function rule_validInputs_(req, ctx) {
  if (!req.name_en) return { reason: '請選擇申請人' };
  if (!req.date) return { reason: '日期格式錯誤' };
  if (['FULL_LEAVE','HALF_LEAVE_AM','HALF_LEAVE_PM','WFH'].indexOf(req.type) === -1) {
    return { reason: '類型不正確' };
  }
  return null;
}

function rule_noWeekendWfh_(req) {
  if (req.type !== 'WFH') return null;
  var dow = req.date.getDay(); // 0 Sun, 6 Sat
  if (dow === 0 || dow === 6) return { reason: 'WFH 不可排在週六或週日' };
  return null;
}

function rule_noHolidayWfh_(req, ctx) {
  if (req.type !== 'WFH') return null;
  var h = holidayOn_(ctx.holidays, req.date);
  if (h && h.type === 'HOLIDAY') return { reason: 'WFH 不可排在國定假日 (' + h.name + ')' };
  return null;
}

function rule_noDuplicate_(req, ctx) {
  var found = ctx.requests.filter(function (r) {
    return r.name_en.toLowerCase() === req.name_en.toLowerCase() && sameDay_(r.date, req.date);
  });
  if (found.length > 0) return { reason: req.name_en + ' 在 ' + formatIso_(req.date) + ' 已有紀錄' };
  return null;
}

function rule_consultantWfhCap_(req, ctx) {
  if (req.type !== 'WFH') return null;
  var emp = employeeByName_(ctx.employees, req.name_en);
  if (!emp || emp.team !== CONSULTANT_TEAM) return null;
  var sameDay = ctx.requests.filter(function (r) {
    return sameDay_(r.date, req.date)
      && r.type === 'WFH'
      && teamOf_(ctx.employees, r.name_en) === CONSULTANT_TEAM;
  });
  if (sameDay.length >= 3) {
    return { reason: '顧問組當日 WFH 已達 3 人上限', conflicts: sameDay };
  }
  return null;
}

function rule_consultantLeaveOrWfhCap_(req, ctx) {
  // 上限 4 人/天,半天算 0.5。
  var emp = employeeByName_(ctx.employees, req.name_en);
  if (!emp || emp.team !== CONSULTANT_TEAM) return null;
  var sameDay = ctx.requests.filter(function (r) {
    return sameDay_(r.date, req.date)
      && teamOf_(ctx.employees, r.name_en) === CONSULTANT_TEAM;
  });
  var existingWeight = sumWeights_(sameDay);
  var total = existingWeight + weightOf_(req.type);
  if (total > 4) {
    return {
      reason: '顧問組當日 leave + WFH 合計已達 ' + formatWeight_(total) + ' 人,超過 4 人上限',
      conflicts: sameDay
    };
  }
  return null;
}

function rule_consultantWfhBlockedByFullLeave_(req, ctx) {
  // Mon-Thu only; 同日請假合計達 3 人(半天算 0.5)→ 不再開放 WFH。
  if (req.type !== 'WFH') return null;
  var dow = req.date.getDay();
  if (dow < 1 || dow > 4) return null;
  var emp = employeeByName_(ctx.employees, req.name_en);
  if (!emp || emp.team !== CONSULTANT_TEAM) return null;
  var leavesToday = ctx.requests.filter(function (r) {
    return sameDay_(r.date, req.date)
      && teamOf_(ctx.employees, r.name_en) === CONSULTANT_TEAM
      && isLeave_(r.type);
  });
  var leaveWeight = sumWeights_(leavesToday);
  if (leaveWeight >= 3) {
    return {
      reason: '顧問組當日請假合計 ' + formatWeight_(leaveWeight) + ' 人,不再開放 WFH',
      conflicts: leavesToday
    };
  }
  return null;
}

function rule_personalFridayWfhMonthlyCap_(req, ctx) {
  if (req.type !== 'WFH') return null;
  if (req.date.getDay() !== 5) return null;
  var year = req.date.getFullYear();
  var month = req.date.getMonth();
  var fridayWfhs = ctx.requests.filter(function (r) {
    return r.name_en.toLowerCase() === req.name_en.toLowerCase()
      && r.type === 'WFH'
      && r.date.getDay() === 5
      && r.date.getFullYear() === year
      && r.date.getMonth() === month;
  });
  if (fridayWfhs.length >= 2) {
    return { reason: req.name_en + ' 本月週五 WFH 已達 2 次上限', conflicts: fridayWfhs };
  }
  return null;
}

function rule_sameWeekdayStreak_(req, ctx) {
  // Same weekday three weeks in a row (including the candidate) is rejected.
  // Counts leave + WFH equivalently.
  var dow = req.date.getDay();
  var prev1 = addDays_(req.date, -7);
  var prev2 = addDays_(req.date, -14);
  var lower = req.name_en.toLowerCase();
  var hits = ctx.requests.filter(function (r) {
    if (r.name_en.toLowerCase() !== lower) return false;
    return sameDay_(r.date, prev1) || sameDay_(r.date, prev2);
  });
  var dates = {};
  hits.forEach(function (r) { dates[formatIso_(r.date)] = true; });
  if (dates[formatIso_(prev1)] && dates[formatIso_(prev2)]) {
    return { reason: req.name_en + ' 同一週幾(' + weekdayName_(dow) + ')已連續兩週,本週不可再排' };
  }
  return null;
}

function rule_noWfhStraddleWeekend_(req, ctx) {
  // WFH on Friday + WFH on the following Monday (or vice versa) is rejected.
  if (req.type !== 'WFH') return null;
  var dow = req.date.getDay();
  var checkDate = null;
  if (dow === 5) checkDate = addDays_(req.date, 3); // next Monday
  else if (dow === 1) checkDate = addDays_(req.date, -3); // prior Friday
  else return null;
  var lower = req.name_en.toLowerCase();
  var other = ctx.requests.find(function (r) {
    return r.name_en.toLowerCase() === lower
      && r.type === 'WFH'
      && sameDay_(r.date, checkDate);
  });
  if (other) {
    return { reason: 'WFH 不可橫跨週末 (與 ' + formatIso_(checkDate) + ' 的 WFH 連在一起)' };
  }
  return null;
}

function rule_noFiveDayAbsenceAroundLongWeekend_(req, ctx) {
  // If a 3-day national long weekend (consecutive holidays/weekend forming
  // 3+ days off) is adjacent to this request, the candidate + existing
  // records of the same person must not produce a 5+ day absence stretch
  // where any portion is WFH (we'd rather they actually take leave).
  // Implementation: build a per-person "away" calendar around the date
  // (-7..+7), with national days marked, candidate marked. If any run of
  // >=5 contiguous "away" days touches the candidate AND the candidate is
  // WFH (not pure leave), reject.
  if (req.type !== 'WFH') return null;
  var stretch = absenceStretchAround_(req, ctx, 7);
  if (stretch.length >= 5) {
    return { reason: '連假前後若加上此次 WFH 將連續 ' + stretch.length + ' 天不在辦公室,請改請假或調整' };
  }
  return null;
}

function rule_longHolidayWfhRequiresDiscussion_(req, ctx) {
  // 4+ day holidays (consecutive holidays incl. weekends) — pure WFH
  // adjacent is not auto-approved; ask member to talk to manager.
  if (req.type !== 'WFH') return null;
  var longBlock = findAdjacentHolidayBlock_(req.date, ctx.holidays, 4);
  if (longBlock) {
    return { reason: '臨近 ' + longBlock + ' 連假,純 WFH 不開放,請先與主管討論' };
  }
  return null;
}

function rule_coordinationPairs_(req, ctx) {
  for (var i = 0; i < COORDINATION_PAIRS.length; i++) {
    var pair = COORDINATION_PAIRS[i];
    var idx = pair.map(function (n) { return n.toLowerCase(); }).indexOf(req.name_en.toLowerCase());
    if (idx === -1) continue;
    var other = pair[1 - idx];
    var conflict = ctx.requests.find(function (r) {
      return sameDay_(r.date, req.date) && r.name_en.toLowerCase() === other.toLowerCase();
    });
    if (conflict) {
      return {
        reason: '與 ' + other + ' 為協調對撞組合,當日對方已有紀錄 (' + conflict.type + ')',
        conflicts: [conflict]
      };
    }
  }
  return null;
}

function rule_maintenanceTeamOverlap_(req, ctx) {
  // Edison cannot be away the same day as any other maintenance member.
  // (Carol/JJ overlap is handled by the COORDINATION_PAIRS rule.)
  var emp = employeeByName_(ctx.employees, req.name_en);
  if (!emp || emp.team !== MAINTENANCE_TEAM) return null;
  var candidateIsEdison = emp.name_en.toLowerCase() === 'edison';
  var conflicts = ctx.requests.filter(function (r) {
    if (!sameDay_(r.date, req.date)) return false;
    if (r.name_en.toLowerCase() === req.name_en.toLowerCase()) return false;
    if (teamOf_(ctx.employees, r.name_en) !== MAINTENANCE_TEAM) return false;
    return candidateIsEdison || r.name_en.toLowerCase() === 'edison';
  });
  if (conflicts.length > 0) {
    return {
      reason: '維護組 Edison 不可與其他維護組成員同日不在辦公室',
      conflicts: conflicts
    };
  }
  return null;
}

/* ----------------- helpers ----------------- */

function normalizeDay_(d) {
  if (!d) return null;
  if (typeof d === 'string') return parseIsoDate_(d);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function normalizeRequest_(r) {
  return {
    id: r.id,
    name_en: r.name_en,
    date: normalizeDay_(r.date),
    type: r.type,
    note: r.note || ''
  };
}

function normalizeHoliday_(h) {
  return {
    date: normalizeDay_(h.date),
    type: (h.type || '').toUpperCase(),
    name: h.name || ''
  };
}

function holidayOn_(holidays, date) {
  for (var i = 0; i < holidays.length; i++) {
    if (sameDay_(holidays[i].date, date)) return holidays[i];
  }
  return null;
}

function employeeByName_(employees, name) {
  if (!name) return null;
  var lower = name.toLowerCase();
  for (var i = 0; i < employees.length; i++) {
    if ((employees[i].name_en || '').toLowerCase() === lower) return employees[i];
  }
  return null;
}

function teamOf_(employees, name) {
  var e = employeeByName_(employees, name);
  return e ? e.team : '';
}

function isLeave_(type) {
  return type === 'FULL_LEAVE' || type === 'HALF_LEAVE_AM' || type === 'HALF_LEAVE_PM';
}

function weightOf_(type) {
  if (type === 'HALF_LEAVE_AM' || type === 'HALF_LEAVE_PM') return 0.5;
  return 1;
}

function sumWeights_(requests) {
  return requests.reduce(function (s, r) { return s + weightOf_(r.type); }, 0);
}

function formatWeight_(n) {
  return (Math.round(n * 10) / 10).toString();
}

function weekdayName_(dow) {
  return ['週日','週一','週二','週三','週四','週五','週六'][dow];
}

/** True if the given date is "not in office": weekend, national holiday, or has a leave/WFH record for the person. */
function isAwayDay_(date, name, ctx) {
  var dow = date.getDay();
  if (dow === 0 || dow === 6) return true;
  var h = holidayOn_(ctx.holidays, date);
  if (h && h.type === 'HOLIDAY') return true;
  // MAKEUP_WORKDAY counts as a work day (overrides weekend).
  var lower = name.toLowerCase();
  return ctx.requests.some(function (r) {
    return sameDay_(r.date, date) && r.name_en.toLowerCase() === lower;
  });
}

function absenceStretchAround_(req, ctx, radius) {
  var dayMap = {};
  // mark candidate
  dayMap[formatIso_(req.date)] = true;
  // mark surroundings
  for (var i = -radius; i <= radius; i++) {
    if (i === 0) continue;
    var d = addDays_(req.date, i);
    if (isAwayDay_(d, req.name_en, ctx)) dayMap[formatIso_(d)] = true;
  }
  // Walk outward from candidate to find contiguous run.
  var run = [formatIso_(req.date)];
  for (var b = 1; b <= radius; b++) {
    var iso = formatIso_(addDays_(req.date, -b));
    if (dayMap[iso]) run.unshift(iso); else break;
  }
  for (var f = 1; f <= radius; f++) {
    var iso2 = formatIso_(addDays_(req.date, f));
    if (dayMap[iso2]) run.push(iso2); else break;
  }
  // Don't count makeup workdays as away even if weekend.
  return run;
}

/**
 * If the candidate date is adjacent (within 1 day) to a contiguous block
 * of HOLIDAY/weekend days >= minDays, return the block's name(s);
 * otherwise null.
 */
function findAdjacentHolidayBlock_(date, holidays, minDays) {
  for (var offset = -1; offset <= 1; offset++) {
    if (offset === 0) continue;
    var probe = addDays_(date, offset);
    var block = expandHolidayBlock_(probe, holidays);
    if (block.length >= minDays) {
      return block.map(function (b) { return b.name || formatIso_(b.date); }).join('、');
    }
  }
  return null;
}

function expandHolidayBlock_(seed, holidays) {
  var isOff = function (d) {
    var dow = d.getDay();
    var h = holidayOn_(holidays, d);
    if (h && h.type === 'MAKEUP_WORKDAY') return false;
    if (h && h.type === 'HOLIDAY') return true;
    return dow === 0 || dow === 6;
  };
  if (!isOff(seed)) return [];
  var block = [{ date: seed, name: (holidayOn_(holidays, seed) || {}).name }];
  for (var b = 1; b < 30; b++) {
    var d = addDays_(seed, -b);
    if (!isOff(d)) break;
    block.unshift({ date: d, name: (holidayOn_(holidays, d) || {}).name });
  }
  for (var f = 1; f < 30; f++) {
    var d2 = addDays_(seed, f);
    if (!isOff(d2)) break;
    block.push({ date: d2, name: (holidayOn_(holidays, d2) || {}).name });
  }
  return block;
}
