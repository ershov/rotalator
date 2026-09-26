// GCal extension: the export plan, pure. Desired events per rotation and preset from the runner's result and
// the parsed presets; the CalendarApp adapter reconciles the calendar against it.
var GCAL_TAG = 'rotalator';
// Bound of a whole-calendar clean and of the nightly deletions around now (13.4).
var GCAL_CLEAN_YEARS_BACK = 1;
var GCAL_CLEAN_YEARS_AHEAD = 3;

// Window of a whole-calendar clean; its end also bounds the stale events the reconcile deletes.
function gcalCleanWindow(now) {
  return {
    from: formatDateTime(now - GCAL_CLEAN_YEARS_BACK * 365 * MINUTES_PER_DAY),
    to: formatDateTime(now + GCAL_CLEAN_YEARS_AHEAD * 365 * MINUTES_PER_DAY),
  };
}

// Event key, the tag value on the calendar event: rotation|start in the sheet's datetime form.
function gcalEventKey(rotation, start) {
  return rotation + '|' + formatDateTime(start);
}

// Shifts of a written rotation: start, end and assignee from the status (the swept extents), pin and note
// from the written rows. who is '' for a nobody shift.
function gcalRotationShifts(run, name) {
  var byStart = {};
  rowsFromCells(run.ledgers[name] || []).forEach(function (r) { if (r.type === 'shift' && r.start !== null) byStart[r.start] = r; });
  return run.status.shifts.filter(function (s) { return s.rotation === name; }).map(function (s) {
    var row = byStart[s.start];
    return { start: s.start, end: s.end, who: s.who, pin: row ? row.pin : '', note: row ? row.note : '' };
  });
}

// Presets named by the rotation's cal value, in order; unknown names, presets with errors and a second preset
// on the same calendar (its events would share the first one's keys) are reported and skipped.
function gcalRotationPresets(cal, inputs, rotation, errors) {
  var out = [];
  var calendars = {};
  (cal === '' ? [] : cal.split(' ')).forEach(function (name) {
    var preset = gcalPreset(inputs, name);
    if (!preset) errors.push({ where: rotation, message: 'unknown preset "' + name + '" in cal; add it to ' + GCAL_TAB });
    else if (preset.errors.length) errors.push({ where: rotation, message: 'preset "' + name + '" skipped: ' + preset.errors.join('; ') });
    else if (calendars[preset.id]) errors.push({ where: rotation, message: 'preset "' + name + '" skipped: calendar ' + preset.id + ' is already used by preset "' + calendars[preset.id] + '"' });
    else { calendars[preset.id] = name; out.push(preset); }
  });
  return out;
}

// Export window [from, to): from the stored snapshot the run started at (everything after it may have
// changed) to horizonEnd; without a stored snapshot, or when repairing, from the rotation's first shift.
function gcalWindow(rot, shifts, repair) {
  var first = shifts.length ? shifts[0].start : rot.snapshotAt;
  var from = repair || rot.previousAt === null || rot.previousAt === undefined ? first : rot.previousAt;
  return { from: from, to: rot.horizonEnd };
}

// Title and body are trimmed, so an empty {note} at the end of the default body leaves no trailing space.
function gcalEvent(rotation, preset, shift) {
  var values = { who: shift.who, rotation: rotation, note: shift.note, pin: shift.pin, start: shift.start, end: shift.end };
  var midnight = shift.start % MINUTES_PER_DAY === 0 && shift.end % MINUTES_PER_DAY === 0;
  return {
    key: gcalEventKey(rotation, shift.start),
    rotation: rotation,
    preset: preset.name,
    calendar: preset.id,
    title: gcalFormat(preset.title, values).text.trim(),
    body: gcalFormat(preset.body, values).text.trim(),
    start: formatDateTime(shift.start),
    end: formatDateTime(shift.end),
    allDay: preset.allday === 'auto' ? midnight : preset.allday,
    color: preset.color,
    free: preset.free,
    guests: preset.invite && shift.who.indexOf('@') >= 0 ? [shift.who] : [],
    reminders: preset.reminders.slice(),
  };
}

// run: the runner's result (DESIGN 8) after a run without errors; inputs: parseGCalPresets output.
// options: repair (window from the first shift), rotations (names; default every written rotation).
// Returns { rotations: [{ rotation, presets, calendars, from, to, until, shifts, skipped }], events, errors };
// events in rotation, start, preset order; skipped counts the nobody shifts inside the window; until is the
// later of to and the clean bound after now, up to which the adapter deletes the rotation's stale events.
function gcalPlan(run, inputs, options) {
  options = options || {};
  var plan = { rotations: [], events: [], errors: (inputs && inputs.errors || []).slice() };
  if (!run || !run.status) return plan;
  var names = options.rotations || Object.keys(run.ledgers);
  run.status.rotations.forEach(function (rot) {
    if (names.indexOf(rot.name) < 0 || !(rot.name in run.ledgers)) return;
    var cal = rot.settings.values.find(function (s) { return s.key === 'cal'; });
    var presets = gcalRotationPresets(cal ? cal.value : '', inputs, rot.name, plan.errors);
    if (!presets.length) return;
    var shifts = gcalRotationShifts(run, rot.name);
    var window = gcalWindow(rot, shifts, options.repair);
    var inside = shifts.filter(function (s) { return s.start >= window.from && s.start < window.to; });
    var wanted = inside.filter(function (s) { return s.who !== ''; });
    var until = Math.max(window.to, gcalCleanBound(run.status.at, window.to));
    plan.rotations.push({
      rotation: rot.name,
      presets: presets.map(function (p) { return p.name; }),
      calendars: presets.map(function (p) { return p.id; }),
      from: formatDateTime(window.from),
      to: formatDateTime(window.to),
      until: formatDateTime(until),
      shifts: wanted.length,
      skipped: inside.length - wanted.length,
    });
    wanted.forEach(function (shift) {
      presets.forEach(function (preset) { plan.events.push(gcalEvent(rot.name, preset, shift)); });
    });
  });
  return plan;
}

// The clean bound after now in minutes; fallback when now is unknown.
function gcalCleanBound(now, fallback) {
  return now === null || now === undefined ? fallback : parseDateTime(gcalCleanWindow(now).to);
}

// Clean plan: { rotation, calendars, from, to, keys } for a rotation (the adapter deletes its tagged events in
// [from, to), which reaches the clean bound so stale events beyond the horizon go too), or { calendar, all:
// true } for a preset (every tagged event). A missing preset or one with errors gives { error }.
function gcalCleanPlan(run, inputs, target) {
  if (target.preset !== undefined) {
    var preset = gcalPreset(inputs, target.preset);
    if (!preset) return { error: 'unknown preset "' + target.preset + '"' };
    if (preset.errors.length) return { error: 'preset "' + preset.name + '" has errors: ' + preset.errors.join('; ') };
    return { preset: preset.name, calendar: preset.id, all: true };
  }
  var rot = run && run.status ? run.status.rotations.find(function (r) { return r.name === target.rotation; }) : null;
  if (!rot) return { error: 'unknown rotation "' + target.rotation + '"' };
  var errors = [];
  var cal = rot.settings.values.find(function (s) { return s.key === 'cal'; });
  var presets = gcalRotationPresets(cal ? cal.value : '', inputs, rot.name, errors);
  var shifts = gcalRotationShifts(run, rot.name);
  var last = shifts.reduce(function (max, s) { return Math.max(max, s.end); }, gcalCleanBound(run.status.at, rot.horizonEnd));
  return {
    rotation: rot.name,
    calendars: presets.map(function (p) { return p.id; }),
    from: shifts.length ? formatDateTime(shifts[0].start) : formatDateTime(rot.snapshotAt),
    to: formatDateTime(last),
    keys: shifts.map(function (s) { return gcalEventKey(rot.name, s.start); }),
    errors: errors,
  };
}
