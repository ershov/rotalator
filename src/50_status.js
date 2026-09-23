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
