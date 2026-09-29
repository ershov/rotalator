// Slack extension: menu actions, the hourly tick, Set Up and #Help lines (DESIGN 14.5). Apps Script entry
// points; they use the core's SheetsStorage, runStorage, withLock and toast.
var SLACK_TOAST_TITLE = 'Rotalator Slack';
var SLACK_COLUMN_WIDTHS = [140, 120, 700];
var SLACK_TICK_HANDLER = 'slackTick';
var SLACK_TEST_PREFIX = '[test] ';
var SLACK_TEMPLATE_TO = '#FILL-IN-WITH-CHANNEL';
var SLACK_TEMPLATE_GROUP = '@oncall';
var SLACK_TEMPLATE_HEADS_TEXT = 'Reminder: you are on call for {rotation} from {start:%a %e %b} to {end:%a %e %b}';

// Cheat sheet shared by the #Slack template (comment rows in column C) and #Help. Built on call: the default
// text lives in another file.
function slackCheatSheet() {
  return [
    'SETTINGS (one per row under a preset row: setting in B, value in C; a preset needs to or group):',
    'to: comma-separated destinations: a channel id (C..., G...) or #channel, a person by email or user id (U..., W...), or {who}, {prev}, {next}; default empty',
    'when: signed clock interval relative to the shift start: 0 at the handover, -3d three days before, 2h after, 1d12h (units d, h, m); default 0',
    'text: message template, default ' + SLACK_DEFAULT_TEXT,
    'group: a user group kept pointing at the people on call, @handle or its id S...; default empty',
    'TEMPLATES: {who} {prev} {next} {rotation} {start} {end} {note} {pin} {group}; {start:%a %e %b} with %Y %m %d %e %H %M %a %A %b %B %j %u; members and the group become mentions when their id is known',
    'IDS: rows "<name> | id | <Slack id>" cache resolved ids; the script appends them; add one by hand for a member whose id is not an email, delete one to force a new lookup',
    'USE: set slack=<preset> [<preset> ...] in a rotation or in #Global, then Run',
  ];
}

function slackHelpLines() {
  return [
    '',
    'SLACK (Slack extension, #Slack tab: preset | setting | value):',
    'preset row: name in A (letters, digits, - _), note in C; setting rows below it: setting in B, value in C',
  ].concat(slackCheatSheet().slice(1), [
    'timing: a message goes out in the first run whose instant falls in [start + when, end + when) of a shift, once per shift, destination and assignee (#Slack state remembers; delete a row there to send again); the nightly trigger delivers between 02:00 and 03:00, the hourly Slack trigger within the hour',
    'groups: a group holds the people on call now in every rotation naming a preset with it; anyone added by hand is removed at the next run; with nobody on call the group is left as it is',
    'Set Slack token... | Remove Slack token: the bot token (xoxb-...) lives in a script property, never in a cell',
    'Check Slack connection: calls auth.test and shows the workspace and the bot name',
    'Send test message: selected preset: posts the preset on the selected row of #Slack, prefixed [test], for the shift in force in the first rotation naming it, without recording it',
    'Install hourly Slack trigger | Remove hourly Slack trigger: an hourly tick that posts and updates groups without rewriting the ledgers',
  ]);
}

// Header, cheat sheet as comment rows, an empty row, then the team and heads-up presets to fill in.
function slackTemplateRows() {
  var comment = function (text) { return ['', '', text]; };
  var setting = function (key, value) { return ['', key, value]; };
  return [PRESET_HEADER.slice()].concat(slackCheatSheet().map(comment), [
    ['', '', ''],
    ['team', '', 'Channel handover message and the ' + SLACK_TEMPLATE_GROUP + ' group'],
    setting('to', SLACK_TEMPLATE_TO),
    setting('when', '0'),
    setting('text', SLACK_DEFAULT_TEXT),
    setting('group', SLACK_TEMPLATE_GROUP),
    ['heads-up', '', 'Reminder to the person three days before'],
    setting('to', '{who}'),
    setting('when', '-3d'),
    setting('text', SLACK_TEMPLATE_HEADS_TEXT),
  ]);
}

// Row colours like #GCal (13.5) plus id rows light grey; the id rule comes before the preset rule since both
// match a non-empty column A.
function slackFormatRules() {
  return [
    { formula: '=$B1="' + PRESET_ERROR_TYPE + '"', color: COLOR_ERROR },
    { formula: '=LOWER($B1)="' + SLACK_ID_TYPE + '"', color: COLOR_DETACH },
    { formula: '=AND($A1<>"", ROW()>1)', color: COLOR_SETTINGS },
    { formula: '=AND($A1="", $B1="", $C1<>"")', color: COLOR_COMMENT },
  ];
}

function slack_menu(menu) {
  menu.addSeparator()
    .addItem('Set Slack token…', 'slackSetToken')
    .addItem('Remove Slack token', 'slackRemoveToken')
    .addItem('Check Slack connection', 'slackCheckConnection')
    .addItem('Send test message: selected preset', 'slackSendTest')
    .addItem('Install hourly Slack trigger', 'slackInstallTrigger')
    .addItem('Remove hourly Slack trigger', 'slackRemoveTrigger');
}

function slack_help(lines) {
  return slackHelpLines();
}

// #Slack is formatted as a preset tab (core formatPresetTab) with its widths and row colours.
function slackFormatTab(sheet) {
  formatPresetTab(sheet, SLACK_COLUMN_WIDTHS, slackFormatRules());
}

// The tab #Slack follows: #GCal when present, else #Global.
function slackAnchorTab(ss) {
  return ss.getSheetByName(GCAL_TAB) || ss.getSheetByName(GLOBAL_TAB);
}

// Hook: creates #Slack after #GCal or #Global with the template when missing or empty, places and formats it;
// an existing #Slack state gets the colour of the script-written tabs.
function slack_setup(ss) {
  var sheet = ss.getSheetByName(SLACK_TAB);
  if (!sheet) {
    var anchor = slackAnchorTab(ss);
    sheet = ss.insertSheet(SLACK_TAB, anchor ? anchor.getIndex() : ss.getNumSheets());
  }
  if (isEmptySheet(sheet)) writeTextCells(sheet, 1, slackTemplateRows());
  placeTabAfter(ss, sheet, slackAnchorTab(ss));
  slackFormatTab(sheet);
  var state = ss.getSheetByName(SLACK_STATE_TAB);
  if (state) state.setTabColor(TAB_COLOR_GENERATED);
  return sheet;
}

// Hook: Set Up Tab on #Slack fills an empty tab from the template; any other tab is left to the core.
function slack_setupTab(sheet) {
  if (sheet.getName() !== SLACK_TAB) return false;
  if (!isEmptySheet(sheet)) { toast('"' + SLACK_TAB + '" is not empty; Set Up Tab only fills empty tabs', SLACK_TOAST_TITLE); return true; }
  writeTextCells(sheet, 1, slackTemplateRows());
  slackFormatTab(sheet);
  toast('"' + SLACK_TAB + '" set up from the template; fill in the channel of team', SLACK_TOAST_TITLE);
  return true;
}

// Menu: Set Slack token. The token goes into a script property and is never shown or written to a cell.
function slackSetToken() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('Slack bot token', 'Paste the bot token (xoxb-...). It is stored in a script property, never in a cell.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return false;
  var token = response.getResponseText().trim();
  if (token === '') { toast('no token entered; nothing changed', SLACK_TOAST_TITLE); return false; }
  PropertiesService.getScriptProperties().setProperty(SLACK_TOKEN_PROPERTY, token);
  toast('Slack token stored', SLACK_TOAST_TITLE);
  return true;
}

function slackRemoveToken() {
  PropertiesService.getScriptProperties().deleteProperty(SLACK_TOKEN_PROPERTY);
  toast('Slack token removed', SLACK_TOAST_TITLE);
}

// Menu: Check Slack connection. auth.test names the workspace and the bot.
function slackCheckConnection() {
  return withLock(function () {
    try {
      var info = slackApi('auth.test', {});
      toast('connected to ' + info.team + ' as ' + info.user, SLACK_TOAST_TITLE);
      return info;
    } catch (e) {
      toast(e.message, SLACK_TOAST_TITLE);
      return null;
    }
  });
}

// The active cell's row in #Slack names the preset; a setting or id row counts for the preset above it.
function slackSelectedPreset(sheet) {
  if (sheet.getName() !== SLACK_TAB) return null;
  var row = sheet.getActiveRange().getRow();
  var cells = sheet.getRange(1, 1, Math.max(row, 1), 2).getValues();
  while (row > 1 && (cellText(cells[row - 1][0]) === '' || slackIsIdRow(cells[row - 1]))) row--;
  return row > 1 ? cellText(cells[row - 1][0]) : null;
}

// The test messages of a preset, pure: its destinations rendered for the shift in force at now in the first
// rotation whose slack names it. Returns { rotation, messages, error }; messages as in slackPlan.
function slackTestPlan(run, inputs, name) {
  var preset = slackPreset(inputs, name);
  if (!preset) return { rotation: null, messages: [], error: 'unknown preset "' + name + '"' };
  if (preset.errors.length) return { rotation: null, messages: [], error: 'preset "' + name + '" has errors: ' + preset.errors.join('; ') };
  if (!preset.to.length) return { rotation: null, messages: [], error: 'preset "' + name + '" has no to' };
  var rot = run.status.rotations.find(function (r) {
    var setting = r.settings.values.find(function (s) { return s.key === 'slack'; });
    return setting && setting.value.split(' ').indexOf(name) >= 0;
  });
  if (!rot) return { rotation: null, messages: [], error: 'no rotation names preset "' + name + '" in slack' };
  var shifts = slackRotationShifts(run, rot.name);
  var now = run.status.at;
  var i = shifts.findIndex(function (s) { return s.start <= now && now < s.end; });
  if (i < 0 || shifts[i].who === '') return { rotation: rot.name, messages: [], error: 'nobody on call in ' + rot.name + ' now' };
  return { rotation: rot.name, messages: slackShiftMessages(rot.name, preset, shifts, i).messages, error: null };
}

// Menu: Send test message. Runs the scheduler without writing, posts the selected preset's messages with the
// [test] prefix through the adapter (id rows and error rows reach #Slack), and leaves #Slack state alone.
function slackSendTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = slackSelectedPreset(ss.getActiveSheet());
  if (name === null) { toast('select a preset row in ' + SLACK_TAB, SLACK_TOAST_TITLE); return null; }
  return withLock(function () {
    var storage = new SheetsStorage(ss);
    var result = runStorage(storage, storage.nowText, { write: false, export: false, slack: false });
    if (result.errors.length) { toast(result.errors.length + ' error(s), nothing sent: ' + result.errors[0], SLACK_TOAST_TITLE); return null; }
    var test = slackTestPlan(result, result.ext.slack, name);
    if (test.error) { toast(test.error, SLACK_TOAST_TITLE); return null; }
    var plan = { lines: [{ rotation: test.rotation, preset: name, due: test.messages.length, skipped: 0 }], messages: test.messages, groups: [], errors: [], warnings: [] };
    var data = slackStatusData(plan);
    var delivery = slackDeliver(plan, data, result.ext.slack, result.status.now, SLACK_TEST_PREFIX);
    slackWriteDelivery(storage, result.ext.slack, delivery);
    data.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
    toast('test message of ' + name + ' for ' + test.rotation + ': ' + delivery.posted.length + ' sent, ' + data.errors.length + ' failed' + (data.errors.length ? ': ' + data.errors[0].message : ''), SLACK_TOAST_TITLE);
    return data;
  });
}

// Options of the hourly tick: nothing written by the core, no calendar export, Slack delivery on (14.5).
var SLACK_TICK_OPTIONS = { write: false, export: false, slack: true };

// Trigger handler: posts and updates groups from a read of all rotations, under the lock like Run.
function slackTick() {
  return withLock(function () {
    var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
    var result = runStorage(storage, storage.nowText, SLACK_TICK_OPTIONS);
    result.errors.forEach(function (e) { console.log(e); });
    return result;
  });
}

function slackDeleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === SLACK_TICK_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function slackInstallTrigger() {
  slackDeleteTriggers();
  ScriptApp.newTrigger(SLACK_TICK_HANDLER).timeBased().everyHours(1).create();
  toast('hourly Slack trigger installed', SLACK_TOAST_TITLE);
}

function slackRemoveTrigger() {
  slackDeleteTriggers();
  toast('hourly Slack trigger removed', SLACK_TOAST_TITLE);
}
