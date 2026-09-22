function isBlankRow(cells) {
  return cells.every(function (c) { return cellText(c) === ''; });
}

function describeError(e) {
  var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex
    : e.start !== null && e.start !== undefined ? formatDateTime(e.start) : 'ledger';
  return e.rotation + ' ' + where + ': ' + e.message;
}

// Read, advance, regenerate and optionally write back through a Storage (DESIGN 8).
// Returns { ledgers, errors, status }. Bad now or holiday cells stop the run with the ledgers unchanged.
function runStorage(storage, nowText, options) {
  options = options || {};
  var errors = [];
  var ledgers = storage.readLedgers();
  var now = parseDateTime(nowText ?? '');
  if (now === null) errors.push('bad now "' + (nowText ?? '') + '"');
  var holidays = [];
  storage.readHolidays().forEach(function (text, i) {
    if (text === null) return;
    var day = parseDay(text);
    if (day === null) errors.push('holidays row ' + (i + 2) + ': bad date "' + text + '"');
    else holidays.push(day);
  });
  if (errors.length) return { ledgers: ledgers, errors: errors, status: null };

  var rotations = Object.keys(ledgers).map(function (name) {
    var rows = ledgers[name]
      .map(function (cells, i) { return isBlankRow(cells) ? null : rowFromArray(cells, i + 2); })
      .filter(Boolean);
    return { name: name, rows: rows, snapshotAt: advance(rows, now) };
  });
  var result = regenerate({ rotations: rotations, holidays: holidays, links: storage.readLinks() });
  var out = {};
  result.rotations.forEach(function (r) { out[r.name] = r.rows.map(rowToArray); });
  result.errors.forEach(function (e) { errors.push(describeError(e)); });
  if (options.write) {
    Object.keys(out).forEach(function (name) { storage.writeLedger(name, out[name]); });
    storage.writeStatus(result.status);
  }
  return { ledgers: out, errors: errors, status: result.status };
}
