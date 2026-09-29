// GCal extension: event titles and bodies from templates, through the core's formatTemplate (DESIGN 13.2).
// Placeholders {who} {rotation} {note} {pin} {start} {end}; {start} and {end} take an optional strftime
// format, {start:%a %d %b}. Unknown placeholders and directives stay verbatim and are reported.
var GCAL_PLACEHOLDERS = ['who', 'rotation', 'note', 'pin', 'start', 'end'];

// values: { who, rotation, note, pin, start, end } with start and end as minutes; a placeholder the caller
// leaves out renders empty. Returns { text, unknown }.
function gcalFormat(template, values) {
  var full = {};
  GCAL_PLACEHOLDERS.forEach(function (name) { full[name] = values[name]; });
  return formatTemplate(template, full);
}

function gcalTemplateErrors(template, field) {
  return templateErrors(template, field, GCAL_PLACEHOLDERS);
}
