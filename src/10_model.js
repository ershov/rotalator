var LEDGER_HEADER = ['pin', 'start', 'type', 'who', 'arg', 'end', 'duration', 'note'];

// order: same-instant sort (DESIGN 3.6). who/arg: 'required', 'optional' or 'none'. extent: end/duration allowed.
var ROW_TYPES = {
  error:    { order: 0, who: 'none',     arg: 'required', extent: false },
  set:      { order: 1, who: 'none',     arg: 'required', extent: false },
  snapshot: { order: 2, who: 'none',     arg: 'optional', extent: false },
  team:     { order: 3, who: 'none',     arg: 'required', extent: false },
  join:     { order: 4, who: 'required', arg: 'optional', extent: false },
  leave:    { order: 5, who: 'required', arg: 'none',     extent: false },
  score:    { order: 6, who: 'none',     arg: 'required', extent: false },
  exclude:  { order: 7, who: 'required', arg: 'none',     extent: true },
  include:  { order: 8, who: 'required', arg: 'none',     extent: false },
  shift:    { order: 9, who: 'optional', arg: 'none',     extent: true },
};

var BASELINE_KEYWORDS = ['median', 'mean', 'min', 'max'];
var TIEBREAKS = ['order', 'shuffle'];

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

// join arg and team '=' values: baseline keyword or number.
function parseBaseline(text) {
  var kw = parseBaselineKeyword(text);
  return kw !== null ? kw : parseNumber(text);
}

function parsePrecredit(text) {
  return text.toLowerCase() === 'auto' ? 'auto' : parseNonNegativeInteger(text);
}

var SETTINGS = {
  period:        { parse: parsePeriod,             def: null },
  anchor:        { parse: parseDateTime,           def: null },
  horizon:       { parse: parsePositiveDuration,   def: 90 * MINUTES_PER_DAY },
  skip_weekends: { parse: parseBoolean,            def: false },
  skip_holidays: { parse: parseBoolean,            def: false },
  tolerance:     { parse: parseNonNegativeNumber,  def: 0 },
  min_distance:  { parse: parseNonNegativeInteger, def: 0 },
  tiebreak:      { parse: parseKeyword(TIEBREAKS), def: 'order' },
  seed:          { parse: parseInteger,            def: 0 },
  baseline:      { parse: parseBaselineKeyword,    def: 'median' },
  precredit:     { parse: parsePrecredit,          def: 'auto' },
};

function defaultSettings() {
  var out = {};
  for (var key in SETTINGS) out[key] = SETTINGS[key].def;
  return out;
}

// Returns { values: { key: parsed }, error: string | null }.
function parseSetArg(text) {
  var items = parseAssignments(text);
  if (typeof items === 'string') return { values: {}, error: items };
  var values = {};
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.op !== '=') return { values: values, error: 'set expects key=value, got "' + it.name + '"' };
    var key = it.name.toLowerCase();
    var spec = SETTINGS[key];
    if (!spec) return { values: values, error: 'unknown setting "' + it.name + '"' };
    if (key in values) return { values: values, error: 'duplicate setting "' + it.name + '"' };
    var parsed = spec.parse(it.value);
    if (parsed === null) return { values: values, error: 'bad value for ' + it.name + ': "' + it.value + '"' };
    values[key] = parsed;
  }
  return { values: values, error: null };
}

function isNobody(who) {
  var w = (who ?? '').trim().toLowerCase();
  return w === '' || w === '-' || w === 'none';
}

function isValidMemberId(who) {
  return who !== '' && !/[,;=+]/.test(who);
}

// false is empty so an unchecked checkbox in pin does not pin the row.
function cellText(cell) {
  return cell === null || cell === undefined || cell === false ? '' : String(cell).trim();
}

// duration is resolved into end here so downstream code only reads end.
function rowFromArray(cells, rowIndex) {
  var pin = cellText(cells[0]);
  var startText = cellText(cells[1]);
  var endText = cellText(cells[5]);
  var durationText = cellText(cells[6]);
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
    who: cellText(cells[3]),
    arg: cellText(cells[4]),
    end: end,
    endText: endText,
    duration: duration,
    durationText: durationText,
    note: cellText(cells[7]),
  };
}

function makeRow(fields) {
  var row = {
    rowIndex: null, pin: '', pinned: false, start: null, startText: '', type: '', who: '', arg: '',
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
    row.who,
    row.arg,
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

function validateArg(row) {
  var items;
  switch (row.type) {
    case 'join':
      return parseBaseline(row.arg) === null ? 'join arg must be median, mean, min, max or a number' : null;
    case 'team':
      items = parseAssignments(row.arg);
      if (typeof items === 'string') return items;
      for (var i = 0; i < items.length; i++) {
        var t = items[i];
        if (!isValidMemberId(t.name)) return 'bad member id "' + t.name + '"';
        if (t.op === '=' && parseBaseline(t.value) === null) return 'bad value for ' + t.name + ': "' + t.value + '"';
        if ((t.op === '+=' || t.op === '-=') && parseNumber(t.value) === null) return 'bad adjustment for ' + t.name + ': "' + t.value + '"';
      }
      return null;
    case 'score':
    case 'snapshot':
      items = parseAssignments(row.arg);
      if (typeof items === 'string') return items;
      for (var j = 0; j < items.length; j++) {
        var s = items[j];
        if (!isValidMemberId(s.name)) return 'bad member id "' + s.name + '"';
        if (s.op === null || (row.type === 'snapshot' && s.op !== '=')) return row.type + ' expects name=number, got "' + s.name + '"';
        if (parseNumber(s.value) === null) return 'bad number for ' + s.name + ': "' + s.value + '"';
      }
      return null;
    case 'set':
      return parseSetArg(row.arg).error;
    default:
      return null;
  }
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
  var nobody = isNobody(row.who);
  if (spec.who === 'none' && row.who !== '') return row.type + ' does not take who';
  if (spec.who === 'required' && nobody) return row.type + ' requires who';
  if (!nobody && !isValidMemberId(row.who)) return 'who must be exactly one member id';
  if (spec.arg === 'none' && row.arg !== '') return row.type + ' does not take arg';
  if (spec.arg === 'required' && row.arg === '') return row.type + ' requires arg';
  return row.arg !== '' ? validateArg(row) : null;
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
  } else if (first.start !== null && !(first.type === 'set' && parseSetArg(first.arg).values.period)) {
    errors.push(rowError(first, rotationName + ': first row must be a set row with period'));
  }
  return { rows: sorted, errors: errors };
}
