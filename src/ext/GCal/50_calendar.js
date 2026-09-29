// GCal extension: the CalendarApp adapter (DESIGN 13.4). Plumbing around the pure plan: reconcile a calendar
// against the desired events, delete tagged events for a clean, and the gcal_afterRun hook. Needs CalendarApp
// and Utilities; the tests provide mocks.
var GCAL_DATETIME_PATTERN = "yyyy-MM-dd'T'HH:mm";

// Timed instants are converted in the spreadsheet time zone; all-day dates in the script time zone, which is
// what createAllDayEvent, setAllDayDates, getAllDayStartDate and getAllDayEndDate work in, so the result does
// not depend on the two zones matching.
function gcalScriptTimeZone(tz) {
  return typeof Session !== 'undefined' ? Session.getScriptTimeZone() : tz;
}

// Sheet datetime text (naive) to a Date and back to the canonical text.
function gcalToDate(text, tz, allDay) {
  var zone = allDay ? gcalScriptTimeZone(tz) : tz;
  return Utilities.parseDate(text.indexOf('T') < 0 ? text + 'T00:00' : text, zone, GCAL_DATETIME_PATTERN);
}

function gcalFromDate(date, tz, allDay) {
  var zone = allDay ? gcalScriptTimeZone(tz) : tz;
  return formatDateTime(parseDateTime(Utilities.formatDate(date, zone, GCAL_DATETIME_PATTERN)));
}

function gcalGuests(list) {
  return gcalSorted(list.map(function (g) { return g.toLowerCase(); }));
}

function gcalColorValue(n) {
  var name = Object.keys(GCAL_COLORS).find(function (k) { return GCAL_COLORS[k] === n; });
  return CalendarApp.EventColor[name];
}

function gcalTransparency(free) {
  return free ? CalendarApp.EventTransparency.TRANSPARENT : CalendarApp.EventTransparency.OPAQUE;
}

function gcalSorted(list) {
  return list.slice().sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
}

function gcalSameList(a, b) {
  return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
}

// The state of an existing event in plan terms. Guest emails are compared lower-cased, as Calendar returns
// them.
function gcalEventState(ev, tz) {
  var allDay = ev.isAllDayEvent();
  return {
    title: ev.getTitle(),
    body: ev.getDescription(),
    start: gcalFromDate(allDay ? ev.getAllDayStartDate() : ev.getStartTime(), tz, allDay),
    end: gcalFromDate(allDay ? ev.getAllDayEndDate() : ev.getEndTime(), tz, allDay),
    allDay: allDay,
    color: ev.getColor() || '',
    free: ev.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT,
    guests: gcalGuests(ev.getGuestList().map(function (g) { return g.getEmail(); })),
    reminders: gcalSorted(ev.getPopupReminders()),
  };
}

// Fields of an existing event that differ from the desired one. A preset without color leaves the colour
// alone, and one without reminders leaves the event's reminders alone (the calendar defaults apply).
function gcalDiff(state, want) {
  var diff = [];
  if (state.title !== want.title) diff.push('title');
  if (state.body !== want.body) diff.push('body');
  if (state.allDay !== want.allDay || state.start !== want.start || state.end !== want.end) diff.push('time');
  if (want.color !== null && state.color !== String(want.color)) diff.push('color');
  if (state.free !== want.free) diff.push('free');
  if (!gcalSameList(state.guests, gcalGuests(want.guests))) diff.push('guests');
  if (want.reminders.length && !gcalSameList(state.reminders, gcalSorted(want.reminders))) diff.push('reminders');
  return diff;
}

// All-day end dates are exclusive, like the plan's end.
function gcalApplyTime(ev, want, tz) {
  var start = gcalToDate(want.start, tz, want.allDay), end = gcalToDate(want.end, tz, want.allDay);
  if (want.allDay) ev.setAllDayDates(start, end);
  else ev.setTime(start, end);
}

// A non-empty list is applied exactly; an empty one is never applied, so a new event keeps the calendar's
// default reminders and an existing one keeps whatever it has.
function gcalApplyReminders(ev, want) {
  if (!want.reminders.length) return;
  ev.removeAllReminders();
  want.reminders.forEach(function (m) { ev.addPopupReminder(m); });
}

// Invitations go out on creation only.
function gcalCreate(calendar, want, tz) {
  var options = { description: want.body };
  if (want.guests.length) { options.guests = want.guests.join(','); options.sendInvites = true; }
  var start = gcalToDate(want.start, tz, want.allDay), end = gcalToDate(want.end, tz, want.allDay);
  var ev = want.allDay ? calendar.createAllDayEvent(want.title, start, end, options) : calendar.createEvent(want.title, start, end, options);
  ev.setTag(GCAL_TAG, want.key);
  if (want.color !== null) ev.setColor(gcalColorValue(want.color));
  ev.setTransparency(gcalTransparency(want.free));
  gcalApplyReminders(ev, want);
  return ev;
}

function gcalUpdate(ev, state, want, diff, tz) {
  if (diff.indexOf('title') >= 0) ev.setTitle(want.title);
  if (diff.indexOf('body') >= 0) ev.setDescription(want.body);
  if (diff.indexOf('time') >= 0) gcalApplyTime(ev, want, tz);
  if (diff.indexOf('color') >= 0) ev.setColor(gcalColorValue(want.color));
  if (diff.indexOf('free') >= 0) ev.setTransparency(gcalTransparency(want.free));
  if (diff.indexOf('guests') >= 0) {
    var wanted = gcalGuests(want.guests);
    wanted.forEach(function (g) { if (state.guests.indexOf(g) < 0) ev.addGuest(g); });
    state.guests.forEach(function (g) { if (wanted.indexOf(g) < 0) ev.removeGuest(g); });
  }
  if (diff.indexOf('reminders') >= 0) gcalApplyReminders(ev, want);
}

// Events of the rotation in [from, to): tagged rotalator=<rotation>|<start> with start at or after from.
// Untagged events, other rotations' events and events of shifts before the window are never touched.
function gcalTaggedEvents(calendar, rotation, from, to, tz) {
  var prefix = rotation + '|';
  var fromMin = parseDateTime(from);
  return calendar.getEvents(gcalToDate(from, tz), gcalToDate(to, tz))
    .map(function (ev) { return { key: ev.getTag(GCAL_TAG), event: ev }; })
    .filter(function (t) { return t.key && t.key.indexOf(prefix) === 0 && parseDateTime(t.key.slice(prefix.length)) >= fromMin; });
}

// Asks the run guard between steps and remembers the first reason, so every later call says stop too.
function gcalStopper(guard) {
  var reason = null;
  return {
    stop: function () { if (reason === null) reason = guard.stopReason(); return reason !== null; },
    reason: function () { return reason; },
  };
}

// Records an early stop (stopped, note after `done` steps of `what`) and the elapsed seconds on a result.
function gcalFinish(out, stopper, done, what, guard) {
  if (stopper.reason() !== null) { out.stopped = stopper.reason(); out.note = stopNote(out.stopped, done, what); }
  out.elapsed = guard.elapsedSeconds();
  return out;
}

// Reconciles every calendar of the plan and fills the counts of data (gcalStatusData). options: tz; dry to
// compute the counts without writing; guard (default the run's, DESIGN 10.4), asked between events whether
// to stop, in which case the remaining events and calendars are left for the next run and data.note says
// why; progress(line), called when a calendar is done; ticker(), called per calendar for a step function
// that receives { calendar, done, total, what, elapsed } at loop start and after each event (the adapter's
// throttled toast, 10.4). Creates and updates stay inside [from, to); the
// rotation's tagged events are fetched up to `until` (the clean bound after now), so events left beyond a
// shortened horizon are deleted too. A missing calendar or an API failure is recorded in data.errors and the
// other calendars proceed. Duplicate events with one key are deleted down to one.
function gcalReconcile(plan, data, options) {
  var tz = options.tz;
  var dry = Boolean(options.dry);
  var guard = options.guard || currentRunGuard();
  var progress = options.progress || function () {};
  var ticker = options.ticker || function () { return function () {}; };
  var done = 0;
  var stopper = gcalStopper(guard);
  var stop = stopper.stop;
  plan.rotations.forEach(function (rot) {
    rot.presets.forEach(function (preset, i) {
      if (stop()) return;
      var id = rot.calendars[i];
      var line = data.lines.find(function (l) { return l.rotation === rot.rotation && l.preset === preset; });
      var wanted = plan.events.filter(function (e) { return e.rotation === rot.rotation && e.preset === preset; });
      try {
        var calendar = CalendarApp.getCalendarById(id);
        if (!calendar) throw new Error('calendar "' + id + '" not found or not shared with this account');
        var existing = {};
        var duplicates = [];
        gcalTaggedEvents(calendar, rot.rotation, rot.from, rot.until || rot.to, tz).forEach(function (t) {
          if (existing[t.key]) duplicates.push(t.event); else existing[t.key] = t.event;
        });
        var wantedKeys = {};
        wanted.forEach(function (want) { wantedKeys[want.key] = true; });
        var staleCount = Object.keys(existing).filter(function (key) { return !wantedKeys[key]; }).length + duplicates.length;
        var step = ticker();
        var here = 0;
        var tick = function () { step({ calendar: id, done: here, total: wanted.length + staleCount, what: 'events', elapsed: guard.elapsedSeconds() }); };
        tick();
        for (var w = 0; w < wanted.length && !stop(); w++) {
          var want = wanted[w];
          var ev = existing[want.key];
          delete existing[want.key];
          done++;
          here++;
          if (!ev) { if (!dry) gcalCreate(calendar, want, tz); line.create++; tick(); continue; }
          var state = gcalEventState(ev, tz);
          var diff = gcalDiff(state, want);
          if (diff.length) { if (!dry) gcalUpdate(ev, state, want, diff, tz); line.update++; } else line.unchanged++;
          tick();
        }
        var stale = Object.keys(existing).map(function (key) { return existing[key]; }).concat(duplicates);
        for (var s = 0; s < stale.length && !stop(); s++) {
          done++;
          here++;
          if (!dry) stale[s].deleteEvent();
          line.delete++;
          tick();
        }
        if (stopper.reason() === null) progress(line);
      } catch (e) {
        data.errors.push({ where: rot.rotation + ' / ' + preset, rotation: rot.rotation, preset: preset, message: e && e.message ? e.message : String(e) });
      }
    });
  });
  return gcalFinish(data, stopper, done, 'event(s)', guard);
}

// In-place error rows for calendars that could not be opened or failed (DESIGN 13.4): above the preset's id
// row in #GCal (the preset row when it has none), on top of the parse errors already there, wherever the
// storage can write.
function gcalWriteCalendarErrors(storage, inputs, data) {
  if (typeof storage.writeTabRows !== 'function' || !inputs || !inputs.rows) return;
  var extra = [];
  data.errors.forEach(function (e) {
    var preset = e.preset ? gcalPreset(inputs, e.preset) : null;
    if (preset) extra.push({ row: preset.setRows.id || preset.row, message: e.message + ' (' + e.where + ')' });
  });
  if (extra.length) storage.writeTabRows(GCAL_TAB, PRESET_HEADER, gcalRowsWithErrors(inputs.rows, inputs.errors.concat(extra)));
}

// Deletes tagged events per a clean plan (gcalCleanPlan): a rotation's events (tag prefix rotation|) in its
// window in each of its calendars, or every tagged event of one calendar between options.from and options.to.
// options.guard (default the run's) is asked between deletions; options.ticker as in gcalReconcile, with
// what 'deletions'. Returns { deleted, errors, note, elapsed }.
function gcalClean(clean, options) {
  var out = { deleted: 0, errors: [] };
  var guard = options.guard || currentRunGuard();
  var ticker = options.ticker || function () { return function () {}; };
  var stopper = gcalStopper(guard);
  var stop = stopper.stop;
  var targets = clean.all
    ? [{ calendar: clean.calendar, prefix: '', from: options.from, to: options.to }]
    : clean.calendars.map(function (id) { return { calendar: id, prefix: clean.rotation + '|', from: clean.from, to: clean.to }; });
  targets.forEach(function (t) {
    if (stop()) return;
    try {
      var calendar = CalendarApp.getCalendarById(t.calendar);
      if (!calendar) throw new Error('calendar "' + t.calendar + '" not found or not shared with this account');
      var events = calendar.getEvents(gcalToDate(t.from, options.tz), gcalToDate(t.to, options.tz)).filter(function (ev) {
        var key = ev.getTag(GCAL_TAG);
        return key && key.indexOf(t.prefix) === 0;
      });
      var step = ticker();
      var here = 0;
      var tick = function () { step({ calendar: t.calendar, done: here, total: events.length, what: 'deletions', elapsed: guard.elapsedSeconds() }); };
      tick();
      for (var i = 0; i < events.length && !stop(); i++) {
        if (!options.dry) events[i].deleteEvent();
        out.deleted++;
        here++;
        tick();
      }
    } catch (e) {
      out.errors.push({ where: t.calendar, message: e && e.message ? e.message : String(e) });
    }
  });
  return gcalFinish(out, stopper, out.deleted, 'deletion(s)', guard);
}

// Progress toasts (DESIGN 10.4), only where a spreadsheet UI exists: at the start of an export, with the
// pending writes flushed so the ledgers are visible before the calendar loop, and per finished calendar.
function gcalAnnounce(plan) {
  if (typeof SpreadsheetApp === 'undefined') return;
  var calendars = {};
  plan.rotations.forEach(function (r) { r.calendars.forEach(function (id) { calendars[id] = true; }); });
  toast('exporting ' + plan.events.length + ' event(s) to ' + Object.keys(calendars).length + ' calendar(s)', GCAL_TOAST_TITLE);
  SpreadsheetApp.flush();
}

function gcalProgress(line) {
  if (typeof SpreadsheetApp === 'undefined') return;
  toast(line.rotation + ' / ' + line.preset + ': ' + GCAL_COUNTS.map(function (c) { return c + ' ' + line[c]; }).join(', '), GCAL_TOAST_TITLE);
}

var GCAL_PROGRESS_MS = 10000;

// Ticker for the loops (10.4): per calendar a step function that toasts "<action> <calendar>: X / Y events
// done, N s" at most every ten seconds, the first at loop start; nothing without a spreadsheet UI.
function gcalTicker(action) {
  if (typeof SpreadsheetApp === 'undefined') return undefined;
  return function () {
    return throttledProgress(function (info) {
      toast(action + ' ' + info.calendar + ': ' + info.done + ' / ' + info.total + ' ' + info.what + ' done, ' + info.elapsed + ' s', GCAL_TOAST_TITLE);
    }, GCAL_PROGRESS_MS, Date.now);
  };
}

// Hook (DESIGN 8, Extensions): after a run without errors, export the regenerated rotations. A dry run, or a
// run that does not write, computes the counts only; without CalendarApp (Node) the plan is recorded as is.
// The status gets a Calendar block when a rotation uses cal or the presets have errors. options.export ===
// false leaves the export to the caller (the menu actions run the scheduler without writing).
function gcal_afterRun(result, storage, options) {
  if (options.export === false) return;
  var plan = gcalPlan(result, result.ext.gcal, {});
  var data = gcalStatusData(plan);
  var dry = !options.write || options.mode === 'dry run';
  if (typeof CalendarApp === 'undefined') { data.mode = 'no calendar'; data.elapsed = currentRunGuard().elapsedSeconds(); }
  else {
    if (dry) data.mode = 'dry run';
    if (plan.events.length) gcalAnnounce(plan);
    gcalReconcile(plan, data, { tz: storage.tz, dry: dry, progress: gcalProgress, ticker: gcalTicker('exporting') });
  }
  // The cal value's own errors go above its set row, only when the run writes (DESIGN 6).
  if (options.write) writeSettingErrors(result, storage, plan.errors, 'cal');
  gcalWriteCalendarErrors(storage, result.ext.gcal, data);
  // The extension's errors count as errors of the run and a stop note as a warning (DESIGN 6, 10.4).
  data.errors.forEach(function (e) { result.errors.push('GCal ' + e.where + ': ' + e.message); });
  if (data.note) result.status.warnings.push({ rotation: 'GCal', start: null, message: data.note });
  if (!plan.rotations.length && !data.errors.length) return;
  result.status.ext = result.status.ext || {};
  result.status.ext.gcal = data;
}
