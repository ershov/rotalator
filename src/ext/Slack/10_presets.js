// Slack extension: presets from the #Slack tab or slack.csv (DESIGN 14.1). The tab grammar is the core's
// parsePresetTab (72_presets.js); this file supplies the settings table, the value parsers and the id rows.
// Everything of the extension is prefixed slack.
var SLACK_DEFAULT_TEXT = '{who} is on call for {rotation} from {start} to {end}';
var SLACK_PLACEHOLDERS = ['who', 'prev', 'next', 'rotation', 'start', 'end', 'note', 'pin', 'group'];
var SLACK_MEMBER_PLACEHOLDERS = ['who', 'prev', 'next'];
var SLACK_ID_TYPE = 'id';
var SLACK_TO_HINT = 'comma-separated destinations: a channel id (C..., G...), #channel, an email, a user id (U..., W...) or {who}, {prev}, {next}';
var SLACK_WHEN_HINT = 'a signed clock interval relative to the shift start like 0, -3d, 2h or 1d12h (units d, h, m)';
var SLACK_GROUP_HINT = 'a user group as @handle or its id S...';

function slackIsChannelId(text) {
  return /^[CG][A-Z0-9]+$/.test(text);
}

function slackIsUserId(text) {
  return /^[UW][A-Z0-9]+$/.test(text);
}

function slackIsGroupId(text) {
  return /^S[A-Z0-9]+$/.test(text);
}

function slackIsEmail(text) {
  return /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(text);
}

function slackIsChannelName(text) {
  return /^#[^\s,;<>]+$/.test(text);
}

// One destination: an id, a #channel, an email or a single placeholder (checked as a template afterwards).
function slackIsDestination(text) {
  return slackIsChannelId(text) || slackIsUserId(text) || slackIsChannelName(text) || slackIsEmail(text) || /^\{[A-Za-z]+\}$/.test(text);
}

// to: the list of destination templates; null when empty or when an item is none of the forms.
function slackParseTo(text) {
  var items = splitList(text);
  return items.length && items.every(slackIsDestination) ? items : null;
}

// when: signed clock interval in minutes; a leading - puts the window before the shift start.
function slackParseWhen(text) {
  var t = text.trim();
  var sign = 1;
  if (t.charAt(0) === '-') { sign = -1; t = t.slice(1).trim(); }
  // parseDuration accepts weeks; when does not.
  if (/w/i.test(t)) return null;
  var minutes = parseDuration(t);
  return minutes === null ? null : sign * minutes;
}

function slackParseText(text) {
  return text === '' ? null : text;
}

function slackParseGroup(text) {
  return /^@[^\s@,;<>]+$/.test(text) || slackIsGroupId(text) ? text : null;
}

// parse returns null on a bad value; def is the value of an unset setting; to and text are templates
// (core parsePresetTab), to with the member placeholders only.
var SLACK_SETTINGS = {
  to:    { parse: slackParseTo,    def: [],                 hint: SLACK_TO_HINT, template: true, placeholders: SLACK_MEMBER_PLACEHOLDERS },
  when:  { parse: slackParseWhen,  def: 0,                  hint: SLACK_WHEN_HINT },
  text:  { parse: slackParseText,  def: SLACK_DEFAULT_TEXT, template: true },
  group: { parse: slackParseGroup, def: null,               hint: SLACK_GROUP_HINT },
};

// A preset must send a message or keep a group; a to or group row that failed to parse is reported already.
function slackCheckPreset(preset) {
  var given = preset.setRows.to !== undefined || preset.setRows.group !== undefined;
  return given ? null : 'preset "' + preset.name + '" needs to or group';
}

// <name> | id | <Slack id>: a cached resolution (DESIGN 14.4), script-owned and never a preset row.
function slackIsIdRow(cells) {
  return cellText(cells[0]) !== '' && cellText(cells[1]).toLowerCase() === SLACK_ID_TYPE;
}

// { presets, errors, ids }: the core grammar over the rows with the id rows blanked so row numbers hold, and
// the id rows as a name to id map.
function parseSlackPresets(rows) {
  var ids = {};
  var cleaned = (rows || []).map(function (cells) {
    if (!slackIsIdRow(cells)) return cells;
    ids[cellText(cells[0])] = cellText(cells[2]);
    return ['', '', ''];
  });
  var out = parsePresetTab(cleaned, SLACK_SETTINGS, { tab: SLACK_TAB, placeholders: SLACK_PLACEHOLDERS, check: slackCheckPreset });
  out.ids = ids;
  return out;
}

function slackPreset(inputs, name) {
  return (inputs && inputs.presets || []).find(function (p) { return p.name === name; }) || null;
}

// Hook: the extension's inputs, read through the storage before the run (DESIGN 8, Extensions). Error rows
// of the previous run are dropped first; when the presets have errors, or error rows were dropped, the tab is
// written back with an error row above each offending row (13.1), id rows kept in place. A storage that only
// reads gets no write.
function slack_readInputs(storage) {
  var read = typeof storage.readTabRows === 'function' ? storage.readTabRows(SLACK_TAB, PRESET_HEADER) : [];
  var rows = dropPresetErrorRows(read);
  var inputs = parseSlackPresets(rows);
  inputs.rows = rows;
  if (typeof storage.writeTabRows === 'function') {
    var written = presetRowsWithErrors(rows, inputs.errors);
    if (JSON.stringify(written) !== JSON.stringify(presetRowsWithErrors(read, []))) storage.writeTabRows(SLACK_TAB, PRESET_HEADER, written);
  }
  return inputs;
}
