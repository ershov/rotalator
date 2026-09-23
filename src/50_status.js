// Status data and the 2D text arrays for the #Status and #All shifts tabs (DESIGN 5.8).

var STATUS_WIDTH = 8;
var SHIFTS_HEADER = ['pin', 'start', 'end', 'rotation', 'who', 'note'];
var MEMBER_HEADER = ['member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions'];

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

function shiftRef(entry) {
  return entry ? { who: entry.who === null ? '' : entry.who, start: entry.start, end: entry.end } : null;
}

// rot: swept rotation internals from 40_scheduler.js (roster, scoresAtS, entries, S, horizonEnd, timeline).
// now: run instant for the settings block and the current/next shift; S when absent.
function rotationStatus(rot, now) {
  var projected = rot.roster.scores();
  var S = rot.S;
  var at = now === null || now === undefined ? S : now;
  var current = null, upcoming = null;
  rot.entries.forEach(function (e) {
    if (e.start <= at && e.end > at) current = e;
    else if (e.start > at && upcoming === null) upcoming = e;
  });
  return {
    name: rot.name,
    snapshotAt: S,
    horizonEnd: rot.horizonEnd,
    current: shiftRef(current),
    next: shiftRef(upcoming),
    settings: effectiveSettings(rot.timeline, at),
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
        who: e.who === null ? '' : e.who,
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
    at: now === null || now === undefined ? null : now,
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

// Rows of the #Status tab plus presentation metadata: headerRows and dividerRows are row indexes for the
// adapter to format. status.now, status.mode and status.tabs are set by the runner.
function statusRows(status) {
  var rows = [];
  var headerRows = [];
  var push = function (cells) { rows.push(padStatusRow(cells)); };
  var header = function (cells) { headerRows.push(rows.length); push(cells); };
  header(['Rotalator', status.mode || '', status.now || '']);
  if (status.tabs) {
    push([]);
    header(['tabs']);
    push(['rotations', status.tabs.rotations.join(', ')]);
    push(['regenerated', status.tabs.regenerated.join(', ')]);
    push(['holidays', String(status.tabs.holidays)]);
    push(['links', String(status.tabs.links)]);
    push(['ignored', status.tabs.ignored.join(', ')]);
  }
  status.rotations.forEach(function (rot) {
    push([]);
    header(['rotation', rot.name]);
    push(['snapshot', statusInstant(rot.snapshotAt)]);
    push(['horizon', statusInstant(rot.horizonEnd)]);
    push(['current', rot.current ? rot.current.who : '', rot.current ? 'until ' + statusInstant(rot.current.end) : '']);
    push(['next', rot.next ? rot.next.who : '', rot.next ? 'from ' + statusInstant(rot.next.start) : '']);
    push([]);
    header([''].concat(MEMBER_HEADER));
    rot.roster.forEach(function (m) {
      push(['', m.name, rot.current && rot.current.who === m.name ? 'x' : '',
        m.score === null ? '' : formatScore(m.score), formatScore(m.projected),
        statusInstant(m.lastShift), statusInstant(m.nextShift), formatExclusions(m.exclusions)]);
    });
    push([]);
    header(['', 'settings', 'as of ' + statusInstant(rot.settings.at)]);
    rot.settings.values.forEach(function (s) { push(['', s.key, s.value]); });
    if (rot.settings.nextSetAt !== null) push(['', 'note', 'a set row at ' + statusInstant(rot.settings.nextSetAt) + ' changes these values']);
  });
  if (status.warnings.length) {
    push([]);
    header(['warnings']);
    header(['rotation', 'start', 'message']);
    status.warnings.forEach(function (w) { push([w.rotation, statusInstant(w.start), w.message]); });
  }
  if (status.errors.length) {
    push([]);
    header(['errors']);
    header(['rotation', 'where', 'message']);
    status.errors.forEach(function (e) {
      var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex : statusInstant(e.start);
      push([e.rotation, where, e.message]);
    });
  }
  return { rows: rows, headerRows: headerRows, dividerRows: [] };
}

// Rows of the #All shifts tab: header, shifts by start, and a divider row at the run instant between past
// and future shifts (omitted when status.at is unknown).
function shiftsRows(status) {
  var rows = [SHIFTS_HEADER.slice()];
  var dividerRows = [];
  var at = status.at;
  var placed = at === null || at === undefined;
  status.shifts.forEach(function (s) {
    if (!placed && s.start > at) {
      dividerRows.push(rows.length);
      rows.push(['', statusInstant(at), '', 'now', '', '']);
      placed = true;
    }
    rows.push([s.pinned ? 'x' : '', statusInstant(s.start), statusInstant(s.end), s.rotation, s.who, s.note]);
  });
  if (!placed) {
    dividerRows.push(rows.length);
    rows.push(['', statusInstant(at), '', 'now', '', '']);
  }
  return { rows: rows, headerRows: [0], dividerRows: dividerRows };
}
