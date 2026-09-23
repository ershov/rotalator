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
// Returns { ledgers, links, errors, status }; ledgers holds only the regenerated ones and links is null when
// there is no #Links tab. A bad now, holiday cell or rotation name stops the run with nothing written.
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
  var linkCells = storage.readLinks();
  var ignored = storage.ignoredTabs();
  if (errors.length) return { ledgers: ledgers, links: null, errors: errors, status: null };

  var rotations = Object.keys(ledgers).map(function (name) {
    var rows = rowsFromCells(ledgers[name]);
    return { name: name, rows: rows, snapshotAt: advance(rows, now, new Set(holidays)) };
  });
  var linkRows = rowsFromCells(linkCells);
  var linkCount = linkRows.filter(function (r) { return r.type !== 'error' && r.type !== 'comment'; }).length;
  var result = regenerate({ rotations: rotations, holidays: holidays, links: linkRows, now: now, only: only });
  var out = {};
  result.rotations.forEach(function (r) { out[r.name] = r.rows.map(rowToArray); });
  var links = linkCells.length ? result.links.rows.map(rowToArray) : null;
  result.errors.forEach(function (e) { errors.push(describeError(e)); });
  result.status.now = nowText;
  result.status.mode = options.mode || (options.write ? 'run' : 'dry run');
  result.status.tabs = {
    rotations: Object.keys(ledgers), regenerated: result.regenerated ? Object.keys(out) : [],
    holidays: holidays.length, links: linkCount, ignored: ignored,
  };
  if (options.write) {
    Object.keys(out).forEach(function (name) { storage.writeLedger(name, out[name]); });
    if (links) storage.writeLinks(links);
    storage.writeStatus(result.status);
  }
  return { ledgers: out, links: links, errors: errors, status: result.status };
}
