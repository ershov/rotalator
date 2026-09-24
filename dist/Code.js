// ---- 00_util.js ----
// Datetimes are integer minutes since 1970-01-01T00:00, wall clock treated as UTC.

var MINUTES_PER_HOUR = 60;
var MINUTES_PER_DAY = 1440;
var MINUTES_PER_WEEK = 10080;

var DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// year >= 100 avoids Date.UTC mapping two-digit years to 19xx.
function validDate(year, month, day) {
  return year >= 100 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function makeDateTime(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

function parseDateTime(text) {
  if (typeof text !== 'string') return null;
  var m = DATETIME_RE.exec(text.trim());
  if (!m) return null;
  var year = +m[1], month = +m[2], day = +m[3];
  var hour = m[4] === undefined ? 0 : +m[4];
  var minute = m[5] === undefined ? 0 : +m[5];
  if (!validDate(year, month, day) || hour > 23 || minute > 59) return null;
  return makeDateTime(year, month, day, hour, minute);
}

// Returns a day index (days since 1970-01-01), the unit used for holidays.
function parseDay(text) {
  if (typeof text !== 'string') return null;
  var m = DATE_RE.exec(text.trim());
  if (!m) return null;
  var year = +m[1], month = +m[2], day = +m[3];
  if (!validDate(year, month, day)) return null;
  return makeDateTime(year, month, day, 0, 0) / MINUTES_PER_DAY;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// Canonical text; midnight is written as the bare date (DESIGN 3.3).
function formatDateTime(min) {
  var d = new Date(min * 60000);
  var date = String(d.getUTCFullYear()).padStart(4, '0') + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  var time = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  return time === '00:00' ? date : date + 'T' + time;
}

function formatDay(day) {
  return formatDateTime(day * MINUTES_PER_DAY);
}

function dayIndex(min) {
  return Math.floor(min / MINUTES_PER_DAY);
}

function dayStart(day) {
  return day * MINUTES_PER_DAY;
}

// 0 = Sunday .. 6 = Saturday. 1970-01-01 was a Thursday.
function weekdayOfDay(day) {
  return ((day + 4) % 7 + 7) % 7;
}

function weekday(min) {
  return weekdayOfDay(dayIndex(min));
}

var UNIT_MINUTES = { w: MINUTES_PER_WEEK, d: MINUTES_PER_DAY, h: MINUTES_PER_HOUR, m: 1 };
var UNIT_ORDER = 'wdhm';
var DURATION_TOKEN_RE = /^(\d+)\s*([wdhm])\s*/;

function parseDurationUnits(text, units) {
  if (typeof text !== 'string') return null;
  var rest = text.trim();
  if (rest === '') return null;
  var total = 0;
  var lastUnit = -1;
  while (rest !== '') {
    var m = DURATION_TOKEN_RE.exec(rest);
    if (!m) return null;
    var unit = UNIT_ORDER.indexOf(m[2]);
    if (units.indexOf(m[2]) < 0 || unit <= lastUnit) return null;
    lastUnit = unit;
    total += +m[1] * UNIT_MINUTES[m[2]];
    rest = rest.slice(m[0].length);
  }
  return total;
}

function parseDuration(text) {
  return parseDurationUnits(text, 'wdhm');
}

function parsePeriod(text) {
  var min = parseDurationUnits(text, 'wd');
  return min === null || min === 0 ? null : min;
}

function formatDuration(min) {
  if (!Number.isInteger(min) || min < 0) return null;
  if (min === 0) return '0m';
  var out = '';
  for (var i = 0; i < UNIT_ORDER.length; i++) {
    var u = UNIT_ORDER[i];
    var n = Math.floor(min / UNIT_MINUTES[u]);
    if (n > 0) {
      out += n + u;
      min -= n * UNIT_MINUTES[u];
    }
  }
  return out;
}

function splitList(text) {
  if (typeof text !== 'string') return [];
  return text.split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

var ASSIGNMENT_RE = /^([^=+]*?)\s*(\+=|-=|=)\s*(.*)$/;

// Returns [{ name, op, value }] or an error string. op is '=', '+=', '-=' or null.
function parseAssignments(text) {
  var items = splitList(text);
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var m = ASSIGNMENT_RE.exec(item);
    if (!m) {
      if (item.indexOf('+') >= 0) return 'bad assignment "' + item + '"';
      out.push({ name: item, op: null, value: null });
      continue;
    }
    var name = m[1].trim(), value = m[3].trim();
    if (name === '' || value === '' || /[=+]/.test(value)) return 'bad assignment "' + item + '"';
    out.push({ name: name, op: m[2], value: value });
  }
  return out;
}

// FNV-1a 32-bit over the UTF-8 encoding of the string.
function fnv1a32(str) {
  var h = 0x811c9dc5;
  for (var ch of str) {
    var c = ch.codePointAt(0);
    var bytes;
    if (c < 0x80) bytes = [c];
    else if (c < 0x800) bytes = [0xc0 | (c >> 6), 0x80 | (c & 0x3f)];
    else if (c < 0x10000) bytes = [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)];
    else bytes = [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)];
    for (var j = 0; j < bytes.length; j++) {
      h ^= bytes[j];
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

// RFC 4180 style. A blank line yields [''] so row numbers match line numbers.
function parseCsv(text) {
  var rows = [];
  var row = [];
  var field = '';
  var quoted = false;
  var lineStarted = false;
  var i = 0;
  var n = text.length;
  var endRow = function () {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    lineStarted = false;
  };
  while (i < n) {
    var c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    lineStarted = true;
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    field += c;
    i++;
  }
  if (lineStarted) endRow();
  return rows;
}

function formatCsvField(value) {
  var s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A row with a single empty field is written as "" so the line is visibly a row.
function formatCsvRow(row) {
  var line = row.map(formatCsvField).join(',');
  return line === '' ? '""' : line;
}

function formatCsv(rows) {
  return rows.map(formatCsvRow).join('\n') + (rows.length ? '\n' : '');
}

// ---- 10_model.js ----
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
  join:     { order: 7,  what: 'join',   required: true,  extent: false },
  leave:    { order: 8,  what: 'names',  required: true,  extent: false },
  score:    { order: 9,  what: 'team',   required: true,  extent: false },
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

// ---- 20_calendar.js ----
var COUNTED_DAY_SEARCH_LIMIT = 100000;

// Boundaries anchor + k*period (DESIGN 3.5, 4). With grid=counted the timeline is the concatenation of
// counted days (not skipped by skip_weekends/skip_holidays) and period counts counted days; an instant
// inside a skipped day projects onto the boundary between the adjacent counted days.
class Grid {
  constructor(settings, holidays) {
    this.period = settings.period;
    this.anchor = settings.anchor;
    this.counted = settings.grid === 'counted';
    this.options = { skip_weekends: settings.skip_weekends, skip_holidays: settings.skip_holidays, holidays: holidays };
    this.anchorDay = dayIndex(this.anchor);
    this.countCache = new Map();
    this.dayCache = new Map();
  }

  skipped(day) {
    return isSkippedDay(day, this.options);
  }

  // Counted days in [anchorDay, day), negative for days before the anchor day.
  countedBefore(day) {
    var n = this.countCache.get(day);
    if (n !== undefined) return n;
    n = 0;
    for (var d = Math.min(day, this.anchorDay); d < Math.max(day, this.anchorDay); d++) if (!this.skipped(d)) n++;
    if (day < this.anchorDay) n = -n;
    this.countCache.set(day, n);
    return n;
  }

  // The n-th counted day from the anchor day (0 is the first counted day at or after it).
  countedDay(n) {
    var cached = this.dayCache.get(n);
    if (cached !== undefined) return cached;
    var dir = n >= 0 ? 1 : -1;
    var d = n >= 0 ? this.anchorDay : this.anchorDay - 1;
    var k = n >= 0 ? 0 : -1;
    for (var i = 0; i < COUNTED_DAY_SEARCH_LIMIT; i++) {
      if (!this.skipped(d)) {
        this.dayCache.set(k, d);
        if (k === n) return d;
        k += dir;
      }
      d += dir;
    }
    return d;
  }

  // t itself, or the next boundary when t lies inside a skipped day of a counted grid.
  onCounted(t) {
    return this.counted && this.skipped(dayIndex(t)) ? this.ceil(t) : t;
  }

  // Wall-clock minutes to counted minutes and back; the identity in calendar mode.
  coord(t) {
    if (!this.counted) return t;
    var day = dayIndex(t);
    var base = this.countedBefore(day) * MINUTES_PER_DAY;
    return this.skipped(day) ? base : base + (t - dayStart(day));
  }

  instant(c) {
    if (!this.counted) return c;
    var n = Math.floor(c / MINUTES_PER_DAY);
    return dayStart(this.countedDay(n)) + (c - n * MINUTES_PER_DAY);
  }

  floor(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + Math.floor((this.coord(t) - a) / this.period) * this.period);
  }

  ceil(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + Math.ceil((this.coord(t) - a) / this.period) * this.period);
  }

  next(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + (Math.floor((this.coord(t) - a) / this.period) + 1) * this.period);
  }

  // n periods from t along the grid; t + n*period in calendar mode.
  step(t, n) {
    return this.instant(this.coord(t) + n * this.period);
  }
}

function isSkippedDay(day, options) {
  if (options.skip_weekends) {
    var w = weekdayOfDay(day);
    if (w === 0 || w === 6) return true;
  }
  return Boolean(options.skip_holidays && options.holidays && options.holidays.has(day));
}

// Fractional days covered by [a, b), per calendar day, skipping days per options
// { skip_weekends, skip_holidays, holidays: Set<dayIndex> }.
function units(a, b, options) {
  options = options || {};
  if (b <= a) return 0;
  var minutes = 0;
  for (var day = dayIndex(a), last = dayIndex(b - 1); day <= last; day++) {
    if (isSkippedDay(day, options)) continue;
    var from = Math.max(a, dayStart(day));
    var to = Math.min(b, dayStart(day + 1));
    minutes += to - from;
  }
  return minutes / MINUTES_PER_DAY;
}

function firstAfter(instants, t) {
  if (!instants) return null;
  for (var i = 0; i < instants.length; i++) if (instants[i] > t) return instants[i];
  return null;
}

// DESIGN 5.4. grid: the Grid effective at shift.start. gridChanges: ascending instants of set rows changing the grid.
function claimEnd(shift, nextShiftStart, grid, gridChanges) {
  var end = shift.end !== null ? shift.end : grid.next(shift.start);
  if (nextShiftStart !== null && nextShiftStart !== undefined && nextShiftStart < end) end = nextShiftStart;
  var change = firstAfter(gridChanges, shift.start);
  if (change !== null && change < end) end = change;
  return end;
}

// DESIGN 3.4: explicit end, else the earlier of the next shift start and the next grid boundary.
function scoredEnd(shift, nextShiftStart, grid) {
  if (shift.end !== null) return shift.end;
  var end = grid.next(shift.start);
  return nextShiftStart !== null && nextShiftStart !== undefined && nextShiftStart < end ? nextShiftStart : end;
}

// ---- 30_state.js ----
// Effective settings at an instant: the rotation's own values over the global ones over the defaults.
class Settings {
  constructor(values) {
    this.values = Object.assign(defaultSettings(), values || {});
  }

  clone() {
    return new Settings(this.values);
  }

  get(key) {
    return this.values[key];
  }

  grid(holidays) {
    return this.values.period === null ? null : new Grid(this.values, holidays);
  }

  // Number of regular shifts after the snapshot within which pins are pre-credited.
  precreditPeriods(rosterSize) {
    return this.values.precredit === 'auto' ? rosterSize : this.values.precredit;
  }

  unitsOptions(holidays) {
    return { skip_weekends: this.values.skip_weekends, skip_holidays: this.values.skip_holidays, holidays: holidays };
  }
}

var SETTING_LAYERS = ['rotation', 'global'];

function gridChangedBetween(before, after) {
  if (after.period !== before.period || after.anchor !== before.anchor || after.grid !== before.grid) return true;
  return after.grid === 'counted' && (after.skip_weekends !== before.skip_weekends || after.skip_holidays !== before.skip_holidays);
}

// Settings of a rotation over time (DESIGN 3.5): its own set rows layered over the global ones. A key the
// rotation has set wins until a bare key returns it to the global value; keys set in neither layer use the
// defaults. Entries hold the effective Settings and the source of each key after every set row of either
// layer, in start order (global before rotation at the same instant). Rows whose what does not parse are
// skipped, so callers may pass unvalidated rows. holidays: Set of day indexes.
class SettingsTimeline {
  constructor(setRows, holidays, globalSetRows) {
    this.holidays = holidays || new Set();
    this.entries = [];
    var layers = { global: {}, rotation: {} };
    var usable = function (r) { return r.start !== null && parseSetArg(r.what, r.start).error === null; };
    var events = sortRows((globalSetRows || []).filter(usable)).map(function (r) { return { row: r, layer: 'global' }; })
      .concat(sortRows(setRows.filter(usable)).map(function (r) { return { row: r, layer: 'rotation' }; }))
      .sort(function (a, b) { return a.row.start - b.row.start; });
    var effective = function () {
      var values = defaultSettings();
      var sources = {};
      Object.keys(values).forEach(function (key) {
        sources[key] = 'default';
        SETTING_LAYERS.forEach(function (layer) {
          if (sources[key] === 'default' && key in layers[layer]) { values[key] = layers[layer][key]; sources[key] = layer; }
        });
      });
      return { values: values, sources: sources };
    };
    var before = effective();
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var layer = layers[ev.layer];
      var parsed = parseSetArg(ev.row.what, ev.row.start);
      Object.keys(parsed.values).forEach(function (key) { if (parsed.reset.indexOf(key) < 0) layer[key] = parsed.values[key]; });
      parsed.reset.forEach(function (key) { delete layer[key]; });
      var after = effective();
      // A period change without an explicit anchor re-anchors this layer at the row.
      if ('period' in parsed.values && after.values.period !== before.values.period && !('anchor' in parsed.values)) {
        layer.anchor = ev.row.start;
        after = effective();
      }
      this.entries.push({
        start: ev.row.start, settings: new Settings(after.values), sources: after.sources,
        gridChanged: gridChangedBetween(before.values, after.values),
      });
      before = after;
    }
  }

  entryAt(t) {
    var found = null;
    for (var i = 0; i < this.entries.length && this.entries[i].start <= t; i++) found = this.entries[i];
    return found;
  }

  at(t) {
    var entry = this.entryAt(t);
    return entry ? entry.settings.clone() : new Settings();
  }

  // Source of each key at t: 'rotation', 'global' or 'default'.
  sourcesAt(t) {
    var entry = this.entryAt(t);
    if (entry) return Object.assign({}, entry.sources);
    var out = {};
    Object.keys(SETTINGS).forEach(function (key) { out[key] = 'default'; });
    return out;
  }

  // One Grid per entry, built on first use so its day caches survive across calls.
  gridAt(t) {
    var entry = this.entryAt(t);
    if (!entry) return null;
    if (entry.grid === undefined) entry.grid = entry.settings.grid(this.holidays);
    return entry.grid;
  }

  gridChanges() {
    return this.entries.filter(function (e) { return e.gridChanged; }).map(function (e) { return e.start; });
  }
}

// At most two decimals, trailing zeros and dot trimmed: 12.5, 14, 19.63, 0.
function formatScore(score) {
  var text = score.toFixed(2).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

// Clips [a, b) to start at `at`; b null is open. Returns null when nothing extends past `at`.
function clipToSnapshot(a, b, at) {
  if (at === null || at === undefined) return [a, b];
  if (b !== null && b <= at) return null;
  return [Math.max(a, at), b];
}

// Ordered members with scores and exclusions [{ from, to }], to null meaning open.
class Roster {
  constructor() {
    this.members = [];
  }

  size() {
    return this.members.length;
  }

  names() {
    return this.members.map(function (m) { return m.name; });
  }

  get(name) {
    for (var i = 0; i < this.members.length; i++) if (this.members[i].name === name) return this.members[i];
    return null;
  }

  has(name) {
    return this.get(name) !== null;
  }

  scores() {
    var out = {};
    this.members.forEach(function (m) { out[m.name] = m.score; });
    return out;
  }

  // kind: number, or 'median' | 'mean' | 'min' | 'max' over current scores. Empty roster gives 0.
  baseline(kind) {
    if (typeof kind === 'number') return kind;
    var scores = this.members.map(function (m) { return m.score; });
    if (!scores.length) return 0;
    if (kind === 'min') return Math.min.apply(null, scores);
    if (kind === 'max') return Math.max.apply(null, scores);
    var sum = scores.reduce(function (a, b) { return a + b; }, 0);
    if (kind === 'mean') return sum / scores.length;
    scores.sort(function (a, b) { return a - b; });
    var mid = scores.length >> 1;
    return scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  }

  addMember(name, baselineKind) {
    this.members.push({ name: name, score: this.baseline(baselineKind), exclusions: [] });
  }

  // items of a join row: name or name=baseline. Joiners are added one by one, so later baselines see earlier joiners.
  join(items, defaultBaseline) {
    for (var i = 0; i < items.length; i++) {
      if (this.has(items[i].name)) return 'join: "' + items[i].name + '" is already a member';
    }
    var self = this;
    items.forEach(function (it) { self.addMember(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline); });
    return null;
  }

  leave(names) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'leave: unknown member "' + unknown + '"';
    this.members = this.members.filter(function (m) { return names.indexOf(m.name) < 0; });
    return null;
  }

  // items of a team row. Leavers removed, joiners added, roster reordered, adjustments applied last.
  team(items, defaultBaseline) {
    var names = new Set();
    for (var i = 0; i < items.length; i++) {
      if (names.has(items[i].name)) return 'team: duplicate member "' + items[i].name + '"';
      names.add(items[i].name);
    }
    this.members = this.members.filter(function (m) { return names.has(m.name); });
    var existing = new Set(this.names());
    var self = this;
    items.forEach(function (it) {
      if (!existing.has(it.name)) self.addMember(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline);
    });
    this.members = items.map(function (it) { return self.get(it.name); });
    items.forEach(function (it) {
      if (it.op !== '=' || existing.has(it.name)) self.adjust(self.get(it.name), it);
    });
    return null;
  }

  // '=' sets to a number or to an aggregate of the current scores; '+=' and '-=' adjust; a bare name does nothing.
  adjust(member, it) {
    if (it.op === '=') member.score = this.baseline(parseBaseline(it.value));
    else if (it.op === '+=') member.score += Number(it.value);
    else if (it.op === '-=') member.score -= Number(it.value);
  }

  // items of a score row: same forms as team, only the members mentioned change.
  score(items) {
    for (var i = 0; i < items.length; i++) {
      var m = this.get(items[i].name);
      if (!m) return 'score: unknown member "' + items[i].name + '"';
      this.adjust(m, items[i]);
    }
    return null;
  }

  unknownMember(names) {
    for (var i = 0; i < names.length; i++) if (!this.has(names[i])) return names[i];
    return null;
  }

  exclude(names, from, to) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'exclude: unknown member "' + unknown + '"';
    var self = this;
    names.forEach(function (n) { self.get(n).exclusions.push({ from: from, to: to === undefined ? null : to }); });
    return null;
  }

  // Closes every exclusion of each name active at `at`.
  include(names, at) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'include: unknown member "' + unknown + '"';
    for (var i = 0; i < names.length; i++) {
      var closed = false;
      this.get(names[i]).exclusions.forEach(function (ex) {
        if (ex.from <= at && (ex.to === null || ex.to > at)) { ex.to = at; closed = true; }
      });
      if (!closed) return 'include: no active exclusion for "' + names[i] + '"';
    }
    return null;
  }

  isExcluded(who, a, b) {
    var m = this.get(who);
    if (!m) return false;
    return m.exclusions.some(function (ex) { return ex.from < b && (ex.to === null || ex.to > a); });
  }

  credit(who, units) {
    var m = this.get(who);
    if (m) m.score += units;
  }

  snapshotWhat() {
    return this.members.map(function (m) { return m.name + '=' + formatScore(m.score); }).join(', ');
  }

  fromSnapshotWhat(text) {
    var items = parseAssignments(text);
    this.members = typeof items === 'string' ? [] : items.map(function (it) {
      return { name: it.name, score: Number(it.value), exclusions: [] };
    });
  }
}

// ---- 40_scheduler.js ----
// Sweep item order at equal start: row types use ROW_TYPES order; script items slot in between.
function sweepOrder(kind, type) {
  if (kind === 'row') return typeOrder(type);
  if (kind === 'snapshot') return typeOrder('snapshot');
  if (kind === 'precredit') return typeOrder('shift') - 0.5;
  return typeOrder('shift');
}

function raiseTo(a, b) {
  if (b === null || b === undefined) return a;
  return a === null ? b : Math.max(a, b);
}

function ledgerRows(rows) {
  return sortRows(rows.filter(function (r) { return r.type !== 'error' && r.type !== 'comment' && r.start !== null; }));
}

// An instant inside a skipped day of a counted grid moves to the next boundary, so S never lands there.
function onCountedDay(timeline, t) {
  var grid = t === null || t === undefined ? null : timeline.gridAt(t);
  return grid ? grid.onCounted(t) : t;
}

// DESIGN 5.2. now may be null to skip the clock-dependent steps. holidays: Set of day indexes.
// globalSetRows: the set rows of #Global.
function advance(rows, now, holidays, globalSetRows) {
  rows = ledgerRows(rows);
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows);
  var S = null;
  if (now !== null && now !== undefined) {
    var grid = timeline.gridAt(now);
    if (grid) S = grid.floor(now);
    var shifts = rowsOfType(rows, 'shift');
    for (var i = shifts.length - 1; i >= 0; i--) {
      if (shifts[i].start > now) continue;
      var shiftGrid = timeline.gridAt(shifts[i].start);
      var next = shifts[i + 1] ? shifts[i + 1].start : null;
      if (shiftGrid && scoredEnd(shifts[i], next, shiftGrid) > now) S = shifts[i].start;
      break;
    }
    S = raiseTo(S, onCountedDay(timeline, timeline.at(now).get('anchor')));
  }
  var roster = firstOfType(rows, ['team', 'join']);
  S = raiseTo(S, roster ? onCountedDay(timeline, roster.start) : null);
  var snapshot = firstOfType(rows, ['snapshot']);
  S = raiseTo(S, snapshot ? snapshot.start : null);
  return S;
}

// Spans of [a, b) not covered by claims (sorted by start).
function uncoveredSpans(a, b, claims) {
  var spans = [];
  var t = a;
  for (var i = 0; i < claims.length && t < b; i++) {
    var cs = claims[i][0], ce = claims[i][1];
    if (ce <= t) continue;
    if (cs > t) spans.push([t, Math.min(cs, b)]);
    t = Math.max(t, ce);
  }
  if (t < b) spans.push([t, b]);
  return spans;
}

// Splits [a, b) at grid boundaries and grid changes into slot entries.
function splitSlots(a, b, timeline, changes, out) {
  var t = a;
  while (t < b) {
    var end = Math.min(timeline.gridAt(t).next(t), b);
    var change = firstAfter(changes, t);
    if (change !== null && change < end) end = change;
    out.push({ start: t, slotEnd: end, end: null, who: null, slot: true, row: null });
    t = end;
  }
}

function errorRow(e) {
  return makeRow({ type: 'error', start: e.start, startText: e.startText || '', what: e.message });
}

// Effective end per member of each exclude row once include rows are applied, to decide clipping at the snapshot.
function resolvedExcludeEnds(rows) {
  var ends = new Map();
  rows.forEach(function (row) {
    if (row.type === 'exclude') {
      var perName = {};
      whatNames(row).forEach(function (n) { perName[n] = row.end; });
      ends.set(row, perName);
    }
    if (row.type !== 'include') return;
    var names = whatNames(row);
    rows.forEach(function (ex) {
      var perName = ends.get(ex);
      if (!perName || ex.start > row.start) return;
      names.forEach(function (n) {
        if (n in perName && (perName[n] === null || perName[n] > row.start)) perName[n] = row.start;
      });
    });
  });
  return ends;
}

// frozen (DESIGN 5, run scope): the rotation is swept as it stands so relations see its shifts, but nothing is
// pruned, no slot is filled and the snapshot stays where it is; it is not written. globalSetRows: #Global.
function prepareRotation(input, index, holidays, frozen, globalSetRows) {
  var validated = validateLedger(input.rows, input.name, globalSetRows);
  var rot = { name: input.name, index: index, frozen: frozen, rows: validated.rows, errors: validated.errors.slice(), problems: [], warnings: [] };
  if (rot.errors.length) return rot;
  var rows = rot.rows;
  rows.forEach(function (r) {
    if (r.type === 'comment' && r.start === null && r.startText !== '') {
      rot.warnings.push({ start: null, message: 'comment row ' + r.rowIndex + ': unparseable start, treated as undated' });
    }
  });
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows);
  var previous = firstOfType(rows, ['snapshot']);
  var S = frozen || input.snapshotAt === null || input.snapshotAt === undefined ? advance(rows, null, holidays, globalSetRows) : input.snapshotAt;
  var first = firstOfType(rows, ['set']);
  S = raiseTo(raiseTo(S, previous ? previous.start : null), onCountedDay(timeline, first.start));
  rot.timeline = timeline;
  rot.previousAt = previous ? previous.start : null;
  rot.previousWhat = previous ? previous.what : '';
  rot.S = S;
  rot.kept = rows.filter(function (r) { return r.type !== 'snapshot' && !(!frozen && r.type === 'shift' && !r.pinned && r.start > S); });

  var shifts = rowsOfType(rot.kept, 'shift');
  var changes = timeline.gridChanges();
  var regenStart = S;
  var claims = shifts.map(function (s, i) {
    var end = claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes);
    if (s.start === S) regenStart = Math.max(regenStart, end);
    return [s.start, end];
  });
  var horizonAt = S + timeline.at(S).get('horizon');
  rot.horizonEnd = timeline.gridAt(horizonAt).ceil(horizonAt);

  var entries = shifts.map(function (s) {
    return { start: s.start, slotEnd: null, end: null, who: shiftAssignee(s), slot: false, row: s };
  });
  if (!frozen) {
    uncoveredSpans(regenStart, rot.horizonEnd, claims).forEach(function (span) {
      splitSlots(span[0], span[1], timeline, changes, entries);
    });
  }
  entries.sort(function (a, b) { return a.start - b.start; });
  entries.forEach(function (e, i) {
    e.end = e.slot ? e.slotEnd : scoredEnd(e.row, entries[i + 1] ? entries[i + 1].start : null, timeline.gridAt(e.start));
  });
  rot.entries = entries;
  return rot;
}

function rotationItems(rot) {
  var items = [];
  var P = rot.previousAt;
  var S = rot.S;
  var push = function (start, kind, data) {
    items.push(Object.assign({ start: start, order: sweepOrder(kind, data.row ? data.row.type : null), rot: rot.index, kind: kind }, data));
  };
  var afterPrevious = function (t) { return P === null || t >= P; };
  var excludeEnds = resolvedExcludeEnds(rot.kept);
  rot.roster = new Roster();
  rot.roster.fromSnapshotWhat(rot.previousWhat);
  rot.precredited = new Set();
  rot.kept.forEach(function (row) {
    if (row.type === 'shift' || row.type === 'comment' || row.type === 'set' || isRelationRow(row)) return;
    if (row.type === 'exclude') {
      var ends = excludeEnds.get(row);
      var names = whatNames(row).filter(function (n) { return clipToSnapshot(row.start, ends[n], P) !== null; });
      var from = P === null ? row.start : Math.max(row.start, P);
      if (names.length) push(from, 'row', { row: row, names: names, from: from, to: row.end, clipped: from !== row.start });
    } else if (afterPrevious(row.start)) {
      push(row.start, 'row', { row: row });
    }
  });
  push(S, 'snapshot', {});
  push(S, 'precredit', {});
  rot.entries.forEach(function (entry) {
    if (entry.slot) { push(entry.start, 'slot', { entry: entry, row: entry.row }); return; }
    if (entry.who === null) return;
    var clip = clipToSnapshot(entry.start, entry.end, P);
    if (!clip) return;
    if (clip[0] < S && S < clip[1]) {
      push(clip[0], 'credit', { entry: entry, row: entry.row, a: clip[0], b: S });
      push(S, 'tail', { entry: entry, a: S, b: clip[1] });
    } else {
      push(clip[0], 'credit', { entry: entry, row: entry.row, a: clip[0], b: clip[1] });
    }
  });
  return items;
}

function mergeItems(rots) {
  var items = [];
  rots.forEach(function (rot) { items = items.concat(rotationItems(rot)); });
  return items.sort(function (a, b) { return (a.start - b.start) || (rots[a.rot].rank - rots[b.rot].rank) || (a.order - b.order); });
}

// Settings at an instant come from the timeline (own and global set rows), so set rows are not sweep items.
function applyStateRow(rot, item) {
  var row = item.row;
  var roster = rot.roster;
  var settings = rot.timeline.at(item.start);
  switch (row.type) {
    case 'team': return roster.team(whatItems(row), settings.get('baseline'));
    case 'join': return roster.join(whatItems(row), settings.get('baseline'));
    case 'leave': return roster.leave(whatNames(row));
    case 'score': return roster.score(whatItems(row));
    case 'exclude': {
      var names = item.clipped ? item.names.filter(function (n) { return roster.has(n); }) : item.names;
      return names.length ? roster.exclude(names, item.from, item.to) : null;
    }
    case 'include': return roster.include(whatNames(row), row.start);
    default: return null;
  }
}

// The window is precredit grid steps after S (DESIGN 5.5).
function precredit(rot, holidays) {
  var settings = rot.timeline.at(rot.S);
  var n = settings.precreditPeriods(rot.roster.size());
  var limit = rot.timeline.gridAt(rot.S).step(rot.S, n);
  var options = settings.unitsOptions(holidays);
  rot.entries.forEach(function (entry) {
    if (entry.slot || !entry.row.pinned || entry.who === null || entry.start <= rot.S || entry.start >= limit) return;
    if (!rot.roster.has(entry.who)) return;
    rot.roster.credit(entry.who, units(entry.start, entry.end, options));
    rot.precredited.add(entry);
  });
}

function hasShiftOverlapping(rot, who, a, b) {
  return rot.entries.some(function (e) { return e.who === who && e.start < b && e.end > a; });
}

function previousAssignee(rot, entry) {
  var previous = null;
  for (var i = 0; i < rot.entries.length && rot.entries[i].start < entry.start; i++) previous = rot.entries[i];
  return previous ? previous.who : null;
}

// DESIGN 5.7 steps 3 and 4.
function tiebreak(rot, entry, candidates, settings) {
  var names = rot.roster.names();
  var chosen = new Set(candidates.map(function (m) { return m.name; }));
  if (settings.get('tiebreak') === 'shuffle') {
    var prefix = settings.get('seed') + '|' + rot.name + '|' + formatDateTime(entry.start) + '|';
    var best = null, bestHash = null;
    names.forEach(function (name) {
      if (!chosen.has(name)) return;
      var h = fnv1a32(prefix + name);
      if (bestHash === null || h < bestHash) { best = name; bestHash = h; }
    });
    return best;
  }
  var from = names.indexOf(previousAssignee(rot, entry)) + 1;
  for (var k = 0; k < names.length; k++) {
    var name = names[(from + k) % names.length];
    if (chosen.has(name)) return name;
  }
  return null;
}

// DESIGN 5.7 and 7. Exclusions are never violated. min_distance steps down with repel kept, then once more
// without repel (warning and note), then nobody. attract holders are preferred inside the band.
function assignSlot(rot, entry, holidays, ctx) {
  var settings = rot.timeline.at(entry.start);
  var roster = rot.roster;
  var a = entry.start, b = entry.slotEnd;
  var minDistance = settings.get('min_distance');
  var grid = rot.timeline.gridAt(a);
  var repelled = relatedHolders(ctx, rot, 'repel', a, b);
  var members = roster.members.filter(function (m) { return !roster.isExcluded(m.name, a, b); });
  var pick = null;
  // The second pass only adds repelled members back, so a pick made there is always a repelled one.
  [true, false].forEach(function (keepRepel) {
    if (pick || (!keepRepel && !repelled.size)) return;
    var pool = keepRepel ? members.filter(function (m) { return !repelled.has(m.name); }) : members;
    for (var d = minDistance; d >= 0 && !pick; d--) {
      var from = grid.step(a, -d), to = grid.step(b, d);
      var eligible = pool.filter(function (m) { return !hasShiftOverlapping(rot, m.name, from, to); });
      if (eligible.length) pick = { eligible: eligible, distance: d, repelDropped: !keepRepel };
    }
  });
  var notes = [];
  if (pick) {
    var lowest = Math.min.apply(null, pick.eligible.map(function (m) { return m.score; }));
    var tolerance = settings.get('tolerance');
    var candidates = pick.eligible.filter(function (m) { return m.score <= lowest + tolerance; });
    var attracted = relatedHolders(ctx, rot, 'attract', a, b);
    var preferred = candidates.filter(function (m) { return attracted.has(m.name); });
    entry.who = tiebreak(rot, entry, preferred.length ? preferred : candidates, settings);
    roster.credit(entry.who, units(a, entry.end, settings.unitsOptions(holidays)));
    if (pick.distance < minDistance) notes.push('min_distance relaxed to ' + pick.distance);
    if (pick.repelDropped) notes.push('repel relaxed: ' + entry.who + ' also on ' + (repelled.get(entry.who) || []).join(', '));
    notes.forEach(function (n) { rot.warnings.push({ start: a, message: n }); });
  } else {
    rot.problems.push({ start: a, message: 'no eligible member for shift ' + formatDateTime(a) + ' to ' + formatDateTime(b) });
  }
  entry.generated = makeRow({ type: 'shift', start: a, what: entry.who === null ? '' : entry.who, note: notes.join('; ') });
}

function sweep(items, rots, holidays, ctx) {
  items.forEach(function (item) {
    var rot = rots[item.rot];
    if (rot.errors.length) return;
    switch (item.kind) {
      case 'row': {
        var message = applyStateRow(rot, item);
        if (message !== null) rot.errors.push(rowError(item.row, message));
        break;
      }
      case 'snapshot':
        rot.snapshotWhat = rot.roster.snapshotWhat();
        rot.scoresAtS = rot.roster.scores();
        break;
      case 'precredit':
        precredit(rot, holidays);
        break;
      case 'credit':
      case 'tail':
        if (!rot.precredited.has(item.entry)) {
          rot.roster.credit(item.entry.who, units(item.a, item.b, rot.timeline.at(item.a).unitsOptions(holidays)));
        }
        break;
      case 'slot':
        assignSlot(rot, item.entry, holidays, ctx);
        break;
    }
  });
}

function collectErrors(rots, list) {
  var out = [];
  rots.forEach(function (rot) {
    rot[list].forEach(function (e) {
      out.push({ rotation: rot.name, rowIndex: e.rowIndex === undefined ? null : e.rowIndex, start: e.start, message: e.message });
    });
  });
  return out;
}

function writable(rots) {
  return rots.filter(function (rot) { return !rot.frozen; });
}

// DESIGN 6: rows unchanged plus an error row above each offending row.
function errorOutput(rots, global, now) {
  var errors = collectErrors(rots, 'errors').concat(global.errors);
  return {
    rotations: writable(rots).map(function (rot) {
      return { name: rot.name, rows: sortRows(rot.errors.map(errorRow).concat(rot.rows)) };
    }),
    global: { rows: global.rows, errors: global.errors },
    errors: errors,
    regenerated: false,
    status: buildStatus([], [], errors, now),
  };
}

function globalError(e) {
  return { rotation: GLOBAL_TAB, rowIndex: e.rowIndex, start: e.start, message: e.message };
}

// #Global rows parsed against the rotation names: set rows for the timelines, relation rows for the sweep,
// error rows for the tab. A bad set row blocks regeneration (blocking); relation errors never do.
function prepareGlobal(rows, names) {
  var parsed = parseGlobal(rows || [], names);
  return { rows: parsed.rows, errors: parsed.errors.map(globalError), blocking: parsed.setErrors.length > 0, setRows: parsed.setRows, relationRows: parsed.relationRows };
}

// Relation state, sweep order and rotation lookup for the sweep (DESIGN 7). Rotation-tab relation rows are
// checked here against the rotation names; rejected rows and rows inside an order cycle get a non-blocking
// error row in their own tab.
function relationContext(global, rots) {
  var names = rots.map(function (r) { return r.name; });
  var byName = {};
  rots.forEach(function (rot) { byName[rot.name] = rot; });
  var entries = global.relationRows.map(function (row) { return { row: row, reader: null, names: whatNames(row) }; });
  rots.forEach(function (rot) {
    (rot.kept || []).filter(isRelationRow).forEach(function (row) {
      var message = validateRelationRow(row, names, rot.name);
      if (message !== null) rot.problems.push(rowError(row, message));
      else entries.push({ row: row, reader: rot.name, names: whatNames(row) });
    });
  });
  var relations = new Relations();
  entries.forEach(function (entry) { relations.add(entry); });
  // Only states that can be in force from the earliest snapshot on order the sweep; only one-sided rows
  // create edges, so only rotation-tab rows can form a cycle.
  var snapshots = rots.filter(function (r) { return r.S !== undefined; }).map(function (r) { return r.S; });
  var minS = snapshots.length ? Math.min.apply(null, snapshots) : -Infinity;
  var ordered = relationOrder(relations.orderEdges(minS), names);
  ordered.ignored.forEach(function (entry) {
    relations.remove(entry);
    byName[entry.reader].problems.push(rowError(entry.row, cycleMessage(entry, ordered.cyclic)));
  });
  rots.forEach(function (rot) { rot.rank = ordered.order.indexOf(rot.name); });
  return { relations: relations, byName: byName };
}

// Script rows go in front of the kept rows so undated comments still attach to the next kept row below them.
function rotationOutput(rot) {
  var rows = [makeRow({ type: 'snapshot', start: rot.S, what: rot.snapshotWhat })];
  rot.entries.forEach(function (e) { if (e.generated) rows.push(e.generated); });
  return { name: rot.name, rows: sortRows(rows.concat(rot.problems.map(errorRow), rot.kept)) };
}

// Pure regeneration of DESIGN 5.3 to 5.8 and 7.
// input: { rotations: [{ name, rows, snapshotAt }], holidays: [dayIndex], global: #Global row objects, now, only }.
// now is optional and only dates the effective settings in the status; the ledgers never depend on it.
// only: optional list of rotation names to regenerate; the others are swept frozen and not returned.
// Output: { rotations: [{ name, rows }], global: { rows, errors }, errors, regenerated, status }.
function regenerate(input) {
  var holidays = new Set(input.holidays || []);
  var only = input.only || null;
  var global = prepareGlobal(input.global, input.rotations.map(function (r) { return r.name; }));
  var rots = input.rotations.map(function (r, i) {
    return prepareRotation(r, i, holidays, only !== null && only.indexOf(r.name) < 0, global.setRows);
  });
  var ctx = relationContext(global, rots);
  var hasErrors = function () { return global.blocking || rots.some(function (rot) { return rot.errors.length > 0; }); };
  if (hasErrors()) return errorOutput(rots, global, input.now);
  sweep(mergeItems(rots), rots, holidays, ctx);
  if (hasErrors()) return errorOutput(rots, global, input.now);
  // Problems with a row (rejected relation rows) are errors in the status; unassignable slots are warnings.
  var problems = collectErrors(rots, 'problems');
  var rowProblems = problems.filter(function (p) { return p.rowIndex !== null; });
  var slotProblems = problems.filter(function (p) { return p.rowIndex === null; });
  return {
    rotations: writable(rots).map(rotationOutput),
    regenerated: true,
    global: { rows: global.rows, errors: global.errors },
    errors: problems.concat(global.errors),
    status: buildStatus(rots, collectErrors(rots, 'warnings').concat(slotProblems), rowProblems.concat(global.errors), input.now, ctx.relations),
  };
}

// ---- 50_status.js ----
// Status data and the 2D text arrays for the #Status and #All shifts tabs (DESIGN 5.8).

var STATUS_WIDTH = 17;
var STATUS_GAP = 2;
var STATUS_KEYS_WIDTH = 3;
var STATUS_SETTINGS_WIDTH = 3;
var SHIFTS_HEADER = ['start'];
var NOW_MARK = '--now--';
var MEMBER_HEADER = ['member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions'];

function statusInstant(min) {
  return min === null || min === undefined ? '' : formatDateTime(min);
}

function formatSettingValue(key, value) {
  if (value === null || value === undefined) return '';
  if (key === 'anchor') return formatDateTime(value);
  if (key === 'period' || key === 'horizon') return formatDuration(value);
  return String(value);
}

// Every SETTINGS key with its effective value and source (rotation, global, default) at `at`, plus the start
// of the next set row of either layer after `at`.
function effectiveSettings(timeline, at) {
  var values = timeline.at(at).values;
  var sources = timeline.sourcesAt(at);
  var next = null;
  timeline.entries.forEach(function (e) { if (e.start > at && next === null) next = e.start; });
  return {
    at: at,
    values: Object.keys(SETTINGS).map(function (key) {
      return { key: key, value: formatSettingValue(key, values[key]), source: sources[key] };
    }),
    nextSetAt: next,
  };
}

function shiftRef(entry) {
  return entry ? { who: entry.who === null ? '' : entry.who, start: entry.start, end: entry.end } : null;
}

// rot: swept rotation internals from 40_scheduler.js (roster, scoresAtS, entries, S, horizonEnd, timeline).
// now: run instant for the settings block and the current/next shift; S when absent.
function rotationStatus(rot, now) {
  var projected = rot.roster.scores();
  var S = rot.S;
  var at = now === null || now === undefined ? S : now;
  var current = null, upcoming = null;
  rot.entries.forEach(function (e) {
    if (e.start <= at && e.end > at) current = e;
    else if (e.start > at && upcoming === null) upcoming = e;
  });
  return {
    name: rot.name,
    snapshotAt: S,
    horizonEnd: rot.horizonEnd,
    current: shiftRef(current),
    next: shiftRef(upcoming),
    settings: effectiveSettings(rot.timeline, at),
    roster: rot.roster.members.map(function (m) {
      var last = null, next = null;
      rot.entries.forEach(function (e) {
        if (e.who !== m.name) return;
        if (e.start <= S) last = e.start;
        else if (next === null) next = e.start;
      });
      return {
        name: m.name,
        score: rot.scoresAtS[m.name] === undefined ? null : rot.scoresAtS[m.name],
        projected: projected[m.name],
        lastShift: last,
        nextShift: next,
        exclusions: m.exclusions
          .filter(function (ex) { return ex.from <= S && (ex.to === null || ex.to > S); })
          .map(function (ex) { return { from: ex.from, to: ex.to }; }),
      };
    }),
  };
}

// Every shift of every rotation, by start then rotation order. who is '' for a nobody shift.
function shiftsView(rots) {
  var out = [];
  rots.forEach(function (rot) {
    rot.entries.forEach(function (e) {
      out.push({ start: e.start, rotation: rot.name, who: e.who === null ? '' : e.who });
    });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

// Pair states in force at `at`: { reader, target, kind } for every ordered pair, mutual states twice.
function relationsView(rots, relations, at) {
  var out = [];
  if (!relations || at === null) return out;
  var names = rots.map(function (r) { return r.name; });
  names.forEach(function (reader) {
    names.forEach(function (target) {
      if (reader === target) return;
      var kind = relations.kindFor(reader, target, at);
      if (kind !== null) out.push({ reader: reader, target: target, kind: kind });
    });
  });
  return out;
}

// rots: swept rotations, or [] when a validation error stopped the run. now: optional run instant.
// relations: the Relations of the sweep, or null.
function buildStatus(rots, warnings, errors, now, relations) {
  var at = now === null || now === undefined ? null : now;
  return {
    at: at,
    rotations: rots.map(function (rot) { return rotationStatus(rot, now); }),
    relations: relationsView(rots, relations, at),
    warnings: warnings,
    errors: errors,
    shifts: shiftsView(rots),
  };
}

function padCells(cells, width) {
  return cells.concat(new Array(Math.max(0, width - cells.length)).fill(''));
}

function padStatusRow(cells) {
  return padCells(cells, STATUS_WIDTH);
}

function formatExclusions(list) {
  return list.map(function (ex) {
    return statusInstant(ex.from) + ' to ' + (ex.to === null ? 'open' : statusInstant(ex.to));
  }).join('; ');
}

// Column groups side by side: each padded to its width and to the tallest group, STATUS_GAP empty columns between.
function sideBySide(groups) {
  var height = Math.max.apply(null, groups.map(function (g) { return g.rows.length; }));
  var out = [];
  for (var i = 0; i < height; i++) {
    var row = [];
    groups.forEach(function (g, k) {
      if (k > 0) row = row.concat(new Array(STATUS_GAP).fill(''));
      row = row.concat(padCells(g.rows[i] || [], g.width));
    });
    out.push(row);
  }
  return out;
}

// One rotation as three groups of rows: key/value rows, member table, settings table (DESIGN 5.8).
function rotationGroups(rot) {
  var keys = [
    ['rotation', rot.name],
    ['snapshot', statusInstant(rot.snapshotAt)],
    ['horizon', statusInstant(rot.horizonEnd)],
    ['current', rot.current ? rot.current.who : '', rot.current ? 'until ' + statusInstant(rot.current.end) : ''],
    ['next', rot.next ? rot.next.who : '', rot.next ? 'from ' + statusInstant(rot.next.start) : ''],
  ];
  var members = [MEMBER_HEADER.slice()].concat(rot.roster.map(function (m) {
    return [m.name, rot.current && rot.current.who === m.name ? 'x' : '',
      m.score === null ? '' : formatScore(m.score), formatScore(m.projected),
      statusInstant(m.lastShift), statusInstant(m.nextShift), formatExclusions(m.exclusions)];
  }));
  var settings = [['settings', 'as of ' + statusInstant(rot.settings.at), 'source']].concat(
    rot.settings.values.map(function (s) { return [s.key, s.value, s.source]; }));
  if (rot.settings.nextSetAt !== null) settings.push(['note', 'a set row at ' + statusInstant(rot.settings.nextSetAt) + ' changes these values']);
  return { keys: keys, members: members, settings: settings };
}

// Spreadsheet arrangement: the three groups side by side, first row is the header of all three.
function horizontalBlock(rot) {
  var g = rotationGroups(rot);
  var rows = sideBySide([
    { rows: g.keys, width: STATUS_KEYS_WIDTH },
    { rows: g.members, width: MEMBER_HEADER.length },
    { rows: g.settings, width: STATUS_SETTINGS_WIDTH },
  ]);
  return { rows: rows, headers: [0] };
}

// CLI arrangement: the groups one after another, tables indented by one cell, each group's first row a header.
function verticalBlock(rot) {
  var g = rotationGroups(rot);
  var indent = function (row) { return [''].concat(row); };
  var rows = g.keys.concat([[]], g.members.map(indent), [[]], g.settings.map(indent));
  return { rows: rows, headers: [0, g.keys.length + 1, g.keys.length + g.members.length + 2] };
}

// Relations matrix rows: header with every rotation, then per reader a row with + (attract) or - (repel).
function relationsMatrix(status) {
  var names = status.rotations.map(function (r) { return r.name; });
  var marks = { attract: '+', repel: '-' };
  var rows = [['Relations'].concat(names)];
  names.forEach(function (reader) {
    rows.push([reader].concat(names.map(function (target) {
      var rel = status.relations.find(function (r) { return r.reader === reader && r.target === target; });
      return rel ? marks[rel.kind] || '' : '';
    })));
  });
  return rows;
}

// Rows of the #Status tab plus presentation metadata: headerRows and dividerRows are row indexes for the
// adapter to format. status.now, status.mode and status.tabs are set by the runner. block: horizontalBlock
// for the spreadsheet, verticalBlock for the CLI.
function statusRowsWith(status, block) {
  var rows = [];
  var headerRows = [];
  var push = function (cells) { rows.push(padStatusRow(cells)); };
  var header = function (cells) { headerRows.push(rows.length); push(cells); };
  header(['Rotalator', status.mode || '', status.now || '']);
  if (status.tabs) {
    push([]);
    header(['Tabs']);
    push(['rotations', status.tabs.rotations.join(', ')]);
    push(['regenerated', status.tabs.regenerated.join(', ')]);
    push(['holidays', String(status.tabs.holidays)]);
    push(['global', String(status.tabs.global)]);
    push(['ignored', status.tabs.ignored.join(', ')]);
  }
  if (status.rotations.length > 1 && (status.relations || []).length) {
    push([]);
    relationsMatrix(status).forEach(function (row, i) { if (i === 0) header(row); else push(row); });
  }
  status.rotations.forEach(function (rot) {
    push([]);
    var b = block(rot);
    b.rows.forEach(function (row, i) { if (b.headers.indexOf(i) >= 0) header(row); else push(row); });
  });
  if (status.warnings.length) {
    push([]);
    header(['warnings']);
    header(['rotation', 'start', 'message']);
    status.warnings.forEach(function (w) { push([w.rotation, statusInstant(w.start), w.message]); });
  }
  if (status.errors.length) {
    push([]);
    header(['errors']);
    header(['rotation', 'where', 'message']);
    status.errors.forEach(function (e) {
      var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex : statusInstant(e.start);
      push([e.rotation, where, e.message]);
    });
  }
  return { rows: rows, headerRows: headerRows, dividerRows: [] };
}

function statusRows(status) {
  return statusRowsWith(status, horizontalBlock);
}

function statusRowsVertical(status) {
  return statusRowsWith(status, verticalBlock);
}

// Rows of the #All shifts grid: header start | <rotation> ..., one row per distinct shift start with the
// assignee starting then in each rotation's column ('-' for nobody), and a now row marked in every rotation
// column after any row with the same start. currentCells [{ row, col }] (0-based) are the cells of each
// rotation's shift covering now; both are empty when status.at is unknown.
function shiftsRows(status) {
  var names = status.rotations.map(function (r) { return r.name; });
  var rows = [SHIFTS_HEADER.concat(names)];
  var dividerRows = [];
  var currentCells = [];
  var at = status.at;
  var known = at !== null && at !== undefined;
  var current = {};
  if (known) status.rotations.forEach(function (r) { if (r.current) current[r.name] = r.current.start; });
  var starts = [];
  var byStart = new Map();
  status.shifts.forEach(function (s) {
    if (!byStart.has(s.start)) { byStart.set(s.start, {}); starts.push(s.start); }
    byStart.get(s.start)[s.rotation] = s.who === '' ? '-' : s.who;
  });
  var nowRow = [statusInstant(at)].concat(names.map(function () { return NOW_MARK; }));
  var placed = !known;
  starts.forEach(function (start) {
    if (!placed && start > at) { dividerRows.push(rows.length); rows.push(nowRow); placed = true; }
    var cells = byStart.get(start);
    names.forEach(function (n, i) { if (current[n] === start) currentCells.push({ row: rows.length, col: i + 1 }); });
    rows.push([statusInstant(start)].concat(names.map(function (n) { return cells[n] || ''; })));
  });
  if (!placed) { dividerRows.push(rows.length); rows.push(nowRow); }
  return { rows: rows, headerRows: [0], dividerRows: dividerRows, currentCells: currentCells };
}

// ---- 60_relations.js ----
// #Global tab (DESIGN 3.5 and 7): spreadsheet-wide set rows, relation rows between rotations, and comments.
// Relation rows (attract, repel, detach) also appear in rotation tabs, where they are one-sided.

var RELATION_TYPES = ['attract', 'repel', 'detach'];

function isRelationRow(row) {
  return RELATION_TYPES.indexOf(row.type) >= 0;
}

// Relation-specific checks. reader: the rotation whose tab holds the row, null for #Global.
function validateRelationRow(row, rotationNames, reader) {
  var names = whatNames(row);
  if (new Set(names).size !== names.length) return row.type + ' names a rotation twice';
  if (reader === null && names.length < 2) return row.type + ' in ' + GLOBAL_TAB + ' needs at least two rotations';
  for (var i = 0; i < names.length; i++) {
    if (names[i] === reader) return row.type + ' names its own rotation';
    if (rotationNames.indexOf(names[i]) < 0) return 'unknown rotation "' + names[i] + '"';
  }
  return null;
}

// rows: #Global row objects. Returns { setRows, setErrors, relationRows, errors, rows } where rows are the kept
// rows plus an error row above each rejected one. set rows are validated with the ledger rules; a bad one is in
// setErrors and blocks regeneration since every rotation depends on it. Rejected relation rows are ignored.
// Comments are kept and otherwise ignored.
function parseGlobal(rows, rotationNames) {
  var errors = [];
  var setErrors = [];
  var setRows = [];
  var relationRows = [];
  var kept = sortRows(attachComments(rows.filter(function (r) { return r.type !== 'error'; })));
  kept.forEach(function (row) {
    if (row.type === 'comment') return;
    if (row.type === 'set') {
      var problem = validateRow(row);
      if (problem === null) setRows.push(row); else setErrors.push(rowError(row, problem));
      return;
    }
    var message = !isRelationRow(row) ? (row.type === '' ? 'missing type' : 'type "' + row.type + '" is not allowed in ' + GLOBAL_TAB)
      : validateRow(row) || validateRelationRow(row, rotationNames, null);
    if (message === null) relationRows.push(row); else errors.push(rowError(row, message));
  });
  var all = setErrors.concat(errors);
  return { setRows: setRows, setErrors: setErrors, relationRows: relationRows, errors: all, rows: sortRows(all.map(errorRow).concat(kept)) };
}

function pairKey(a, b) {
  return a < b ? a + '\u0000' + b : b + '\u0000' + a;
}

// Pair states over time. Each relation row sets the state of every pair it names from its start (latest row
// wins, ties by processing order) and reverts it to neutral at its end. reader null means mutual; two tabs
// starting the same one-sided relation on each other at the same instant make the pair mutual.
class Relations {
  constructor() {
    this.events = new Map();
  }

  // entry: { row, reader, names }. Pairs: all pairs of names for #Global, (reader, name) for a rotation tab.
  add(entry) {
    var self = this;
    var kind = entry.row.type === 'detach' ? null : entry.row.type;
    var pairs = [];
    if (entry.reader === null) {
      entry.names.forEach(function (a, i) { entry.names.slice(i + 1).forEach(function (b) { pairs.push([a, b]); }); });
    } else {
      entry.names.forEach(function (b) { pairs.push([entry.reader, b]); });
    }
    pairs.forEach(function (p) {
      var key = pairKey(p[0], p[1]);
      if (!self.events.has(key)) self.events.set(key, []);
      var list = self.events.get(key);
      var opposite = list.find(function (e) {
        return e.starts === 1 && e.t === entry.row.start && e.kind === kind && e.reader !== null && e.reader === p[1] && entry.reader !== null;
      });
      if (opposite) { opposite.reader = null; opposite.target = null; }
      else list.push({ t: entry.row.start, starts: 1, seq: list.length, kind: kind, reader: entry.reader, target: p[1], entry: entry });
      if (entry.row.end !== null) list.push({ t: entry.row.end, starts: 0, seq: list.length, kind: null, reader: null, target: null, entry: entry });
    });
  }

  remove(entry) {
    this.events.forEach(function (list, key, map) {
      map.set(key, list.filter(function (e) { return e.entry !== entry; }));
    });
  }

  // Ends sort before starts at equal instants; later-added rows win among starts.
  sorted(list) {
    return list.slice().sort(function (x, y) { return (x.t - y.t) || (x.starts - y.starts) || (x.seq - y.seq); });
  }

  // { kind, reader } in force between a and b at t, or null.
  stateAt(a, b, t) {
    var list = this.events.get(pairKey(a, b));
    if (!list) return null;
    var sorted = this.sorted(list);
    var state = null;
    for (var i = 0; i < sorted.length && sorted[i].t <= t; i++) state = sorted[i].kind === null ? null : sorted[i];
    return state;
  }

  // The kind reader is subject to towards other at t: a mutual state, or a one-sided one it holds itself.
  kindFor(reader, other, t) {
    var state = this.stateAt(reader, other, t);
    if (!state || (state.reader !== null && state.reader !== reader)) return null;
    return state.kind;
  }

  // Order edges { from, to, entry } (from is decided before to) of the one-sided states that are or will be in
  // force from t on: per pair the last event at or before t and every event after it. Mutual states add none.
  orderEdges(t) {
    var edges = [];
    var self = this;
    this.events.forEach(function (list) {
      var sorted = self.sorted(list);
      var from = 0;
      for (var i = 0; i < sorted.length; i++) if (sorted[i].t <= t) from = i;
      for (var j = from; j < sorted.length; j++) {
        var e = sorted[j];
        if (e.kind !== null && e.reader !== null) edges.push({ from: e.target, to: e.reader, entry: e.entry });
      }
    });
    return edges;
  }
}

// Kahn's algorithm with tab order as tiebreak. Returns { order, rest } where rest holds the rotations left in
// cycles (and those only reachable through them).
function topologicalOrder(edges, rotationNames) {
  var pending = edges.slice();
  var order = [];
  var rest = rotationNames.slice();
  var progress = true;
  while (progress) {
    progress = false;
    for (var i = 0; i < rest.length; i++) {
      var name = rest[i];
      if (pending.some(function (e) { return e.to === name; })) continue;
      order.push(name);
      rest.splice(i, 1);
      pending = pending.filter(function (e) { return e.from !== name; });
      progress = true;
      break;
    }
  }
  return { order: order, rest: rest };
}

// Rotations inside dependency cycles: what remains after repeatedly dropping sources and sinks. A rotation on
// a path between two cycles is included too.
function cyclicRotations(edges, rotationNames) {
  var nodes = rotationNames.slice();
  var changed = true;
  while (changed) {
    changed = false;
    nodes = nodes.filter(function (n) {
      var hasIn = edges.some(function (e) { return e.to === n && nodes.indexOf(e.from) >= 0; });
      var hasOut = edges.some(function (e) { return e.from === n && nodes.indexOf(e.to) >= 0; });
      if (hasIn && hasOut) return true;
      changed = true;
      return false;
    });
  }
  return nodes;
}

// Sweep order at equal starts (DESIGN 7): every rotation after the rotations it reads, then tab order. Entries
// whose edges lie inside a cycle are returned in `ignored`; the order is computed without them.
function relationOrder(edges, rotationNames) {
  var cyclic = cyclicRotations(edges, rotationNames);
  var ignored = [];
  var kept = edges.filter(function (e) {
    var inCycle = cyclic.indexOf(e.from) >= 0 && cyclic.indexOf(e.to) >= 0;
    if (inCycle && ignored.indexOf(e.entry) < 0) ignored.push(e.entry);
    return !inCycle;
  });
  var result = topologicalOrder(kept.filter(function (e) { return ignored.indexOf(e.entry) < 0; }), rotationNames);
  return { order: result.order.concat(result.rest), ignored: ignored, cyclic: cyclic };
}

function cycleMessage(entry, cyclic) {
  var others = cyclic.filter(function (n) { return n !== entry.reader; });
  return 'relation order cycle among ' + others.join(', ') + '; use a ' + GLOBAL_TAB + ' row';
}

// Members holding a decided shift overlapping [a, b) in rotations that `kind` applies to for rot at a:
// Map of member -> rotation names.
function relatedHolders(ctx, rot, kind, a, b) {
  var holders = new Map();
  Object.keys(ctx.byName).forEach(function (other) {
    var target = ctx.byName[other];
    if (target === rot || ctx.relations.kindFor(rot.name, other, a) !== kind) return;
    target.entries.forEach(function (e) {
      if (e.who === null || e.start >= b || e.end <= a) return;
      if (!holders.has(e.who)) holders.set(e.who, []);
      if (holders.get(e.who).indexOf(other) < 0) holders.get(e.who).push(other);
    });
  });
  return holders;
}

// ---- 70_tools.js ----
// Row logic behind the Set up, Template and Fill Shifts Grid tools (DESIGN 10). Pure; adapters read and write cells.

var TEMPLATE_TEAM = 'alice, bob, carol';
var TEMPLATE_PERIOD = '1w';
var HOLIDAYS_HEADER = ['date', 'note'];

var COLUMN_NOTES = {
  pin: 'Any non-empty value pins the row: the script never modifies or deletes it. A ticked checkbox works too.',
  start: 'YYYY-MM-DDTHH:MM in the spreadsheet time zone. Mandatory. Keep the column as plain text.',
  type: 'shift, team, join, leave, exclude, include, score, set. The script writes snapshot and error rows.',
  what: 'Payload of the row: one member for shift; a list for team, join, leave, exclude, include, score; key=value settings for set.',
  end: 'YYYY-MM-DDTHH:MM. Optional. Not together with duration.',
  duration: '1w, 3d, 12h, 1d12h. Optional. Not together with end.',
  note: 'Free text. Kept on your rows; the script writes notes on generated rows.',
  date: 'YYYY-MM-DD, one holiday per row. Counted by rotations with skip_holidays=true.',
};

// Most recent Monday 00:00 at or before t.
function recentMonday(t) {
  var day = dayIndex(t);
  return dayStart(day - (weekdayOfDay(day) + 6) % 7);
}

// Whole days as Nd, otherwise the short chained form.
function templateDuration(min) {
  return min % MINUTES_PER_DAY === 0 ? min / MINUTES_PER_DAY + 'd' : formatDuration(min);
}

// Every setting spelled out at its default: period=1w, bare anchor, the rest key=default.
function templateSetWhat() {
  return Object.keys(SETTINGS).map(function (key) {
    if (key === 'period') return 'period=' + TEMPLATE_PERIOD;
    if (key === 'anchor') return 'anchor';
    var def = SETTINGS[key].def;
    return key + '=' + (key === 'horizon' ? templateDuration(def) : String(def));
  }).join(', ');
}

var GLOBAL_TEMPLATE_NOTE = 'Spreadsheet-wide defaults and relations. A set row here applies to every rotation ' +
  'from its start unless the rotation sets the same key itself; attract, repel and detach rows relate rotations; rows without a ' +
  'type are comments.';

// Header and one explanatory comment row of a new #Global tab.
function globalTemplateRows() {
  return [LEDGER_HEADER.slice(), ['', '', '', '', '', '', GLOBAL_TEMPLATE_NOTE]];
}

// Header, set and team cell rows of a new rotation tab, dated firstStart.
function templateRows(firstStart) {
  var start = formatDateTime(firstStart);
  return [
    LEDGER_HEADER.slice(),
    ['', start, 'set', templateSetWhat(), '', '', ''],
    ['', start, 'team', TEMPLATE_TEAM, '', '', ''],
  ];
}

function previousBoundary(grid, t) {
  var b = grid.floor(t);
  return b < t ? b : grid.step(b, -1);
}

function emptyShiftRow(start) {
  return makeRow({ type: 'shift', start: start });
}

// Grid at t, or the first grid of the timeline for instants before its first set row.
function gridFor(timeline, t) {
  return timeline.gridAt(t) || timeline.gridAt(timeline.entries[0].start);
}

// DESIGN 10: dated rows sorted; between the first row and the later of the last shift claim end and the last
// row start, every uncovered boundary and gap start gets an empty shift row; nPre boundaries before the first
// row and nPost rows from the tail on. rows: dated row objects at or after the timeline's first set row.
function gridRows(rows, nPre, nPost, timeline) {
  var sorted = sortRows(rows);
  var dated = sorted.filter(function (r) { return r.start !== null; });
  if (!dated.length) return sorted;
  var changes = timeline.gridChanges();
  var shifts = rowsOfType(sorted, 'shift');
  var claims = shifts.map(function (s, i) {
    return [s.start, claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes)];
  });
  var first = dated[0].start;
  var lastStart = dated[dated.length - 1].start;
  var claimsEnd = claims.length ? claims[claims.length - 1][1] : first;
  var regionEnd = Math.max(claimsEnd, lastStart);

  var out = [];
  var slots = [];
  uncoveredSpans(first, regionEnd, claims).forEach(function (span) { splitSlots(span[0], span[1], timeline, changes, slots); });
  slots.forEach(function (slot) { out.push(emptyShiftRow(slot.start)); });

  var t = first;
  for (var i = 0; i < nPre; i++) {
    t = previousBoundary(gridFor(timeline, t), t);
    out.push(emptyShiftRow(t));
  }
  // The tail starts at a mid-period claim end (a gap start) or at the boundary at or after the last row.
  t = Math.max(claimsEnd, timeline.gridAt(lastStart).ceil(lastStart));
  for (var j = 0; j < nPost; j++) {
    out.push(emptyShiftRow(t));
    t = timeline.gridAt(t).next(t);
  }
  // New rows go in front so undated comments keep attaching to the selected row below them.
  return sortRows(out.concat(sorted));
}

// An undated selection row counts as an empty grid position when it is blank or carries type=shift and
// nothing else; any other undated row is a comment that travels with the next dated row.
function isTemplateShiftRow(cells) {
  return cells.every(function (c, i) { return i === 2 ? cellText(c).toLowerCase() === 'shift' : cellText(c) === ''; });
}

// A dated row with nothing but its start (and pin) is a grid position, not a comment.
function hasOnlyStart(cells) {
  return cells.every(function (c, i) { return i === 0 || i === 1 || cellText(c) === ''; });
}

// Fill Shifts Grid over a selection. selectedCells: the ledger columns of the selected rows; tabCells: every
// row of the tab below the header, for the settings timeline; holidayTexts: #Holidays column A; globalCells:
// #Global rows below the header, for global set rows. Returns { rows: cell arrays } or { error: message }.
// Dated comments stay in place; undated comments attach to the next dated row, trailing ones stay at the end.
function fillShiftsGridCells(selectedCells, tabCells, holidayTexts, globalCells) {
  var holidays = new Set();
  (holidayTexts || []).forEach(function (text) { var day = parseDay(text ?? ''); if (day !== null) holidays.add(day); });
  var localSets = sortRows(rowsOfType(rowsFromCells(tabCells), 'set'));
  var globalSets = rowsOfType(rowsFromCells(globalCells || []), 'set');
  var timeline = new SettingsTimeline(localSets, holidays, globalSets);
  var firstStart = localSets.length ? localSets[0].start : null;
  if (firstStart === null || timeline.at(firstStart).get('period') === null) {
    return { error: 'the tab needs a set row with period before the grid can be filled' };
  }
  var dated = [];
  var comments = [];
  var pre = 0, post = 0;
  for (var i = 0; i < selectedCells.length; i++) {
    var cells = selectedCells[i];
    var startText = cellText(cells[1]);
    var row = rowFromArray(cells, i + 1);
    row.cells = cells.slice();
    if (startText === '') {
      if (isBlankRow(cells) || isTemplateShiftRow(cells)) { if (dated.length) post++; else pre++; continue; }
      if (row.type !== 'comment') return { error: 'selected row ' + (i + 1) + ' has content but no start' };
      comments.push(row);
      continue;
    }
    if (row.start === null) return { error: 'selected row ' + (i + 1) + ': bad start "' + startText + '"' };
    if (row.start < firstStart) return { error: 'selected row ' + (i + 1) + ' is dated before the first set row' };
    if (row.type === 'comment' && hasOnlyStart(cells)) row.type = 'shift';
    if (row.type !== 'comment') row.cells[2] = row.type;
    dated = dated.concat(comments, [row]);
    comments = [];
    post = 0;
  }
  if (!dated.length) return { error: 'the selection has no dated row to start from' };
  var out = gridRows(dated, pre, post, timeline).concat(comments);
  if (out[0].start < firstStart) return { error: pre + ' empty row(s) above would fall before the first set row' };
  return { rows: out.map(function (r) { return r.cells || rowToArray(r); }) };
}

// ---- 80_runner.js ----
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

// ---- 90_gas.js ----
// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';
var FONT_FAMILY = 'Roboto Mono';
var TAB_COLOR_GENERATED = '#4285f4';
var TAB_COLOR_EDITABLE = '#9e9e9e';
var DEFAULT_ROTATION_TAB = 'On-Call';
var LEDGER_COLUMN_WIDTHS = { pin: 40, start: 150, type: 80, what: 320, end: 150, duration: 80, note: 640 };
var HOLIDAYS_COLUMN_WIDTHS = { date: 110, note: 640 };
var SHIFTS_START_WIDTH = 150;
var SHIFTS_ROTATION_WIDTH = 240;
// #Status: keys | names or dates | dates | gap | gap | member | mark | score | projected | last | next |
// exclusions | gap | gap | setting | value | source.
var STATUS_COLUMN_WIDTHS = [100, 150, 150, 60, 60, 120, 60, 100, 100, 150, 150, 150, 60, 60, 100, 150, 100];

// Pastel palette (DESIGN 10.1).
var COLOR_HEADER = '#eeeeee';
var COLOR_DIVIDER = '#d9ead3';
var COLOR_ERROR = '#f4c7c3';
var COLOR_SETTINGS = '#c9daf8';
var COLOR_ROSTER = '#d0e0e3';
var COLOR_SNAPSHOT = '#d9ead3';
var COLOR_COMMENT = '#fff2cc';
var COLOR_CURRENT_CELL = COLOR_COMMENT;
var COLOR_RELATION = '#d9ead3';
var COLOR_DETACH = '#efefef';

// Conditional formatting over A:G, keyed on the type cell; comment rows have content but no type.
var COMMENT_FORMULA = '=AND($C1="", COUNTA($A1:$G1)>0)';
var LEDGER_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="team", $C1="join", $C1="leave", $C1="include", $C1="exclude")', color: COLOR_ROSTER },
  { formula: '=$C1="snapshot"', color: COLOR_SNAPSHOT },
  { formula: '=OR($C1="attract", $C1="repel")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];
var GLOBAL_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="attract", $C1="repel")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];

// Storage interface of DESIGN 8 over the active spreadsheet. With preview set, ledgers are written to
// '#Preview <rotation>' tabs instead of the ledger tabs. Ledgers are written as plain text only.
class SheetsStorage {
  constructor(spreadsheet, options) {
    this.ss = spreadsheet;
    this.tz = spreadsheet.getSpreadsheetTimeZone();
    this.preview = Boolean(options && options.preview);
    this.nowText = Utilities.formatDate(new Date(), this.tz, CELL_DATETIME_FORMAT);
    this.tabs = null;
  }

  isDateCell(cell) {
    return Object.prototype.toString.call(cell) === '[object Date]';
  }

  formatCell(cell, pattern) {
    return this.isDateCell(cell) ? Utilities.formatDate(cell, this.tz, pattern) : cell;
  }

  // Cell values with real Date cells converted to canonical text in the spreadsheet time zone.
  readValues(sheet, pattern) {
    var self = this;
    return sheet.getDataRange().getValues().map(function (row) {
      return row.map(function (cell) { return self.formatCell(cell, pattern); });
    });
  }

  // Rotations are the non-'#' tabs with the ledger header; only the ledger columns are read. Every other tab
  // except the known system tabs is reported as ignored, so a disabled '#<rotation>' shows up in #Status.
  scanTabs() {
    if (this.tabs) return this.tabs;
    var ledgers = {};
    var ignored = [];
    var self = this;
    this.ss.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (isSystemTab(name)) {
        if (!isKnownSystemTab(name)) ignored.push(name);
        return;
      }
      var header = sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0];
      if (!isLedgerHeader(header)) { ignored.push(name); return; }
      ledgers[name] = self.readValues(sheet, CELL_DATETIME_FORMAT).slice(1)
        .map(function (row) { return row.slice(0, LEDGER_HEADER.length); });
    });
    this.tabs = { ledgers: ledgers, ignored: ignored };
    return this.tabs;
  }

  readLedgers() {
    return this.scanTabs().ledgers;
  }

  ignoredTabs() {
    return this.scanTabs().ignored.slice();
  }

  // Date texts per row after the header, null for blank rows so row numbers stay aligned.
  readHolidays() {
    var sheet = this.ss.getSheetByName(HOLIDAYS_TAB);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATE_FORMAT);
    var body = rows.length && cellText(rows[0][0]).toLowerCase() === 'date' ? rows.slice(1) : rows;
    return body.map(function (r) { return isBlankRow(r) ? null : cellText(r[0]); });
  }

  // The #Global tab must carry the ledger header; anything else is ignored.
  readGlobal() {
    var sheet = this.ss.getSheetByName(GLOBAL_TAB);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATETIME_FORMAT);
    return rows.length && isLedgerHeader(rows[0]) ? rows.slice(1).map(function (row) { return row.slice(0, LEDGER_HEADER.length); }) : [];
  }

  sheetNamed(name) {
    return this.ss.getSheetByName(name) || this.ss.insertSheet(name);
  }

  // A missing preview tab is created right after the tab it previews; an existing one is never moved.
  previewSheet(name) {
    var sheet = this.ss.getSheetByName(previewTabName(name));
    if (sheet) return sheet;
    var base = this.ss.getSheetByName(name);
    return this.ss.insertSheet(previewTabName(name), base ? base.getIndex() : this.ss.getNumSheets());
  }

  writeTextRows(sheet, row, rows) {
    if (!rows.length) return;
    var width = rows[0].length;
    var range = sheet.getRange(row, 1, rows.length, width);
    range.setNumberFormat('@');
    range.setFontFamily(FONT_FAMILY);
    range.setValues(rows);
  }

  // Bold grey header rows, a green divider and yellow current cells, from the 0-based indexes the status
  // module reports in table { headerRows, dividerRows, currentCells }.
  formatTableRows(sheet, width, table) {
    var paint = function (indexes, color) {
      (indexes || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setBackground(color); });
    };
    (table.headerRows || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setFontWeight('bold'); });
    paint(table.headerRows, COLOR_HEADER);
    paint(table.dividerRows, COLOR_DIVIDER);
    (table.currentCells || []).forEach(function (c) { sheet.getRange(c.row + 1, c.col + 1).setBackground(COLOR_CURRENT_CELL); });
  }

  // Rows below the header of a ledger-shaped tab; previews go to '#Preview <name>' with a fresh header.
  writeLedgerRows(name, rows) {
    var sheet;
    if (this.preview) {
      sheet = this.previewSheet(name);
      sheet.clear();
      this.writeTextRows(sheet, 1, [LEDGER_HEADER]);
      this.formatTableRows(sheet, LEDGER_HEADER.length, { headerRows: [0] });
    } else {
      sheet = this.ss.getSheetByName(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, LEDGER_HEADER.length).clearContent();
    }
    this.writeTextRows(sheet, 2, rows);
  }

  writeLedger(rotation, rows) {
    this.writeLedgerRows(rotation, rows);
  }

  writeGlobal(rows) {
    this.writeLedgerRows(GLOBAL_TAB, rows);
  }

  // Generated tabs are cleared with their formats and rewritten; table: { rows, headerRows, dividerRows, currentCells }.
  writeTable(name, table) {
    var sheet = this.sheetNamed(name);
    sheet.clear();
    this.writeTextRows(sheet, 1, table.rows);
    if (table.rows.length) this.formatTableRows(sheet, table.rows[0].length, table);
  }

  // #Status and #All shifts tabs, rewritten in full from the status data (DESIGN 5.8).
  writeStatus(data) {
    this.writeTable(STATUS_TAB, statusRows(data));
    var shifts = shiftsRows(data);
    this.writeTable(ALL_SHIFTS_TAB, shifts);
    var sheet = this.ss.getSheetByName(ALL_SHIFTS_TAB);
    shifts.rows[0].forEach(function (cell, i) { sheet.setColumnWidth(i + 1, i === 0 ? SHIFTS_START_WIDTH : SHIFTS_ROTATION_WIDTH); });
    sheet.setFrozenRows(1);
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rotalator')
    .addItem('Run', 'run')
    .addItem('Run - dry run', 'dryRun')
    .addItem('Run for current rotation', 'runCurrent')
    .addItem('Run for current rotation - dry run', 'dryRunCurrent')
    .addSeparator()
    .addItem('Set Up Spreadsheet', 'setupSpreadsheet')
    .addItem('Set Up Tab', 'setupTab')
    .addItem('Fill Shifts Grid', 'fillShiftsGrid')
    .addSeparator()
    .addItem('Install nightly trigger', 'installTrigger')
    .addItem('Remove trigger', 'removeTrigger')
    .addToUi();
}

// On errors the ledgers are still written: rows unchanged plus error rows (DESIGN 6).
// rotations: names to regenerate, or null for all.
function runWith(preview, rotations) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss, { preview: preview });
  var options = { write: true, mode: preview ? 'dry run' : 'run' };
  if (rotations) options.rotations = rotations;
  var result = runStorage(storage, storage.nowText, options);
  var title = preview ? 'Rotalator dry run' : 'Rotalator';
  var what = rotations ? rotations.join(', ') : Object.keys(result.ledgers).length + ' rotation(s)';
  var message = result.errors.length
    ? result.errors.length + ' error(s): ' + result.errors[0]
    : what + ' ' + (preview ? 'previewed' : 'updated') + ' at ' + storage.nowText;
  result.errors.forEach(function (e) { console.log(e); });
  ss.toast(message, title, 10);
  return result;
}

function run() {
  return runWith(false, null);
}

function dryRun() {
  return runWith(true, null);
}

// The active tab must be a rotation tab.
function currentRotation() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) || !isLedgerHeader(sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0])) {
    toast('"' + name + '" is not a rotation tab');
    return null;
  }
  return name;
}

function runCurrent() {
  var name = currentRotation();
  return name === null ? null : runWith(false, [name]);
}

function dryRunCurrent() {
  var name = currentRotation();
  return name === null ? null : runWith(true, [name]);
}

function deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function installTrigger() {
  deleteTriggers();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyDays(1).atHour(2).inTimezone(ss.getSpreadsheetTimeZone()).create();
  ss.toast('Nightly run installed between 02:00 and 03:00 ' + ss.getSpreadsheetTimeZone(), 'Rotalator', 10);
}

function removeTrigger() {
  deleteTriggers();
  SpreadsheetApp.getActiveSpreadsheet().toast('Nightly run removed', 'Rotalator', 10);
}

function toast(message, title) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, title || 'Rotalator', 10);
}

function isEmptySheet(sheet) {
  return sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
}

function writeHeaderRow(sheet, header) {
  var range = sheet.getRange(1, 1, 1, header.length);
  range.setNumberFormat('@');
  range.setValues([header]);
}

// Header, column widths and notes per tab kind; null for tabs the script does not shape: unknown '#' tabs
// and non-empty tabs without the ledger header.
function tabLayout(sheet) {
  var name = sheet.getName();
  if (name === HOLIDAYS_TAB) return { header: HOLIDAYS_HEADER, widths: HOLIDAYS_COLUMN_WIDTHS, notes: true, freeze: true };
  if (name === ALL_SHIFTS_TAB) return { header: null, widths: null, notes: false, freeze: false };
  if (name === STATUS_TAB) return { header: null, widths: STATUS_COLUMN_WIDTHS, notes: false, freeze: false };
  if (isSystemTab(name) && !isKnownSystemTab(name)) return null;
  if (!isSystemTab(name) && !isEmptySheet(sheet) && !isLedgerHeader(sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0])) return null;
  return { header: LEDGER_HEADER, widths: LEDGER_COLUMN_WIDTHS, notes: true, freeze: true };
}

// Replaces the tab's conditional format rules with the script's set, one rule per formula over A:G.
function setConditionalRules(sheet, rules, width) {
  var range = sheet.getRange('A:' + String.fromCharCode(64 + width));
  sheet.setConditionalFormatRules(rules.map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(r.formula).setBackground(r.color).setRanges([range]).build();
  }));
}

// Idempotent formatting: fonts, plain text on the whole ledger columns (A:G), bold grey frozen header,
// widths, notes and spare columns removed on tabs that have their header, conditional row colours on
// rotation tabs and #Global, tab colour on system tabs. Never touches cell values.
function formatTab(sheet) {
  var name = sheet.getName();
  var layout = tabLayout(sheet);
  if (!layout) return;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily(FONT_FAMILY);
  var width = layout.header ? layout.header.length : STATUS_WIDTH;
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  if (!layout.header && layout.widths) layout.widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  if (layout.header && !isEmptySheet(sheet)) {
    var header = sheet.getRange(1, 1, 1, width);
    header.setFontWeight('bold').setBackground(COLOR_HEADER);
    if (layout.freeze) sheet.setFrozenRows(1);
    layout.header.forEach(function (column, i) {
      sheet.setColumnWidth(i + 1, layout.widths[column]);
      if (layout.notes && COLUMN_NOTES[column]) header.getCell(1, i + 1).setNote(COLUMN_NOTES[column]);
    });
    if (sheet.getMaxColumns() > width && sheet.getLastColumn() <= width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
  }
  if (!isSystemTab(name)) setConditionalRules(sheet, LEDGER_FORMAT_RULES, LEDGER_HEADER.length);
  if (name === GLOBAL_TAB) setConditionalRules(sheet, GLOBAL_FORMAT_RULES, LEDGER_HEADER.length);
  if (isSystemTab(name)) {
    var editable = name === HOLIDAYS_TAB || name === GLOBAL_TAB;
    sheet.setTabColor(editable ? TAB_COLOR_EDITABLE : TAB_COLOR_GENERATED);
  }
}

function ensureTab(ss, name, header) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (header) writeHeaderRow(sheet, header);
  } else if (header && isEmptySheet(sheet)) {
    writeHeaderRow(sheet, header);
  }
  return sheet;
}

// #Global gets its header and one comment row explaining the tab when created or still empty.
function ensureGlobalTab(ss) {
  var sheet = ss.getSheetByName(GLOBAL_TAB) || ss.insertSheet(GLOBAL_TAB);
  if (!isEmptySheet(sheet)) return sheet;
  var rows = globalTemplateRows();
  var range = sheet.getRange(1, 1, rows.length, LEDGER_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(rows);
  return sheet;
}

// Rotation template into an empty tab: header, set row dated the most recent Monday 00:00, sample team.
function writeRotationTemplate(sheet, storage) {
  var rows = templateRows(recentMonday(parseDateTime(storage.nowText)));
  var range = sheet.getRange(1, 1, rows.length, LEDGER_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

// Menu: Set Up Spreadsheet. Creates missing system tabs, a first rotation when there is none, and formats
// every tab.
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss);
  if (!Object.keys(storage.readLedgers()).length) {
    var first = ss.getSheetByName(DEFAULT_ROTATION_TAB) || ss.insertSheet(DEFAULT_ROTATION_TAB, 0);
    if (isEmptySheet(first)) writeRotationTemplate(first, storage);
  }
  ensureTab(ss, HOLIDAYS_TAB, HOLIDAYS_HEADER);
  ensureGlobalTab(ss);
  ensureTab(ss, STATUS_TAB, null);
  ensureTab(ss, ALL_SHIFTS_TAB, SHIFTS_HEADER);
  ss.getSheets().forEach(formatTab);
  toast('Tabs and formatting are in place');
}

// Menu: Set Up Tab. Fills the active tab according to its name; never overwrites content.
function setupTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) && !isKnownSystemTab(name)) { toast('"' + name + '" starts with # and is not a system tab; rename it to use it as a rotation'); return; }
  if (name === STATUS_TAB || name === ALL_SHIFTS_TAB || name.indexOf(PREVIEW_TAB_PREFIX) === 0) { toast('"' + name + '" is written by the script; nothing to fill in'); return; }
  if (!isEmptySheet(sheet)) { toast('"' + name + '" is not empty; Set Up Tab only fills empty tabs'); return; }
  var layout = tabLayout(sheet);
  if (isSystemTab(name)) writeHeaderRow(sheet, layout.header);
  else writeRotationTemplate(sheet, new SheetsStorage(ss));
  formatTab(sheet);
  toast('"' + name + '" set up from the template');
}

// Menu: Fill Shifts Grid over the selected rows of a rotation tab (DESIGN 10).
function fillShiftsGrid() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  var header = sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0];
  if (isSystemTab(name) || !isLedgerHeader(header)) { toast('"' + name + '" is not a rotation tab'); return; }
  var selection = sheet.getActiveRange();
  var top = selection.getRow();
  var count = selection.getNumRows();
  if (count < 2 || top < 2) { toast('select more than one row below the header'); return; }
  var storage = new SheetsStorage(ss);
  var region = sheet.getRange(top, 1, count, LEDGER_HEADER.length);
  var selected = region.getValues().map(function (row) {
    return row.map(function (cell) { return storage.formatCell(cell, CELL_DATETIME_FORMAT); });
  });
  var tab = storage.readValues(sheet, CELL_DATETIME_FORMAT).slice(1);
  var result = fillShiftsGridCells(selected, tab, storage.readHolidays(), storage.readGlobal());
  if (result.error) { toast(result.error); return; }
  var rows = result.rows;
  if (rows.length > count) sheet.insertRowsAfter(top + count - 1, rows.length - count);
  var target = sheet.getRange(top, 1, rows.length, LEDGER_HEADER.length);
  target.setNumberFormat('@');
  target.setValues(rows);
  sheet.setActiveRange(target);
  toast(rows.length + ' row(s) on the grid, ' + (rows.length - count) + ' inserted');
}

