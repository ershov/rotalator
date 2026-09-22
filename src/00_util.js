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
