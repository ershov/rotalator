function isBlankRow(cells) {
  return cells.every(function (c) { return cellText(c) === ''; });
}

function describeError(e) {
  var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex
    : e.start !== null && e.start !== undefined ? formatDateTime(e.start) : 'ledger';
  return e.rotation + ' ' + where + ': ' + e.message;
}

function rowsFromCells(cells) {
  return cells
    .map(function (row, i) { return isBlankRow(row) ? null : rowFromArray(row, i + 2); })
    .filter(Boolean);
}

// Read, advance, regenerate and optionally write back through a Storage (DESIGN 8).
// options: write, mode, rotations (names to regenerate; the others are read but not written).
// Returns { ledgers, global, errors, status }; ledgers holds only the regenerated ones and global is null when
// there is no #Global tab. A bad now, holiday cell or rotation name stops the run with nothing written.
function runStorage(storage, nowText, options) {
  options = options || {};
  var errors = [];
  var ledgers = storage.readLedgers();
  var only = options.rotations || null;
  (only || []).forEach(function (name) { if (!(name in ledgers)) errors.push('unknown rotation "' + name + '"'); });
  var now = parseDateTime(nowText ?? '');
  if (now === null) errors.push('bad now "' + (nowText ?? '') + '"');
  var holidays = [];
  storage.readHolidays().forEach(function (text, i) {
    if (text === null) return;
    var day = parseDay(text);
    if (day === null) errors.push('holidays row ' + (i + 2) + ': bad date "' + text + '"');
    else holidays.push(day);
  });
  var globalCells = storage.readGlobal();
  var ignored = storage.ignoredTabs();
  if (errors.length) return { ledgers: ledgers, global: null, errors: errors, status: null };

  var globalRows = rowsFromCells(globalCells);
  var globalSets = rowsOfType(globalRows, 'set');
  var rotations = Object.keys(ledgers).map(function (name) {
    var rows = rowsFromCells(ledgers[name]);
    return { name: name, rows: rows, snapshotAt: advance(rows, now, new Set(holidays), globalSets) };
  });
  var globalCount = globalRows.filter(function (r) { return r.type !== 'error' && r.type !== 'comment'; }).length;
  var result = regenerate({ rotations: rotations, holidays: holidays, global: globalRows, now: now, only: only });
  var out = {};
  result.rotations.forEach(function (r) { out[r.name] = r.rows.map(rowToArray); });
  var global = globalCells.length ? result.global.rows.map(rowToArray) : null;
  result.errors.forEach(function (e) { errors.push(describeError(e)); });
  result.status.now = nowText;
  result.status.mode = options.mode || (options.write ? 'run' : 'dry run');
  result.status.tabs = {
    rotations: Object.keys(ledgers), regenerated: result.regenerated ? Object.keys(out) : [],
    holidays: holidays.length, global: globalCount, ignored: ignored,
  };
  if (options.write) {
    Object.keys(out).forEach(function (name) { storage.writeLedger(name, out[name]); });
    if (global) storage.writeGlobal(global);
    storage.writeStatus(result.status);
  }
  return { ledgers: out, global: global, errors: errors, status: result.status };
}
