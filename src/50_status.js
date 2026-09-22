// Status data and the 2D text arrays for the Status and Shifts tabs (DESIGN 5.8).

var STATUS_WIDTH = 6;
var SHIFTS_HEADER = ['start', 'end', 'rotation', 'who', 'pinned', 'note'];

function statusInstant(min) {
  return min === null || min === undefined ? '' : formatDateTime(min);
}

// rot: swept rotation internals from 40_scheduler.js (roster, scoresAtS, entries, S, horizonEnd).
function rotationStatus(rot) {
  var projected = rot.roster.scores();
  var S = rot.S;
  return {
    name: rot.name,
    snapshotAt: S,
    horizonEnd: rot.horizonEnd,
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

// rots: swept rotations, or [] when a validation error stopped the run.
function buildStatus(rots, warnings, errors) {
  return {
    rotations: rots.map(rotationStatus),
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

// Rows of the Status tab. status.now and status.mode are set by the runner.
function statusRows(status) {
  var rows = [];
  var push = function (cells) { rows.push(padStatusRow(cells)); };
  push(['Rotalator', status.mode || '', status.now || '']);
  status.rotations.forEach(function (rot) {
    push([]);
    push(['rotation', rot.name, 'snapshot', statusInstant(rot.snapshotAt), 'horizon', statusInstant(rot.horizonEnd)]);
    push(['member', 'score', 'projected', 'last shift', 'next shift', 'exclusions']);
    rot.roster.forEach(function (m) {
      push([m.name, m.score === null ? '' : formatScore(m.score), formatScore(m.projected),
        statusInstant(m.lastShift), statusInstant(m.nextShift), formatExclusions(m.exclusions)]);
    });
  });
  push([]);
  push(['warnings']);
  push(['rotation', 'start', 'message']);
  status.warnings.forEach(function (w) { push([w.rotation, statusInstant(w.start), w.message]); });
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

// Rows of the Shifts tab, header included.
function shiftsRows(shifts) {
  return [SHIFTS_HEADER.slice()].concat(shifts.map(function (s) {
    return [statusInstant(s.start), statusInstant(s.end), s.rotation, s.who, s.pinned ? 'yes' : '', s.note];
  }));
}
