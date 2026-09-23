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

function formatDateTime(min) {
  var d = new Date(min * 60000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

function formatDay(day) {
  return formatDateTime(day * MINUTES_PER_DAY).slice(0, 10);
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
var LINKS_TAB = '#Links';
var STATUS_TAB = '#Status';
var ALL_SHIFTS_TAB = '#All shifts';
var PREVIEW_TAB_PREFIX = '#Preview ';

function isSystemTab(name) {
  return name.charAt(0) === SYSTEM_TAB_PREFIX;
}

// Preview of a rotation tab, or '#Preview Links' for the Links tab.
function previewTabName(name) {
  return PREVIEW_TAB_PREFIX + (isSystemTab(name) ? name.slice(1) : name);
}

function isKnownSystemTab(name) {
  return name === HOLIDAYS_TAB || name === LINKS_TAB || name === STATUS_TAB || name === ALL_SHIFTS_TAB ||
    name.indexOf(PREVIEW_TAB_PREFIX) === 0;
}

// order: same-instant sort (DESIGN 3.6). what: item grammar of the column (see validateWhat).
// required: what must not be empty. extent: end/duration allowed.
var ROW_TYPES = {
  error:    { order: 0, what: 'text',   required: true,  extent: false },
  set:      { order: 1, what: 'set',    required: true,  extent: false },
  snapshot: { order: 2, what: 'scores', required: false, extent: false },
  team:     { order: 3, what: 'team',   required: true,  extent: false },
  join:     { order: 4, what: 'join',   required: true,  extent: false },
  leave:    { order: 5, what: 'names',  required: true,  extent: false },
  score:    { order: 6, what: 'team',   required: true,  extent: false },
  exclude:  { order: 7, what: 'names',  required: true,  extent: true },
  include:  { order: 8, what: 'names',  required: true,  extent: false },
  shift:    { order: 9, what: 'shift',  required: false, extent: true },
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

// Returns { values: { key: parsed }, error: string | null }. start is the row's start, used by bare anchor.
function parseSetArg(text, start) {
  var items = parseAssignments(text);
  if (typeof items === 'string') return { values: {}, error: items };
  var values = {};
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var key = it.name.toLowerCase();
    var spec = SETTINGS[key];
    if (!spec) return { values: values, error: 'unknown setting "' + it.name + '"' };
    if (key in values) return { values: values, error: 'duplicate setting "' + it.name + '"' };
    if (it.op !== null && it.op !== '=') return { values: values, error: 'set expects key or key=value, got "' + it.name + it.op + '"' };
    var parsed;
    if (it.op === null) {
      if (spec.bare === 'none') return { values: values, error: it.name + ' requires a value' };
      parsed = spec.bare === 'start' ? start : spec.def;
    } else {
      if (!spec.parse) return { values: values, error: it.name + ' takes no value; the row start is the ' + it.name };
      parsed = spec.parse(it.value);
      if (parsed === null) return { values: values, error: 'bad value for ' + it.name + ': "' + it.value + '"' };
    }
    values[key] = parsed;
  }
  return { values: values, error: null };
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
    type: cellText(cells[2]).toLowerCase(),
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
    row.type,
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
  return ROW_TYPES[type] ? ROW_TYPES[type].order : ROW_TYPES.shift.order + 1;
}

// Stable sort by start (nulls last), then DESIGN 3.6 type order.
function sortRows(rows) {
  return rows.slice().sort(function (a, b) {
    if (a.start !== b.start) {
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start - b.start;
    }
    return typeOrder(a.type) - typeOrder(b.type);
  });
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

// Stateless checks of DESIGN 5.1. Drops error rows; returns remaining rows sorted.
function validateLedger(rows, rotationName) {
  var errors = [];
  var kept = [];
  var snapshots = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.type === 'error') continue;
    kept.push(row);
    var message = validateRow(row);
    if (message === null && row.type === 'snapshot' && ++snapshots > 1) message = 'more than one snapshot row';
    if (message !== null) errors.push(rowError(row, message));
  }
  var sorted = sortRows(kept);
  var first = sorted[0];
  if (!first) {
    errors.push({ rowIndex: null, start: null, startText: '', message: rotationName + ': ledger is empty' });
  } else if (first.start !== null && !(first.type === 'set' && parseSetArg(first.what, first.start).values.period)) {
    errors.push(rowError(first, rotationName + ': first row must be a set row with period'));
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

  // Returns true when the row changes the grid: period, anchor or grid mode, or a skip flag while counted.
  apply(setRow) {
    var values = parseSetArg(setRow.what, setRow.start).values;
    var before = this.values;
    var changes = function (key) { return key in values && values[key] !== before[key]; };
    var changed = changes('period') || changes('anchor') || changes('grid');
    if (changes('period') && !('anchor' in values)) this.values.anchor = setRow.start;
    this.values = Object.assign({}, before, values);
    if (this.values.grid === 'counted' && (changes('skip_weekends') || changes('skip_holidays'))) changed = true;
    return changed;
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

// Settings after each set row, in start order. holidays: Set of day indexes for counted grids.
class SettingsTimeline {
  constructor(setRows, holidays) {
    this.holidays = holidays || new Set();
    this.entries = [];
    var settings = new Settings();
    var rows = sortRows(setRows);
    for (var i = 0; i < rows.length; i++) {
      var gridChanged = settings.apply(rows[i]);
      this.entries.push({ start: rows[i].start, settings: settings.clone(), gridChanged: gridChanged });
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

function formatScore(score) {
  var text = score.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
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
  return sortRows(rows.filter(function (r) { return r.type !== 'error' && r.start !== null; }));
}

function rowsOfType(rows, type) {
  return rows.filter(function (r) { return r.type === type; });
}

function firstOfType(rows, types) {
  for (var i = 0; i < rows.length; i++) if (types.indexOf(rows[i].type) >= 0) return rows[i];
  return null;
}

// An instant inside a skipped day of a counted grid moves to the next boundary, so S never lands there.
function onCountedDay(timeline, t) {
  var grid = t === null || t === undefined ? null : timeline.gridAt(t);
  return grid ? grid.onCounted(t) : t;
}

// DESIGN 5.2. now may be null to skip the clock-dependent steps. holidays: Set of day indexes.
function advance(rows, now, holidays) {
  rows = ledgerRows(rows);
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays);
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

function prepareRotation(input, index, holidays) {
  var validated = validateLedger(input.rows, input.name);
  var rot = { name: input.name, index: index, rows: validated.rows, errors: validated.errors.slice(), problems: [], warnings: [] };
  if (rot.errors.length) return rot;
  var rows = rot.rows;
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays);
  var previous = firstOfType(rows, ['snapshot']);
  var S = input.snapshotAt === null || input.snapshotAt === undefined ? advance(rows, null, holidays) : input.snapshotAt;
  S = raiseTo(raiseTo(S, previous ? previous.start : null), onCountedDay(timeline, rows[0].start));
  rot.timeline = timeline;
  rot.previousAt = previous ? previous.start : null;
  rot.previousWhat = previous ? previous.what : '';
  rot.S = S;
  rot.kept = rows.filter(function (r) { return r.type !== 'snapshot' && !(r.type === 'shift' && !r.pinned && r.start > S); });

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
  uncoveredSpans(regenStart, rot.horizonEnd, claims).forEach(function (span) {
    splitSlots(span[0], span[1], timeline, changes, entries);
  });
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
  rot.settings = new Settings();
  rot.roster = new Roster();
  rot.roster.fromSnapshotWhat(rot.previousWhat);
  rot.precredited = new Set();
  rot.kept.forEach(function (row) {
    if (row.type === 'shift') return;
    if (row.type === 'set') {
      if (afterPrevious(row.start)) push(row.start, 'row', { row: row });
      else rot.settings.apply(row);
    } else if (row.type === 'exclude') {
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

function applyStateRow(rot, item) {
  var row = item.row;
  var roster = rot.roster;
  switch (row.type) {
    case 'set': rot.settings.apply(row); return null;
    case 'team': return roster.team(whatItems(row), rot.settings.get('baseline'));
    case 'join': return roster.join(whatItems(row), rot.settings.get('baseline'));
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
  var n = rot.settings.precreditPeriods(rot.roster.size());
  var limit = rot.timeline.gridAt(rot.S).step(rot.S, n);
  var options = rot.settings.unitsOptions(holidays);
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

// DESIGN 5.7 steps 3 and 4. joined links prefer holders of an overlapping shift in a linked rotation.
function tiebreak(rot, entry, candidates) {
  var names = rot.roster.names();
  var chosen = new Set(candidates.map(function (m) { return m.name; }));
  if (rot.settings.get('tiebreak') === 'shuffle') {
    var prefix = rot.settings.get('seed') + '|' + rot.name + '|' + formatDateTime(entry.start) + '|';
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

// DESIGN 5.7 and 7. distinct holders are removed before relaxation; joined holders are preferred inside the band.
function assignSlot(rot, entry, holidays, ctx) {
  var settings = rot.settings;
  var roster = rot.roster;
  var a = entry.start, b = entry.slotEnd;
  var minDistance = settings.get('min_distance');
  var distinct = linkedHolders(ctx, rot, 'distinct', a, b);
  var members = roster.members.filter(function (m) { return !distinct.has(m.name); });
  var grid = rot.timeline.gridAt(a);
  var eligible = [];
  var used = 0;
  for (var d = minDistance; d >= 0 && !eligible.length; d--) {
    var from = grid.step(a, -d), to = grid.step(b, d);
    used = d;
    eligible = members.filter(function (m) {
      return !roster.isExcluded(m.name, a, b) && !hasShiftOverlapping(rot, m.name, from, to);
    });
  }
  var note = '';
  if (eligible.length) {
    var lowest = Math.min.apply(null, eligible.map(function (m) { return m.score; }));
    var tolerance = settings.get('tolerance');
    var candidates = eligible.filter(function (m) { return m.score <= lowest + tolerance; });
    var joined = linkedHolders(ctx, rot, 'joined', a, b);
    var preferred = candidates.filter(function (m) { return joined.has(m.name); });
    entry.who = tiebreak(rot, entry, preferred.length ? preferred : candidates);
    roster.credit(entry.who, units(a, entry.end, settings.unitsOptions(holidays)));
    if (used < minDistance) {
      note = 'min_distance relaxed to ' + used;
      rot.warnings.push({ start: a, message: note });
    }
  } else {
    var message = 'no eligible member for shift ' + formatDateTime(a) + ' to ' + formatDateTime(b);
    rot.problems.push({ start: a, message: message });
  }
  entry.generated = makeRow({ type: 'shift', start: a, what: entry.who === null ? '' : entry.who, note: note });
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
          rot.roster.credit(item.entry.who, units(item.a, item.b, rot.settings.unitsOptions(holidays)));
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

// DESIGN 6: rows unchanged plus an error row above each offending row.
function errorOutput(rots, links) {
  var errors = collectErrors(rots, 'errors').concat(links.errors);
  return {
    rotations: rots.map(function (rot) {
      return { name: rot.name, rows: sortRows(rot.rows.concat(rot.errors.map(errorRow))) };
    }),
    links: { rows: links.rows, errors: links.errors },
    errors: errors,
    status: buildStatus([], [], errors),
  };
}

// Links rows and errors in the regenerate output shape; link errors never block regeneration.
function prepareLinks(rows, rots) {
  var names = rots.map(function (r) { return r.name; });
  var parsed = parseLinks(rows || [], names);
  var order = linkedRotationOrder(parsed.links, names);
  rots.forEach(function (rot) { rot.rank = order.indexOf(rot.name); });
  var errors = parsed.errors.map(function (e) {
    return { rotation: LINKS_TAB, rowIndex: e.rowIndex, start: e.start, message: e.message };
  });
  var byName = {};
  rots.forEach(function (rot) { byName[rot.name] = rot; });
  return { rows: parsed.rows, errors: errors, links: parsed.links, byName: byName };
}

function rotationOutput(rot) {
  var rows = rot.kept.concat([makeRow({ type: 'snapshot', start: rot.S, what: rot.snapshotWhat })]);
  rot.entries.forEach(function (e) { if (e.generated) rows.push(e.generated); });
  return { name: rot.name, rows: sortRows(rows.concat(rot.problems.map(errorRow))) };
}

// Pure regeneration of DESIGN 5.3 to 5.8 and 7.
// input: { rotations: [{ name, rows, snapshotAt }], holidays: [dayIndex], links: Links row objects, now }.
// now is optional and only dates the effective settings in the status; the ledgers never depend on it.
// Output: { rotations: [{ name, rows }], links: { rows, errors }, errors, status }.
function regenerate(input) {
  var holidays = new Set(input.holidays || []);
  var rots = input.rotations.map(function (r, i) { return prepareRotation(r, i, holidays); });
  var links = prepareLinks(input.links, rots);
  var hasErrors = function () { return rots.some(function (rot) { return rot.errors.length > 0; }); };
  if (hasErrors()) return errorOutput(rots, links);
  sweep(mergeItems(rots), rots, holidays, links);
  if (hasErrors()) return errorOutput(rots, links);
  var warnings = collectErrors(rots, 'warnings').concat(collectErrors(rots, 'problems'));
  return {
    rotations: rots.map(rotationOutput),
    links: { rows: links.rows, errors: links.errors },
    errors: collectErrors(rots, 'problems').concat(links.errors),
    status: buildStatus(rots, warnings, links.errors, input.now),
  };
}

// ---- 50_status.js ----
// Status data and the 2D text arrays for the #Status and #All shifts tabs (DESIGN 5.8).

var STATUS_WIDTH = 6;
var SHIFTS_HEADER = ['start', 'end', 'rotation', 'what', 'pinned', 'note'];

function statusInstant(min) {
  return min === null || min === undefined ? '' : formatDateTime(min);
}

function formatSettingValue(key, value) {
  if (value === null || value === undefined) return '';
  if (key === 'anchor') return formatDateTime(value);
  if (key === 'period' || key === 'horizon') return formatDuration(value);
  return String(value);
}

// Every SETTINGS key with its effective value at `at`, plus the start of the next set row after `at`.
function effectiveSettings(timeline, at) {
  var values = timeline.at(at).values;
  var next = null;
  timeline.entries.forEach(function (e) { if (e.start > at && next === null) next = e.start; });
  return {
    at: at,
    values: Object.keys(SETTINGS).map(function (key) { return { key: key, value: formatSettingValue(key, values[key]) }; }),
    nextSetAt: next,
  };
}

// rot: swept rotation internals from 40_scheduler.js (roster, scoresAtS, entries, S, horizonEnd, timeline).
// now: run instant for the settings block; S when absent.
function rotationStatus(rot, now) {
  var projected = rot.roster.scores();
  var S = rot.S;
  return {
    name: rot.name,
    snapshotAt: S,
    horizonEnd: rot.horizonEnd,
    settings: effectiveSettings(rot.timeline, now === null || now === undefined ? S : now),
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

// Every shift of every rotation, by start then rotation order.
function shiftsView(rots) {
  var out = [];
  rots.forEach(function (rot) {
    rot.entries.forEach(function (e) {
      var row = e.row || e.generated;
      out.push({
        start: e.start, end: e.end, rotation: rot.name,
        what: e.who === null ? '' : e.who,
        pinned: Boolean(row && row.pinned),
        note: row ? row.note : '',
      });
    });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

// rots: swept rotations, or [] when a validation error stopped the run. now: optional run instant.
function buildStatus(rots, warnings, errors, now) {
  return {
    rotations: rots.map(function (rot) { return rotationStatus(rot, now); }),
    warnings: warnings,
    errors: errors,
    shifts: shiftsView(rots),
  };
}

function padStatusRow(cells) {
  return cells.concat(new Array(Math.max(0, STATUS_WIDTH - cells.length)).fill(''));
}

function formatExclusions(list) {
  return list.map(function (ex) {
    return statusInstant(ex.from) + ' to ' + (ex.to === null ? 'open' : statusInstant(ex.to));
  }).join('; ');
}

// Rows of the #Status tab. status.now, status.mode and status.tabs are set by the runner.
function statusRows(status) {
  var rows = [];
  var push = function (cells) { rows.push(padStatusRow(cells)); };
  push(['Rotalator', status.mode || '', status.now || '']);
  if (status.tabs) {
    push([]);
    push(['tabs']);
    push(['rotations', status.tabs.rotations.join(', ')]);
    push(['holidays', String(status.tabs.holidays)]);
    push(['links', String(status.tabs.links)]);
    push(['ignored', status.tabs.ignored.join(', ')]);
  }
  status.rotations.forEach(function (rot) {
    push([]);
    push(['rotation', rot.name]);
    push(['snapshot', statusInstant(rot.snapshotAt)]);
    push(['horizon', statusInstant(rot.horizonEnd)]);
    push([]);
    push(['member', 'score', 'projected', 'last shift', 'next shift', 'exclusions']);
    rot.roster.forEach(function (m) {
      push([m.name, m.score === null ? '' : formatScore(m.score), formatScore(m.projected),
        statusInstant(m.lastShift), statusInstant(m.nextShift), formatExclusions(m.exclusions)]);
    });
    push([]);
    push(['settings', 'as of ' + statusInstant(rot.settings.at)]);
    rot.settings.values.forEach(function (s) { push([s.key, s.value]); });
    if (rot.settings.nextSetAt !== null) push(['note', 'a set row at ' + statusInstant(rot.settings.nextSetAt) + ' changes these values']);
  });
  if (status.warnings.length) {
    push([]);
    push(['warnings']);
    push(['rotation', 'start', 'message']);
    status.warnings.forEach(function (w) { push([w.rotation, statusInstant(w.start), w.message]); });
  }
  if (status.errors.length) {
    push([]);
    push(['errors']);
    push(['rotation', 'where', 'message']);
    status.errors.forEach(function (e) {
      var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex : statusInstant(e.start);
      push([e.rotation, where, e.message]);
    });
  }
  return rows;
}

// Rows of the #All shifts tab, header included.
function shiftsRows(shifts) {
  return [SHIFTS_HEADER.slice()].concat(shifts.map(function (s) {
    return [statusInstant(s.start), statusInstant(s.end), s.rotation, s.what, s.pinned ? 'yes' : '', s.note];
  }));
}

// ---- 60_links.js ----
// #Links tab (DESIGN 7): link and unlink rows relating rotations over time.

var LINK_KINDS = ['distinct', 'joined'];

// "distinct: a, b" -> { kind, rotations } or null.
function parseLinkArg(text) {
  var m = /^\s*([A-Za-z]+)\s*:(.*)$/.exec(text);
  if (!m) return null;
  var kind = m[1].toLowerCase();
  if (LINK_KINDS.indexOf(kind) < 0) return null;
  var rotations = splitList(m[2]);
  if (rotations.length < 2 || new Set(rotations).size !== rotations.length) return null;
  return { kind: kind, rotations: rotations };
}

function sameRotations(a, b) {
  return a.length === b.length && a.every(function (r) { return b.indexOf(r) >= 0; });
}

function validateLinkRow(row, rotationNames) {
  if (row.type !== 'link' && row.type !== 'unlink') return row.type === '' ? 'missing type' : 'unknown type "' + row.type + '"';
  if (row.start === null) return row.startText === '' ? 'missing start' : 'bad start "' + row.startText + '"';
  if (row.what === '') return row.type + ' requires what';
  var parsed = parseLinkArg(row.what);
  if (!parsed) return 'what must be "distinct: a, b" or "joined: a, b"';
  for (var i = 0; i < parsed.rotations.length; i++) {
    if (rotationNames.indexOf(parsed.rotations[i]) < 0) return 'unknown rotation "' + parsed.rotations[i] + '"';
  }
  if (row.type === 'unlink' && (row.endText !== '' || row.durationText !== '')) return 'unlink does not take end or duration';
  if (row.endText !== '' && row.durationText !== '') return 'end and duration are mutually exclusive';
  if (row.endText !== '' && parseDateTime(row.endText) === null) return 'bad end "' + row.endText + '"';
  if (row.durationText !== '' && (row.duration === null || row.duration <= 0)) return 'bad duration "' + row.durationText + '"';
  if (row.end !== null && row.end <= row.start) return 'end must be after start';
  return null;
}

// rows: #Links row objects. Returns { links: [{ kind, rotations, from, to }], errors, rows } where rows are the
// kept rows plus an error row above each rejected one. Rejected rows are ignored; unlink closes matching open links.
function parseLinks(rows, rotationNames) {
  var errors = [];
  var links = [];
  var kept = sortRows(rows.filter(function (r) { return r.type !== 'error'; }));
  kept.forEach(function (row) {
    var message = validateLinkRow(row, rotationNames);
    if (message === null) {
      var parsed = parseLinkArg(row.what);
      if (row.type === 'link') {
        links.push({ kind: parsed.kind, rotations: parsed.rotations, from: row.start, to: row.end });
      } else {
        var open = links.filter(function (l) {
          return l.kind === parsed.kind && sameRotations(l.rotations, parsed.rotations) && l.from <= row.start && (l.to === null || l.to > row.start);
        });
        if (!open.length) message = 'unlink: no active ' + parsed.kind + ' link for ' + parsed.rotations.join(', ');
        open.forEach(function (l) { l.to = row.start; });
      }
    }
    if (message !== null) errors.push(rowError(row, message));
  });
  return { links: links, errors: errors, rows: sortRows(kept.concat(errors.map(errorRow))) };
}

// Sweep order at equal starts: rotations in link list order first, then the rest in tab order.
function linkedRotationOrder(links, rotationNames) {
  var ordered = [];
  var add = function (name) { if (ordered.indexOf(name) < 0) ordered.push(name); };
  links.forEach(function (l) { l.rotations.forEach(add); });
  rotationNames.forEach(add);
  return ordered;
}

function activeLinks(links, kind, rotation, t) {
  return links.filter(function (l) {
    return l.kind === kind && l.rotations.indexOf(rotation) >= 0 && l.from <= t && (l.to === null || l.to > t);
  });
}

// Members holding a decided shift overlapping [a, b) in rotations linked to rot by `kind` at instant a.
function linkedHolders(ctx, rot, kind, a, b) {
  var names = new Set();
  activeLinks(ctx.links, kind, rot.name, a).forEach(function (link) {
    link.rotations.forEach(function (other) {
      var target = ctx.byName[other];
      if (!target || target === rot) return;
      target.entries.forEach(function (e) {
        if (e.who !== null && e.start < b && e.end > a) names.add(e.who);
      });
    });
  });
  return names;
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

// Most recent Monday 09:00 at or before t.
function recentMonday(t) {
  var day = dayIndex(t);
  var monday = dayStart(day - (weekdayOfDay(day) + 6) % 7) + 9 * MINUTES_PER_HOUR;
  return monday <= t ? monday : monday - MINUTES_PER_WEEK;
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
  if (!sorted.length) return sorted;
  var changes = timeline.gridChanges();
  var shifts = rowsOfType(sorted, 'shift');
  var claims = shifts.map(function (s, i) {
    return [s.start, claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes)];
  });
  var first = sorted[0].start;
  var lastStart = sorted[sorted.length - 1].start;
  var claimsEnd = claims.length ? claims[claims.length - 1][1] : first;
  var regionEnd = Math.max(claimsEnd, lastStart);

  var out = sorted.slice();
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
  return sortRows(out);
}

// An undated selection row may only be blank or carry type=shift and nothing else.
function isTemplateShiftRow(cells) {
  return cells.every(function (c, i) { return i === 2 ? cellText(c).toLowerCase() === 'shift' : cellText(c) === ''; });
}

// Fill Shifts Grid over a selection. selectedCells: the ledger columns of the selected rows; tabCells: every
// row of the tab below the header, for the settings timeline; holidayTexts: #Holidays column A.
// Returns { rows: cell arrays } or { error: message }.
function fillShiftsGridCells(selectedCells, tabCells, holidayTexts) {
  var holidays = new Set();
  (holidayTexts || []).forEach(function (text) { var day = parseDay(text ?? ''); if (day !== null) holidays.add(day); });
  var timeline = new SettingsTimeline(rowsOfType(rowsFromCells(tabCells), 'set'), holidays);
  if (!timeline.entries.length || timeline.entries[0].settings.get('period') === null) {
    return { error: 'the tab needs a set row with period before the grid can be filled' };
  }
  var dated = [];
  var pre = 0, post = 0;
  for (var i = 0; i < selectedCells.length; i++) {
    var cells = selectedCells[i];
    var startText = cellText(cells[1]);
    if (startText === '') {
      if (!isBlankRow(cells) && !isTemplateShiftRow(cells)) return { error: 'selected row ' + (i + 1) + ' has content but no start' };
      if (dated.length) post++; else pre++;
      continue;
    }
    var row = rowFromArray(cells, i + 1);
    if (row.start === null) return { error: 'selected row ' + (i + 1) + ': bad start "' + startText + '"' };
    if (row.start < timeline.entries[0].start) return { error: 'selected row ' + (i + 1) + ' is dated before the first set row' };
    if (row.type === '') row.type = 'shift';
    row.cells = cells.slice();
    row.cells[2] = row.type;
    dated.push(row);
    post = 0;
  }
  if (!dated.length) return { error: 'the selection has no dated row to start from' };
  var out = gridRows(dated, pre, post, timeline);
  if (out[0].start < timeline.entries[0].start) return { error: pre + ' empty row(s) above would fall before the first set row' };
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
// Returns { ledgers, links, errors, status }; links is null when there is no #Links tab.
// Bad now or holiday cells stop the run with the ledgers unchanged.
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
  var linkCells = storage.readLinks();
  var ignored = storage.ignoredTabs();
  if (errors.length) return { ledgers: ledgers, links: null, errors: errors, status: null };

  var rotations = Object.keys(ledgers).map(function (name) {
    var rows = rowsFromCells(ledgers[name]);
    return { name: name, rows: rows, snapshotAt: advance(rows, now, new Set(holidays)) };
  });
  var linkRows = rowsFromCells(linkCells);
  var linkCount = linkRows.filter(function (r) { return r.type !== 'error'; }).length;
  var result = regenerate({ rotations: rotations, holidays: holidays, links: linkRows, now: now });
  var out = {};
  result.rotations.forEach(function (r) { out[r.name] = r.rows.map(rowToArray); });
  var links = linkCells.length ? result.links.rows.map(rowToArray) : null;
  result.errors.forEach(function (e) { errors.push(describeError(e)); });
  result.status.now = nowText;
  result.status.mode = options.mode || (options.write ? 'run' : 'dry run');
  result.status.tabs = { rotations: Object.keys(ledgers), holidays: holidays.length, links: linkCount, ignored: ignored };
  if (options.write) {
    Object.keys(out).forEach(function (name) { storage.writeLedger(name, out[name]); });
    if (links) storage.writeLinks(links);
    storage.writeStatus(result.status);
  }
  return { ledgers: out, links: links, errors: errors, status: result.status };
}

// ---- 90_gas.js ----
// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';
var FONT_FAMILY = 'Roboto Mono';
var TAB_COLOR_GENERATED = '#9e9e9e';
var TAB_COLOR_EDITABLE = '#4285f4';
var DEFAULT_ROTATION_TAB = 'On-Call';
var LEDGER_COLUMN_WIDTHS = { pin: 40, start: 150, type: 80, what: 320, end: 150, duration: 80, note: 320 };
var HOLIDAYS_COLUMN_WIDTHS = { date: 110, note: 320 };
var SHIFTS_COLUMN_WIDTHS = { start: 150, end: 150, rotation: 120, what: 120, pinned: 60, note: 320 };

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

  // The #Links tab must carry the ledger header; anything else is ignored.
  readLinks() {
    var sheet = this.ss.getSheetByName(LINKS_TAB);
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
    range.setValues(rows);
  }

  // Rows below the header of a ledger-shaped tab; previews go to '#Preview <name>' with a fresh header.
  writeLedgerRows(name, rows) {
    var sheet;
    if (this.preview) {
      sheet = this.previewSheet(name);
      sheet.clearContents();
      this.writeTextRows(sheet, 1, [LEDGER_HEADER]);
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

  writeLinks(rows) {
    this.writeLedgerRows(LINKS_TAB, rows);
  }

  writeTable(name, rows) {
    var sheet = this.sheetNamed(name);
    sheet.clearContents();
    this.writeTextRows(sheet, 1, rows);
  }

  // #Status and #All shifts tabs, rewritten in full from the status data (DESIGN 5.8).
  writeStatus(data) {
    this.writeTable(STATUS_TAB, statusRows(data));
    this.writeTable(ALL_SHIFTS_TAB, shiftsRows(data.shifts));
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rotalator')
    .addItem('Run now', 'run')
    .addItem('Dry run', 'dryRun')
    .addSeparator()
    .addItem('Set up', 'setup')
    .addItem('Template', 'template')
    .addItem('Fill Shifts Grid', 'fillShiftsGrid')
    .addSeparator()
    .addItem('Install nightly trigger', 'installTrigger')
    .addItem('Remove trigger', 'removeTrigger')
    .addToUi();
}

// On errors the ledgers are still written: rows unchanged plus error rows (DESIGN 6).
function runWith(preview) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss, { preview: preview });
  var result = runStorage(storage, storage.nowText, { write: true, mode: preview ? 'dry run' : 'run' });
  var title = preview ? 'Rotalator dry run' : 'Rotalator';
  var count = Object.keys(result.ledgers).length;
  var message = result.errors.length
    ? result.errors.length + ' error(s): ' + result.errors[0]
    : count + ' rotation(s) ' + (preview ? 'previewed' : 'updated') + ' at ' + storage.nowText;
  result.errors.forEach(function (e) { console.log(e); });
  ss.toast(message, title, 10);
  return result;
}

function run() {
  return runWith(false);
}

function dryRun() {
  return runWith(true);
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
  if (name === ALL_SHIFTS_TAB) return { header: SHIFTS_HEADER, widths: SHIFTS_COLUMN_WIDTHS, notes: false, freeze: true };
  if (name === STATUS_TAB) return { header: null, widths: null, notes: false, freeze: false };
  if (isSystemTab(name) && !isKnownSystemTab(name)) return null;
  if (!isSystemTab(name) && !isEmptySheet(sheet) && !isLedgerHeader(sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0])) return null;
  return { header: LEDGER_HEADER, widths: LEDGER_COLUMN_WIDTHS, notes: true, freeze: true };
}

// Idempotent formatting: fonts, plain text on the whole ledger columns (A:G), bold frozen header, widths,
// notes and spare columns removed on tabs that have their header, tab colour on system tabs. Never touches
// cell values.
function formatTab(sheet) {
  var name = sheet.getName();
  var layout = tabLayout(sheet);
  if (!layout) return;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily(FONT_FAMILY);
  var width = layout.header ? layout.header.length : STATUS_WIDTH;
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  if (layout.header && !isEmptySheet(sheet)) {
    var header = sheet.getRange(1, 1, 1, width);
    header.setFontWeight('bold');
    if (layout.freeze) sheet.setFrozenRows(1);
    layout.header.forEach(function (column, i) {
      sheet.setColumnWidth(i + 1, layout.widths[column]);
      if (layout.notes && COLUMN_NOTES[column]) header.getCell(1, i + 1).setNote(COLUMN_NOTES[column]);
    });
    if (sheet.getMaxColumns() > width && sheet.getLastColumn() <= width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
  }
  if (isSystemTab(name)) {
    var editable = name === HOLIDAYS_TAB || name === LINKS_TAB;
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

// Rotation template into an empty tab: header, set row dated the most recent Monday 09:00, sample team.
function writeRotationTemplate(sheet, storage) {
  var rows = templateRows(recentMonday(parseDateTime(storage.nowText)));
  var range = sheet.getRange(1, 1, rows.length, LEDGER_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

// Menu: Set up. Creates missing system tabs, a first rotation when there is none, and formats every tab.
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss);
  if (!Object.keys(storage.readLedgers()).length) {
    var first = ss.getSheetByName(DEFAULT_ROTATION_TAB) || ss.insertSheet(DEFAULT_ROTATION_TAB, 0);
    if (isEmptySheet(first)) writeRotationTemplate(first, storage);
  }
  ensureTab(ss, HOLIDAYS_TAB, HOLIDAYS_HEADER);
  ensureTab(ss, LINKS_TAB, LEDGER_HEADER);
  ensureTab(ss, STATUS_TAB, null);
  ensureTab(ss, ALL_SHIFTS_TAB, SHIFTS_HEADER);
  ss.getSheets().forEach(formatTab);
  toast('Tabs and formatting are in place');
}

// Menu: Template. Fills the active tab according to its name; never overwrites content.
function template() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) && !isKnownSystemTab(name)) { toast('"' + name + '" starts with # and is not a system tab; rename it to use it as a rotation'); return; }
  if (name === STATUS_TAB || name === ALL_SHIFTS_TAB || name.indexOf(PREVIEW_TAB_PREFIX) === 0) { toast('"' + name + '" is written by the script; nothing to fill in'); return; }
  if (!isEmptySheet(sheet)) { toast('"' + name + '" is not empty; the template only fills empty tabs'); return; }
  var layout = tabLayout(sheet);
  if (isSystemTab(name)) writeHeaderRow(sheet, layout.header);
  else writeRotationTemplate(sheet, new SheetsStorage(ss));
  formatTab(sheet);
  toast('"' + name + '" filled from the template');
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
  var result = fillShiftsGridCells(selected, tab, storage.readHolidays());
  if (result.error) { toast(result.error); return; }
  var rows = result.rows;
  if (rows.length > count) sheet.insertRowsAfter(top + count - 1, rows.length - count);
  var target = sheet.getRange(top, 1, rows.length, LEDGER_HEADER.length);
  target.setNumberFormat('@');
  target.setValues(rows);
  sheet.setActiveRange(target);
  toast(rows.length + ' row(s) on the grid, ' + (rows.length - count) + ' inserted');
}

