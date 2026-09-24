var LEDGER_HEADER = ['pin', 'start', 'type', 'what', 'end', 'duration', 'note'];

// Tabs (DESIGN 3.1). A name starting with '#' is never a rotation.
var SYSTEM_TAB_PREFIX = '#';
var HOLIDAYS_TAB = '#Holidays';
var GLOBAL_TAB = '#Global';
var STATUS_TAB = '#Status';
var ALL_SHIFTS_TAB = '#All shifts';
var PREVIEW_TAB_PREFIX = '#Preview ';

function isSystemTab(name) {
  return name.charAt(0) === SYSTEM_TAB_PREFIX;
}

// Preview of a rotation tab, or '#Preview Global' for the #Global tab.
function previewTabName(name) {
  return PREVIEW_TAB_PREFIX + (isSystemTab(name) ? name.slice(1) : name);
}

function isKnownSystemTab(name) {
  return name === HOLIDAYS_TAB || name === GLOBAL_TAB || name === STATUS_TAB || name === ALL_SHIFTS_TAB ||
    name.indexOf(PREVIEW_TAB_PREFIX) === 0;
}

// order: same-instant sort (DESIGN 3.6). what: item grammar of the column (see validateWhat).
// required: what must not be empty (a set row may be empty: the minimal first row when #Global supplies the
// settings). extent: end/duration allowed. A row with an empty type is a comment (internal type 'comment',
// order -1): never validated, replayed or generated, only sorted.
var ROW_TYPES = {
  error:    { order: 0,  what: 'text',   required: true,  extent: false },
  set:      { order: 1,  what: 'set',    required: false, extent: false },
  attract:  { order: 2,  what: 'names',  required: true,  extent: true },
  repel:    { order: 3,  what: 'names',  required: true,  extent: true },
  detach:   { order: 4,  what: 'names',  required: true,  extent: true },
  snapshot: { order: 5,  what: 'scores', required: false, extent: false },
  team:     { order: 6,  what: 'team',   required: true,  extent: false },
  score:    { order: 7,  what: 'team',   required: true,  extent: false },
  join:     { order: 8,  what: 'join',   required: true,  extent: false },
  leave:    { order: 9,  what: 'names',  required: true,  extent: false },
  exclude:  { order: 10, what: 'names',  required: true,  extent: true },
  include:  { order: 11, what: 'names',  required: true,  extent: false },
  shift:    { order: 12, what: 'shift',  required: false, extent: true },
};

var BASELINE_KEYWORDS = ['median', 'mean', 'min', 'max'];
var TIEBREAKS = ['order', 'shuffle'];
var GRID_MODES = ['calendar', 'counted'];

function parseNumber(text) {
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

function parseInteger(text) {
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function parseNonNegativeInteger(text) {
  var n = parseInteger(text);
  return n === null || n < 0 ? null : n;
}

function parseNonNegativeNumber(text) {
  var n = parseNumber(text);
  return n === null || n < 0 ? null : n;
}

function parsePositiveDuration(text) {
  var n = parseDuration(text);
  return n === null || n <= 0 ? null : n;
}

function parseBoolean(text) {
  var t = text.toLowerCase();
  if (t === 'true' || t === 'yes' || t === '1') return true;
  if (t === 'false' || t === 'no' || t === '0') return false;
  return null;
}

function parseKeyword(list) {
  return function (text) {
    var t = text.toLowerCase();
    return list.indexOf(t) >= 0 ? t : null;
  };
}

var parseBaselineKeyword = parseKeyword(BASELINE_KEYWORDS);

// '=' values of join, team and score items: baseline keyword or number.
function parseBaseline(text) {
  var kw = parseBaselineKeyword(text);
  return kw !== null ? kw : parseNumber(text);
}

function parsePrecredit(text) {
  return text.toLowerCase() === 'auto' ? 'auto' : parseNonNegativeInteger(text);
}

// def: initial value. bare: what a value-less key means: 'default' restores def, 'start' takes the row's
// start, 'none' is an error. parse null: the key takes no value.
var SETTINGS = {
  period:        { parse: parsePeriod,             def: null,               bare: 'none' },
  anchor:        { parse: null,                    def: null,               bare: 'start' },
  grid:          { parse: parseKeyword(GRID_MODES), def: 'calendar',         bare: 'default' },
  horizon:       { parse: parsePositiveDuration,   def: 90 * MINUTES_PER_DAY, bare: 'default' },
  skip_weekends: { parse: parseBoolean,            def: false,              bare: 'default' },
  skip_holidays: { parse: parseBoolean,            def: false,              bare: 'default' },
  tolerance:     { parse: parseNonNegativeNumber,  def: 0,                  bare: 'default' },
  min_distance:  { parse: parseNonNegativeInteger, def: 0,                  bare: 'default' },
  tiebreak:      { parse: parseKeyword(TIEBREAKS), def: 'order',            bare: 'default' },
  seed:          { parse: parseInteger,            def: 0,                  bare: 'default' },
  baseline:      { parse: parseBaselineKeyword,    def: 'median',           bare: 'default' },
  precredit:     { parse: parsePrecredit,          def: 'auto',             bare: 'default' },
};

function defaultSettings() {
  var out = {};
  for (var key in SETTINGS) out[key] = SETTINGS[key].def;
  return out;
}

// Returns { values: { key: parsed }, reset: [keys], error: string | null }. start is the row's start, used by
// bare anchor. reset lists the keys given bare that return to their default (and, in a rotation, to the
// global value); values carries the default for them too.
function parseSetArg(text, start) {
  var items = parseAssignments(text);
  var out = { values: {}, reset: [], error: null };
  if (typeof items === 'string') { out.error = items; return out; }
  var fail = function (message) { out.error = message; return out; };
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var key = it.name.toLowerCase();
    var spec = SETTINGS[key];
    if (!spec) return fail('unknown setting "' + it.name + '"');
    if (key in out.values) return fail('duplicate setting "' + it.name + '"');
    if (it.op !== null && it.op !== '=') return fail('set expects key or key=value, got "' + it.name + it.op + '"');
    var parsed;
    if (it.op === null) {
      if (spec.bare === 'none') return fail(it.name + ' requires a value');
      if (spec.bare === 'default') out.reset.push(key);
      parsed = spec.bare === 'start' ? start : spec.def;
    } else {
      if (!spec.parse) return fail(it.name + ' takes no value; the row start is the ' + it.name);
      parsed = spec.parse(it.value);
      if (parsed === null) return fail('bad value for ' + it.name + ': "' + it.value + '"');
    }
    out.values[key] = parsed;
  }
  return out;
}

// Value of a key from the global set rows dated at or before t; undefined when none sets it.
function globalValueAt(globalSetRows, key, t) {
  var value;
  sortRows(globalSetRows || []).forEach(function (row) {
    if (row.start === null || row.start > t) return;
    var parsed = parseSetArg(row.what, row.start);
    if (parsed.reset.indexOf(key) >= 0) value = undefined;
    else if (key in parsed.values) value = parsed.values[key];
  });
  return value;
}

function isNobody(what) {
  var w = (what ?? '').trim().toLowerCase();
  return w === '' || w === '-' || w === 'none';
}

function isValidMemberId(name) {
  return name !== '' && !/[,;=+]/.test(name);
}

// Items of a validated what column; [] when it does not parse.
function whatItems(row) {
  var items = parseAssignments(row.what);
  return typeof items === 'string' ? [] : items;
}

function whatNames(row) {
  return whatItems(row).map(function (it) { return it.name; });
}

// Assignee of a shift row, null for nobody.
function shiftAssignee(row) {
  return isNobody(row.what) ? null : row.what;
}

// false is empty so an unchecked checkbox in pin does not pin the row.
function cellText(cell) {
  return cell === null || cell === undefined || cell === false ? '' : String(cell).trim();
}

// duration is resolved into end here so downstream code only reads end.
function rowFromArray(cells, rowIndex) {
  var pin = cellText(cells[0]);
  var startText = cellText(cells[1]);
  var endText = cellText(cells[4]);
  var durationText = cellText(cells[5]);
  var start = parseDateTime(startText);
  var end = parseDateTime(endText);
  var duration = parseDuration(durationText);
  if (end === null && duration !== null && start !== null) end = start + duration;
  return {
    rowIndex: rowIndex,
    pin: pin,
    pinned: pin !== '',
    start: start,
    startText: startText,
    type: cellText(cells[2]).toLowerCase() || 'comment',
    what: cellText(cells[3]),
    end: end,
    endText: endText,
    duration: duration,
    durationText: durationText,
    note: cellText(cells[6]),
  };
}

function makeRow(fields) {
  var row = {
    rowIndex: null, pin: '', pinned: false, start: null, startText: '', type: '', what: '',
    end: null, endText: '', duration: null, durationText: '', note: '',
  };
  for (var k in fields) row[k] = fields[k];
  if (fields.pin && !('pinned' in fields)) row.pinned = true;
  if (row.end === null && row.duration !== null && row.start !== null) row.end = row.start + row.duration;
  return row;
}

// Unparseable cells are written back verbatim. An end derived from duration is not written.
function rowToArray(row) {
  var duration = row.duration !== null ? formatDuration(row.duration) : row.durationText;
  var derivedEnd = duration !== '' && row.endText === '';
  var end = derivedEnd ? '' : row.end !== null ? formatDateTime(row.end) : row.endText;
  return [
    row.pin,
    row.start !== null ? formatDateTime(row.start) : row.startText,
    row.type === 'comment' ? '' : row.type,
    row.what,
    end,
    duration,
    row.note,
  ];
}

function isLedgerHeader(cells) {
  if (!cells || cells.length < LEDGER_HEADER.length) return false;
  for (var i = 0; i < LEDGER_HEADER.length; i++) {
    if (cellText(cells[i]).toLowerCase() !== LEDGER_HEADER[i]) return false;
  }
  return true;
}

function typeOrder(type) {
  if (type === 'comment') return -1;
  return ROW_TYPES[type] ? ROW_TYPES[type].order : ROW_TYPES.shift.order + 1;
}

function rowsOfType(rows, type) {
  return rows.filter(function (r) { return r.type === type; });
}

function firstOfType(rows, types) {
  for (var i = 0; i < rows.length; i++) if (types.indexOf(rows[i].type) >= 0) return rows[i];
  return null;
}

function isUndatedComment(row) {
  return row.type === 'comment' && row.start === null;
}

var TRAILING_ORDER = ROW_TYPES.shift.order + 2;

// Sort key per row. An undated comment takes the start of the next dated row below it and an order just
// before it, so it sorts directly above that row whatever the array order; a stored key (attachComments)
// wins. Trailing undated comments keep a null start and sort after everything.
function sortKeys(rows) {
  var keys = new Array(rows.length);
  var pending = [];
  rows.forEach(function (row, i) {
    if (isUndatedComment(row)) {
      if (row.attachedStart !== undefined) keys[i] = { start: row.attachedStart, order: row.attachedOrder };
      else pending.push(i);
      return;
    }
    keys[i] = { start: row.start, order: typeOrder(row.type) };
    if (row.start === null) return;
    var attached = { start: row.start, order: keys[i].order - 0.5 };
    pending.forEach(function (j) { keys[j] = attached; });
    pending = [];
  });
  pending.forEach(function (j) { keys[j] = { start: null, order: TRAILING_ORDER }; });
  return keys;
}

// Resolves undated comments once, against the ledger as read, and stores the key on the row so later sorts
// keep each comment above the instant it was written at even when the row below it is regenerated.
function attachComments(rows) {
  var keys = sortKeys(rows);
  rows.forEach(function (row, i) {
    if (isUndatedComment(row)) { row.attachedStart = keys[i].start; row.attachedOrder = keys[i].order; }
  });
  return rows;
}

// Stable sort by start (nulls last), then DESIGN 3.6 type order; comments per sortKeys.
function sortRows(rows) {
  var keys = sortKeys(rows);
  var index = rows.map(function (_, i) { return i; });
  index.sort(function (i, j) {
    var a = keys[i], b = keys[j];
    if (a.start !== b.start) {
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start - b.start;
    }
    return a.order - b.order;
  });
  return index.map(function (i) { return rows[i]; });
}

// One item grammar (DESIGN 3.3): name, name=value, name+=n, name-=n. Which forms a type accepts:
// names: bare names. join: name or name=baseline. team: all four, '=' baseline or number. scores: name=number.
function validateItem(grammar, type, it) {
  if (!isValidMemberId(it.name)) return 'bad member id "' + it.name + '"';
  if (grammar === 'names' && it.op !== null) return type + ' takes names only, got "' + it.name + it.op + '"';
  if (grammar === 'join' && it.op !== null && it.op !== '=') return 'join takes name or name=baseline, got "' + it.name + it.op + '"';
  if (grammar === 'scores' && it.op !== '=') return type + ' expects name=number, got "' + it.name + (it.op || '') + '"';
  if (it.op === '=') {
    var ok = grammar === 'scores' ? parseNumber(it.value) : parseBaseline(it.value);
    if (ok === null) return 'bad value for ' + it.name + ': "' + it.value + '"';
  } else if (it.op !== null && parseNumber(it.value) === null) {
    return 'bad adjustment for ' + it.name + ': "' + it.value + '"';
  }
  return null;
}

function validateWhat(row) {
  var grammar = ROW_TYPES[row.type].what;
  if (grammar === 'text') return null;
  if (grammar === 'set') return parseSetArg(row.what, row.start).error;
  var items = parseAssignments(row.what);
  if (grammar === 'shift') {
    if (isNobody(row.what)) return null;
    var one = typeof items !== 'string' && items.length === 1 && items[0].op === null && isValidMemberId(items[0].name);
    return one ? null : 'shift takes exactly one member id';
  }
  if (typeof items === 'string') return items;
  for (var i = 0; i < items.length; i++) {
    var message = validateItem(grammar, row.type, items[i]);
    if (message !== null) return message;
  }
  return null;
}

function validateRow(row) {
  var spec = ROW_TYPES[row.type];
  if (!spec) return row.type === '' ? 'missing type' : 'unknown type "' + row.type + '"';
  if (row.start === null) return row.startText === '' ? 'missing start' : 'bad start "' + row.startText + '"';
  if (row.endText !== '' && row.durationText !== '') return 'end and duration are mutually exclusive';
  if (row.endText !== '' && parseDateTime(row.endText) === null) return 'bad end "' + row.endText + '"';
  if (row.durationText !== '' && (row.duration === null || row.duration <= 0)) return 'bad duration "' + row.durationText + '"';
  if (!spec.extent && (row.endText !== '' || row.durationText !== '')) return row.type + ' does not take end or duration';
  if (row.end !== null && row.end <= row.start) return 'end must be after start';
  if (spec.required && row.what === '') return row.type + ' requires what';
  return validateWhat(row);
}

function rowError(row, message) {
  return { rowIndex: row.rowIndex, start: row.start, startText: row.startText, message: message };
}

// Stateless checks of DESIGN 5.1. Drops error rows; returns remaining rows sorted. globalSetRows: the valid
// set rows of #Global, which may supply the period the first set row must otherwise carry.
function validateLedger(rows, rotationName, globalSetRows) {
  var errors = [];
  var kept = [];
  var snapshots = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.type === 'error') continue;
    kept.push(row);
    if (row.type === 'comment') continue;
    var message = validateRow(row);
    if (message === null && row.type === 'snapshot' && ++snapshots > 1) message = 'more than one snapshot row';
    if (message !== null) errors.push(rowError(row, message));
  }
  var sorted = sortRows(attachComments(kept));
  var first = firstOfType(sorted, Object.keys(ROW_TYPES));
  if (!first) {
    errors.push({ rowIndex: null, start: null, startText: '', message: rotationName + ': ledger is empty' });
  } else if (first.start !== null) {
    var period = first.type === 'set' && (parseSetArg(first.what, first.start).values.period || globalValueAt(globalSetRows, 'period', first.start));
    if (!period) errors.push(rowError(first, rotationName + ': first row must be a set row (period own or from ' + GLOBAL_TAB + ')'));
  }
  return { rows: sorted, errors: errors };
}
