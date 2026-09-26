// GCal extension: event titles and bodies from templates. Placeholders {who} {rotation} {note} {pin} {start}
// {end}; {start} and {end} take an optional strftime format, {start:%a %d %b}. Unknown placeholders and
// directives stay verbatim and are reported.
var GCAL_PLACEHOLDERS = ['who', 'rotation', 'note', 'pin', 'start', 'end'];
var GCAL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var GCAL_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var GCAL_PLACEHOLDER_RE = /\{([A-Za-z]+)(?::([^{}]*))?\}/g;

// strftime subset over a naive instant: %Y %m %d %e (day without padding) %H %M %a %A %b %B %j %u (Monday 1),
// %% a percent sign. Returns { text, unknown: ['%q', ...] }; a trailing % is an unknown directive too.
function gcalStrftime(format, min) {
  var d = new Date(min * 60000);
  var day = dayIndex(min);
  var weekday = weekdayOfDay(day);
  var unknown = [];
  var text = format.replace(/%(.?)/g, function (directive, c) {
    switch (c) {
      case 'Y': return String(d.getUTCFullYear()).padStart(4, '0');
      case 'm': return pad2(d.getUTCMonth() + 1);
      case 'd': return pad2(d.getUTCDate());
      case 'e': return String(d.getUTCDate());
      case 'H': return pad2(d.getUTCHours());
      case 'M': return pad2(d.getUTCMinutes());
      case 'a': return GCAL_DAY_NAMES[weekday].slice(0, 3);
      case 'A': return GCAL_DAY_NAMES[weekday];
      case 'b': return GCAL_MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
      case 'B': return GCAL_MONTH_NAMES[d.getUTCMonth()];
      case 'j': return String(day - dayIndex(Date.UTC(d.getUTCFullYear(), 0, 1) / 60000) + 1).padStart(3, '0');
      case 'u': return String(weekday === 0 ? 7 : weekday);
      case '%': return '%';
      default: unknown.push(directive); return directive;
    }
  });
  return { text: text, unknown: unknown };
}

// values: { who, rotation, note, pin, start, end } with start and end as minutes. Placeholder names are
// case-insensitive. Returns { text, unknown }.
function gcalFormat(template, values) {
  var unknown = [];
  var text = template.replace(GCAL_PLACEHOLDER_RE, function (whole, rawName, format) {
    var name = rawName.toLowerCase();
    if (GCAL_PLACEHOLDERS.indexOf(name) < 0) { unknown.push('{' + rawName + '}'); return whole; }
    var value = values[name];
    if (name !== 'start' && name !== 'end') return value === null || value === undefined ? '' : String(value);
    if (format === undefined) return formatDateTime(value);
    var out = gcalStrftime(format, value);
    unknown.push.apply(unknown, out.unknown);
    return out.text;
  });
  return { text: text, unknown: unknown };
}

// Messages for the unknown placeholders and directives of a template, each once.
function gcalTemplateErrors(template, field) {
  var sample = { who: '', rotation: '', note: '', pin: '', start: 0, end: 0 };
  var seen = {};
  var out = [];
  gcalFormat(template, sample).unknown.forEach(function (u) {
    if (seen[u]) return;
    seen[u] = true;
    out.push('unknown ' + (u.charAt(0) === '{' ? 'placeholder ' : 'directive ') + u + ' in ' + field);
  });
  return out;
}
