/**
 * Monthly summary used by the dashboard.
 * Half-day leaves count as 0.5 day; WFH is a separate counter.
 */

function buildStats_(anchorDate) {
  var monthStart = firstDayOfMonth_(anchorDate);
  var monthEnd = lastDayOfMonth_(anchorDate);
  var requests = listRequestsBetween_(monthStart, monthEnd);
  var employees = listEmployees_();

  var perPerson = {};
  employees.forEach(function (e) {
    perPerson[e.name_en] = {
      name_en: e.name_en,
      team: e.team,
      leaveDays: 0,
      halfLeaveCount: 0,
      wfhDays: 0
    };
  });

  requests.forEach(function (r) {
    var p = perPerson[r.name_en];
    if (!p) {
      perPerson[r.name_en] = {
        name_en: r.name_en,
        team: 'UNKNOWN',
        leaveDays: 0,
        halfLeaveCount: 0,
        wfhDays: 0
      };
      p = perPerson[r.name_en];
    }
    switch (r.type) {
      case 'FULL_LEAVE': p.leaveDays += 1; break;
      case 'HALF_LEAVE_AM':
      case 'HALF_LEAVE_PM':
        p.leaveDays += 0.5;
        p.halfLeaveCount += 1;
        break;
      case 'WFH': p.wfhDays += 1; break;
    }
  });

  var perTeam = {};
  Object.keys(perPerson).forEach(function (k) {
    var p = perPerson[k];
    var t = p.team || 'UNKNOWN';
    if (!perTeam[t]) perTeam[t] = { team: t, leaveDays: 0, halfLeaveCount: 0, wfhDays: 0, members: [] };
    perTeam[t].leaveDays += p.leaveDays;
    perTeam[t].halfLeaveCount += p.halfLeaveCount;
    perTeam[t].wfhDays += p.wfhDays;
    perTeam[t].members.push(p);
  });

  return {
    monthIso: formatIso_(monthStart).slice(0, 7),
    perPerson: Object.keys(perPerson).map(function (k) { return perPerson[k]; }),
    perTeam: Object.keys(perTeam).map(function (k) { return perTeam[k]; })
  };
}
