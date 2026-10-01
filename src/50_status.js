// Status data and the 2D text arrays for the #Status and #All shifts tabs (DESIGN 5.8).

var STATUS_WIDTH = 17;
var STATUS_GAP = 2;
var STATUS_KEYS_WIDTH = 3;
var STATUS_SETTINGS_WIDTH = 3;
var SHIFTS_HEADER = ['start'];
var NOW_MARK = '--now--';
var MEMBER_HEADER = ['member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions'];

function statusInstant(min) {
  return min === null || min === undefined ? '' : formatDateTime(min);
}

function formatSettingValue(key, value) {
  if (value === null || value === undefined) return '';
  if (key === 'anchor') return formatDateTime(value);
  if (key === 'period') return formatDuration(value);
  if (typeof value === 'object') return value.text;
  return String(value);
}

// Every SETTINGS key with its effective value and source (rotation, global, default) at `at`, plus the start
// of the next set row of either layer after `at`.
function effectiveSettings(timeline, at) {
  var values = timeline.at(at).values;
  var sources = timeline.sourcesAt(at);
  var next = null;
  timeline.entries.forEach(function (e) { if (e.start > at && next === null) next = e.start; });
  return {
    at: at,
    values: Object.keys(SETTINGS).map(function (key) {
      return { key: key, value: formatSettingValue(key, values[key]), source: sources[key] };
    }),
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
    previousAt: rot.previousAt,
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

// Every shift of every rotation with its scored extent and the relations it does not meet (7), by start then
// rotation order. who is '' for a nobody shift.
function shiftsView(rots) {
  var out = [];
  rots.forEach(function (rot) {
    rot.entries.forEach(function (e) {
      out.push({ start: e.start, end: e.end, rotation: rot.name, who: e.who === null ? '' : e.who, unmet: e.unmet || [] });
    });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

// Pair states in force at `at`: { reader, target, kind } for every ordered pair, mutual states twice.
function relationsView(rots, relations, at) {
  var out = [];
  if (!relations || at === null) return out;
  var names = rots.map(function (r) { return r.name; });
  names.forEach(function (reader) {
    names.forEach(function (target) {
      if (reader === target) return;
      var kind = relations.kindFor(reader, target, at);
      if (kind !== null) out.push({ reader: reader, target: target, kind: kind });
    });
  });
  return out;
}

// rots: swept rotations, or [] when a validation error stopped the run. now: optional run instant.
// relations: the Relations of the sweep, or null.
function buildStatus(rots, warnings, errors, now, relations) {
  var at = now === null || now === undefined ? null : now;
  return {
    at: at,
    rotations: rots.map(function (rot) { return rotationStatus(rot, now); }),
    relations: relationsView(rots, relations, at),
    warnings: warnings,
    errors: errors,
    shifts: shiftsView(rots),
  };
}

function padCells(cells, width) {
  return cells.concat(new Array(Math.max(0, width - cells.length)).fill(''));
}

function padStatusRow(cells) {
  return padCells(cells, STATUS_WIDTH);
}

function formatExclusions(list) {
  return list.map(function (ex) {
    return statusInstant(ex.from) + ' to ' + (ex.to === null ? 'open' : statusInstant(ex.to));
  }).join('; ');
}

// Column groups side by side: each padded to its width and to the tallest group, STATUS_GAP empty columns between.
function sideBySide(groups) {
  var height = Math.max.apply(null, groups.map(function (g) { return g.rows.length; }));
  var out = [];
  for (var i = 0; i < height; i++) {
    var row = [];
    groups.forEach(function (g, k) {
      if (k > 0) row = row.concat(new Array(STATUS_GAP).fill(''));
      row = row.concat(padCells(g.rows[i] || [], g.width));
    });
    out.push(row);
  }
  return out;
}

// One rotation as three groups of rows: key/value rows, member table, settings table (DESIGN 5.8).
function rotationGroups(rot) {
  var keys = [
    ['rotation', rot.name],
    ['snapshot', statusInstant(rot.snapshotAt)],
    ['horizon', statusInstant(rot.horizonEnd)],
    ['current', rot.current ? rot.current.who : '', rot.current ? 'until ' + statusInstant(rot.current.end) : ''],
    ['next', rot.next ? rot.next.who : '', rot.next ? 'from ' + statusInstant(rot.next.start) : ''],
  ];
  var members = [MEMBER_HEADER.slice()].concat(rot.roster.map(function (m) {
    return [m.name, rot.current && rot.current.who === m.name ? 'x' : '',
      m.score === null ? '' : formatScore(m.score), formatScore(m.projected),
      statusInstant(m.lastShift), statusInstant(m.nextShift), formatExclusions(m.exclusions)];
  }));
  var settings = [['settings', 'as of ' + statusInstant(rot.settings.at), 'source']].concat(
    rot.settings.values.map(function (s) { return [s.key, s.value, s.source]; }));
  if (rot.settings.nextSetAt !== null) settings.push(['note', 'a set row at ' + statusInstant(rot.settings.nextSetAt) + ' changes these values']);
  return { keys: keys, members: members, settings: settings };
}

// Spreadsheet arrangement: the three groups side by side, first row is the header of all three.
function horizontalBlock(rot) {
  var g = rotationGroups(rot);
  var rows = sideBySide([
    { rows: g.keys, width: STATUS_KEYS_WIDTH },
    { rows: g.members, width: MEMBER_HEADER.length },
    { rows: g.settings, width: STATUS_SETTINGS_WIDTH },
  ]);
  return { rows: rows, headers: [0] };
}

// CLI arrangement: the groups one after another, tables indented by one cell, each group's first row a header.
function verticalBlock(rot) {
  var g = rotationGroups(rot);
  var indent = function (row) { return [''].concat(row); };
  var rows = g.keys.concat([[]], g.members.map(indent), [[]], g.settings.map(indent));
  return { rows: rows, headers: [0, g.keys.length + 1, g.keys.length + g.members.length + 2] };
}

// Relations matrix rows: header with every rotation, then per reader a row with + (attract), +! (attract!),
// - (repel) or -! (repel!).
function relationsMatrix(status) {
  var names = status.rotations.map(function (r) { return r.name; });
  var marks = { attract: '+', 'attract!': '+!', repel: '-', 'repel!': '-!' };
  var rows = [['Relations'].concat(names)];
  names.forEach(function (reader) {
    rows.push([reader].concat(names.map(function (target) {
      var rel = status.relations.find(function (r) { return r.reader === reader && r.target === target; });
      return rel ? marks[rel.kind] || '' : '';
    })));
  });
  return rows;
}

// Rows of the #Status tab plus presentation metadata: headerRows, dividerRows, errorRows and warningRows are
// row indexes for the adapter to format (the errors and warnings tables and the same rows of extension
// blocks). status.now, status.mode and status.tabs are set by the runner. block: horizontalBlock
// for the spreadsheet, verticalBlock for the CLI. Extension blocks (<prefix>_status(status) returning
// { rows, headerRows }) follow the frame, each after a blank row, their rows cut to STATUS_WIDTH; a hook that
// throws adds an entry to the errors block instead.
function statusRowsWith(status, block) {
  var rows = [];
  var headerRows = [];
  var errorRows = [];
  var warningRows = [];
  var push = function (cells) { rows.push(padStatusRow(cells.slice(0, STATUS_WIDTH))); };
  var header = function (cells) { headerRows.push(rows.length); push(cells); };
  var marked = function (cells, list) { list.push(rows.length); push(cells); };
  var errors = status.errors.slice();
  var blocks = [];
  callExtensionHooks('status', [status], function (h, e) { errors.push(extensionError(h, e)); }).forEach(function (r) {
    if (r.value && Array.isArray(r.value.rows) && r.value.rows.length) blocks.push(r.value);
  });
  header(['Rotalator', status.mode || '', status.now || '']);
  if (status.tabs) {
    push([]);
    header(['Tabs']);
    push(['rotations', status.tabs.rotations.join(', ')]);
    push(['regenerated', status.tabs.regenerated.join(', ')]);
    push(['holidays', String(status.tabs.holidays)]);
    push(['global', String(status.tabs.global)]);
    push(['ignored', status.tabs.ignored.join(', ')]);
  }
  if (status.rotations.length > 1 && (status.relations || []).length) {
    push([]);
    relationsMatrix(status).forEach(function (row, i) { if (i === 0) header(row); else push(row); });
  }
  status.rotations.forEach(function (rot) {
    push([]);
    var b = block(rot);
    b.rows.forEach(function (row, i) { if (b.headers.indexOf(i) >= 0) header(row); else push(row); });
  });
  if (status.warnings.length) {
    push([]);
    header(['warnings']);
    header(['rotation', 'start', 'message']);
    status.warnings.forEach(function (w) { marked([w.rotation, statusInstant(w.start), w.message], warningRows); });
  }
  if (errors.length) {
    push([]);
    header(['errors']);
    header(['rotation', 'where', 'message']);
    errors.forEach(function (e) {
      var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex : statusInstant(e.start);
      marked([e.rotation, where, e.message], errorRows);
    });
  }
  blocks.forEach(function (table) {
    push([]);
    table.rows.forEach(function (row, i) {
      var at = rows.length;
      if ((table.headerRows || [0]).indexOf(i) >= 0) header(row); else push(row);
      if ((table.errorRows || []).indexOf(i) >= 0) errorRows.push(at);
      if ((table.warningRows || []).indexOf(i) >= 0) warningRows.push(at);
    });
  });
  return { rows: rows, headerRows: headerRows, dividerRows: [], errorRows: errorRows, warningRows: warningRows };
}

function statusRows(status) {
  return statusRowsWith(status, horizontalBlock);
}

function statusRowsVertical(status) {
  return statusRowsWith(status, verticalBlock);
}

// The #All shifts grid (DESIGN 5.8) from status.shifts, which arrive sorted by start. errorCells cover the
// red shifts (7) and the empty continuation cells below each in its column while the row's start lies inside
// the shift's scored interval; the now row is skipped and painting continues past it.
function shiftsRows(status) {
  var names = status.rotations.map(function (r) { return r.name; });
  var rows = [SHIFTS_HEADER.concat(names)];
  var dividerRows = [];
  var currentCells = [];
  var errorCells = [];
  var unmet = new Map();
  var active = {};
  var at = status.at;
  var known = at !== null && at !== undefined;
  var current = {};
  if (known) status.rotations.forEach(function (r) { if (r.current) current[r.name] = r.current.start; });
  var starts = [];
  var byStart = new Map();
  status.shifts.forEach(function (s) {
    if (!byStart.has(s.start)) { byStart.set(s.start, {}); starts.push(s.start); }
    byStart.get(s.start)[s.rotation] = s.who === '' ? '-' : s.who;
    if (s.unmet && s.unmet.length) unmet.set(s.start + '|' + s.rotation, { end: s.end, note: s.unmet.map(function (u) { return u.relation + ' with ' + u.rotation; }).join('; ') });
  });
  var nowRow = [statusInstant(at)].concat(names.map(function () { return NOW_MARK; }));
  var placed = !known;
  starts.forEach(function (start) {
    if (!placed && start > at) { dividerRows.push(rows.length); rows.push(nowRow); placed = true; }
    var cells = byStart.get(start);
    names.forEach(function (n, i) {
      if (current[n] === start) currentCells.push({ row: rows.length, col: i + 1 });
      if (cells[n]) {
        active[n] = unmet.get(start + '|' + n) || null;
        if (active[n]) errorCells.push({ row: rows.length, col: i + 1, note: active[n].note });
      } else if (active[n] && start < active[n].end) {
        errorCells.push({ row: rows.length, col: i + 1, note: active[n].note });
      }
    });
    rows.push([statusInstant(start)].concat(names.map(function (n) { return cells[n] || ''; })));
  });
  if (!placed) { dividerRows.push(rows.length); rows.push(nowRow); }
  return { rows: rows, headerRows: [0], dividerRows: dividerRows, currentCells: currentCells, errorCells: errorCells };
}
