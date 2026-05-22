/**
 * Admin-only operations: bulk holiday import and employee maintenance.
 * The Sheet itself remains the source of truth, so power users can also
 * edit it directly — these helpers are conveniences.
 */

function importHolidays_(csvText) {
  if (!csvText) throw new Error('CSV is empty');
  var sh = getSheet_(SHEET_HOLIDAYS);
  var lines = csvText.split(/\r?\n/);
  if (lines.length === 0) throw new Error('CSV has no rows');

  // Parse header
  var header = splitCsvLine_(lines[0]).map(function (s) { return s.trim().toLowerCase(); });
  var iDate = header.indexOf('date');
  var iType = header.indexOf('type');
  var iName = header.indexOf('name');
  if (iDate === -1 || iType === -1 || iName === -1) {
    throw new Error('CSV header must include date, type, name');
  }

  var parsed = [];
  var errors = [];
  for (var r = 1; r < lines.length; r++) {
    var raw = lines[r];
    if (!raw || !raw.trim()) continue;
    var cols = splitCsvLine_(raw);
    var dateStr = (cols[iDate] || '').trim();
    var typeStr = (cols[iType] || '').trim().toUpperCase();
    var name = (cols[iName] || '').trim();
    var d = parseIsoDate_(dateStr);
    if (!d) { errors.push({ line: r + 1, error: '日期格式錯誤: ' + dateStr }); continue; }
    if (HOLIDAY_TYPES.indexOf(typeStr) === -1) {
      errors.push({ line: r + 1, error: 'type 必須是 HOLIDAY 或 MAKEUP_WORKDAY: ' + typeStr });
      continue;
    }
    parsed.push([d, typeStr, name]);
  }

  if (parsed.length === 0) {
    return { ok: false, inserted: 0, errors: errors };
  }

  // Replace existing content
  sh.clear();
  sh.appendRow(['date', 'type', 'name']);
  sh.getRange(2, 1, parsed.length, 3).setValues(parsed);
  sh.getRange(2, 1, parsed.length, 1).setNumberFormat('yyyy-mm-dd');

  return { ok: true, inserted: parsed.length, errors: errors };
}

/**
 * Minimal CSV parser that handles quoted fields and embedded commas but
 * not embedded newlines (we split on \n upstream, which is sufficient
 * for the simple holiday format we expect).
 */
function splitCsvLine_(line) {
  var out = [];
  var cur = '';
  var inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQ = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}
