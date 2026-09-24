// Sweep item order at equal start: row types use ROW_TYPES order; script items slot in between.
function sweepOrder(kind, type) {
  if (kind === 'row') return typeOrder(type);
  if (kind === 'snapshot') return typeOrder('snapshot');
  if (kind === 'precredit') return typeOrder('shift') - 0.5;
  return typeOrder('shift');
}

function raiseTo(a, b) {
  if (b === null || b === undefined) return a;
  return a === null ? b : Math.max(a, b);
}

function ledgerRows(rows) {
  return sortRows(rows.filter(function (r) { return r.type !== 'error' && r.type !== 'comment' && r.start !== null; }));
}

// An instant inside a skipped day of a counted grid moves to the next boundary, so S never lands there.
function onCountedDay(timeline, t) {
  var grid = t === null || t === undefined ? null : timeline.gridAt(t);
  return grid ? grid.onCounted(t) : t;
}

// DESIGN 5.2. now may be null to skip the clock-dependent steps. holidays: Set of day indexes.
// globalSetRows: the set rows of #Global.
function advance(rows, now, holidays, globalSetRows) {
  rows = ledgerRows(rows);
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows);
  var S = null;
  if (now !== null && now !== undefined) {
    var grid = timeline.gridAt(now);
    if (grid) S = grid.floor(now);
    var shifts = rowsOfType(rows, 'shift');
    for (var i = shifts.length - 1; i >= 0; i--) {
      if (shifts[i].start > now) continue;
      var shiftGrid = timeline.gridAt(shifts[i].start);
      var next = shifts[i + 1] ? shifts[i + 1].start : null;
      if (shiftGrid && scoredEnd(shifts[i], next, shiftGrid) > now) S = shifts[i].start;
      break;
    }
    S = raiseTo(S, onCountedDay(timeline, timeline.at(now).get('anchor')));
  }
  var roster = firstOfType(rows, ['team', 'join']);
  S = raiseTo(S, roster ? onCountedDay(timeline, roster.start) : null);
  var snapshot = firstOfType(rows, ['snapshot']);
  S = raiseTo(S, snapshot ? snapshot.start : null);
  return S;
}

// Spans of [a, b) not covered by claims (sorted by start).
function uncoveredSpans(a, b, claims) {
  var spans = [];
  var t = a;
  for (var i = 0; i < claims.length && t < b; i++) {
    var cs = claims[i][0], ce = claims[i][1];
    if (ce <= t) continue;
    if (cs > t) spans.push([t, Math.min(cs, b)]);
    t = Math.max(t, ce);
  }
  if (t < b) spans.push([t, b]);
  return spans;
}

// Splits [a, b) at grid boundaries and grid changes into slot entries.
function splitSlots(a, b, timeline, changes, out) {
  var t = a;
  while (t < b) {
    var end = Math.min(timeline.gridAt(t).next(t), b);
    var change = firstAfter(changes, t);
    if (change !== null && change < end) end = change;
    out.push({ start: t, slotEnd: end, end: null, who: null, slot: true, row: null });
    t = end;
  }
}

function errorRow(e) {
  return makeRow({ type: 'error', start: e.start, startText: e.startText || '', what: e.message });
}

// Effective end per member of each exclude row once include rows are applied, to decide clipping at the snapshot.
function resolvedExcludeEnds(rows) {
  var ends = new Map();
  rows.forEach(function (row) {
    if (row.type === 'exclude') {
      var perName = {};
      whatNames(row).forEach(function (n) { perName[n] = row.end; });
      ends.set(row, perName);
    }
    if (row.type !== 'include') return;
    var names = whatNames(row);
    rows.forEach(function (ex) {
      var perName = ends.get(ex);
      if (!perName || ex.start > row.start) return;
      names.forEach(function (n) {
        if (n in perName && (perName[n] === null || perName[n] > row.start)) perName[n] = row.start;
      });
    });
  });
  return ends;
}

// frozen (DESIGN 5, run scope): the rotation is swept as it stands so links see its shifts, but nothing is
// pruned, no slot is filled and the snapshot stays where it is; it is not written. globalSetRows: #Global.
function prepareRotation(input, index, holidays, frozen, globalSetRows) {
  var validated = validateLedger(input.rows, input.name, globalSetRows);
  var rot = { name: input.name, index: index, frozen: frozen, rows: validated.rows, errors: validated.errors.slice(), problems: [], warnings: [] };
  if (rot.errors.length) return rot;
  var rows = rot.rows;
  rows.forEach(function (r) {
    if (r.type === 'comment' && r.start === null && r.startText !== '') {
      rot.warnings.push({ start: null, message: 'comment row ' + r.rowIndex + ': unparseable start, treated as undated' });
    }
  });
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows);
  var previous = firstOfType(rows, ['snapshot']);
  var S = frozen || input.snapshotAt === null || input.snapshotAt === undefined ? advance(rows, null, holidays, globalSetRows) : input.snapshotAt;
  var first = firstOfType(rows, ['set']);
  S = raiseTo(raiseTo(S, previous ? previous.start : null), onCountedDay(timeline, first.start));
  rot.timeline = timeline;
  rot.previousAt = previous ? previous.start : null;
  rot.previousWhat = previous ? previous.what : '';
  rot.S = S;
  rot.kept = rows.filter(function (r) { return r.type !== 'snapshot' && !(!frozen && r.type === 'shift' && !r.pinned && r.start > S); });

  var shifts = rowsOfType(rot.kept, 'shift');
  var changes = timeline.gridChanges();
  var regenStart = S;
  var claims = shifts.map(function (s, i) {
    var end = claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes);
    if (s.start === S) regenStart = Math.max(regenStart, end);
    return [s.start, end];
  });
  var horizonAt = S + timeline.at(S).get('horizon');
  rot.horizonEnd = timeline.gridAt(horizonAt).ceil(horizonAt);

  var entries = shifts.map(function (s) {
    return { start: s.start, slotEnd: null, end: null, who: shiftAssignee(s), slot: false, row: s };
  });
  if (!frozen) {
    uncoveredSpans(regenStart, rot.horizonEnd, claims).forEach(function (span) {
      splitSlots(span[0], span[1], timeline, changes, entries);
    });
  }
  entries.sort(function (a, b) { return a.start - b.start; });
  entries.forEach(function (e, i) {
    e.end = e.slot ? e.slotEnd : scoredEnd(e.row, entries[i + 1] ? entries[i + 1].start : null, timeline.gridAt(e.start));
  });
  rot.entries = entries;
  return rot;
}

function rotationItems(rot) {
  var items = [];
  var P = rot.previousAt;
  var S = rot.S;
  var push = function (start, kind, data) {
    items.push(Object.assign({ start: start, order: sweepOrder(kind, data.row ? data.row.type : null), rot: rot.index, kind: kind }, data));
  };
  var afterPrevious = function (t) { return P === null || t >= P; };
  var excludeEnds = resolvedExcludeEnds(rot.kept);
  rot.roster = new Roster();
  rot.roster.fromSnapshotWhat(rot.previousWhat);
  rot.precredited = new Set();
  rot.kept.forEach(function (row) {
    if (row.type === 'shift' || row.type === 'comment' || row.type === 'set') return;
    if (row.type === 'exclude') {
      var ends = excludeEnds.get(row);
      var names = whatNames(row).filter(function (n) { return clipToSnapshot(row.start, ends[n], P) !== null; });
      var from = P === null ? row.start : Math.max(row.start, P);
      if (names.length) push(from, 'row', { row: row, names: names, from: from, to: row.end, clipped: from !== row.start });
    } else if (afterPrevious(row.start)) {
      push(row.start, 'row', { row: row });
    }
  });
  push(S, 'snapshot', {});
  push(S, 'precredit', {});
  rot.entries.forEach(function (entry) {
    if (entry.slot) { push(entry.start, 'slot', { entry: entry, row: entry.row }); return; }
    if (entry.who === null) return;
    var clip = clipToSnapshot(entry.start, entry.end, P);
    if (!clip) return;
    if (clip[0] < S && S < clip[1]) {
      push(clip[0], 'credit', { entry: entry, row: entry.row, a: clip[0], b: S });
      push(S, 'tail', { entry: entry, a: S, b: clip[1] });
    } else {
      push(clip[0], 'credit', { entry: entry, row: entry.row, a: clip[0], b: clip[1] });
    }
  });
  return items;
}

function mergeItems(rots) {
  var items = [];
  rots.forEach(function (rot) { items = items.concat(rotationItems(rot)); });
  return items.sort(function (a, b) { return (a.start - b.start) || (rots[a.rot].rank - rots[b.rot].rank) || (a.order - b.order); });
}

// Settings at an instant come from the timeline (own and global set rows), so set rows are not sweep items.
function applyStateRow(rot, item) {
  var row = item.row;
  var roster = rot.roster;
  var settings = rot.timeline.at(item.start);
  switch (row.type) {
    case 'team': return roster.team(whatItems(row), settings.get('baseline'));
    case 'join': return roster.join(whatItems(row), settings.get('baseline'));
    case 'leave': return roster.leave(whatNames(row));
    case 'score': return roster.score(whatItems(row));
    case 'exclude': {
      var names = item.clipped ? item.names.filter(function (n) { return roster.has(n); }) : item.names;
      return names.length ? roster.exclude(names, item.from, item.to) : null;
    }
    case 'include': return roster.include(whatNames(row), row.start);
    default: return null;
  }
}

// The window is precredit grid steps after S (DESIGN 5.5).
function precredit(rot, holidays) {
  var settings = rot.timeline.at(rot.S);
  var n = settings.precreditPeriods(rot.roster.size());
  var limit = rot.timeline.gridAt(rot.S).step(rot.S, n);
  var options = settings.unitsOptions(holidays);
  rot.entries.forEach(function (entry) {
    if (entry.slot || !entry.row.pinned || entry.who === null || entry.start <= rot.S || entry.start >= limit) return;
    if (!rot.roster.has(entry.who)) return;
    rot.roster.credit(entry.who, units(entry.start, entry.end, options));
    rot.precredited.add(entry);
  });
}

function hasShiftOverlapping(rot, who, a, b) {
  return rot.entries.some(function (e) { return e.who === who && e.start < b && e.end > a; });
}

function previousAssignee(rot, entry) {
  var previous = null;
  for (var i = 0; i < rot.entries.length && rot.entries[i].start < entry.start; i++) previous = rot.entries[i];
  return previous ? previous.who : null;
}

// DESIGN 5.7 steps 3 and 4. joined links prefer holders of an overlapping shift in a linked rotation.
function tiebreak(rot, entry, candidates, settings) {
  var names = rot.roster.names();
  var chosen = new Set(candidates.map(function (m) { return m.name; }));
  if (settings.get('tiebreak') === 'shuffle') {
    var prefix = settings.get('seed') + '|' + rot.name + '|' + formatDateTime(entry.start) + '|';
    var best = null, bestHash = null;
    names.forEach(function (name) {
      if (!chosen.has(name)) return;
      var h = fnv1a32(prefix + name);
      if (bestHash === null || h < bestHash) { best = name; bestHash = h; }
    });
    return best;
  }
  var from = names.indexOf(previousAssignee(rot, entry)) + 1;
  for (var k = 0; k < names.length; k++) {
    var name = names[(from + k) % names.length];
    if (chosen.has(name)) return name;
  }
  return null;
}

// DESIGN 5.7 and 7. distinct holders are removed before relaxation; joined holders are preferred inside the band.
function assignSlot(rot, entry, holidays, ctx) {
  var settings = rot.timeline.at(entry.start);
  var roster = rot.roster;
  var a = entry.start, b = entry.slotEnd;
  var minDistance = settings.get('min_distance');
  var distinct = linkedHolders(ctx, rot, 'distinct', a, b);
  var members = roster.members.filter(function (m) { return !distinct.has(m.name); });
  var grid = rot.timeline.gridAt(a);
  var eligible = [];
  var used = 0;
  for (var d = minDistance; d >= 0 && !eligible.length; d--) {
    var from = grid.step(a, -d), to = grid.step(b, d);
    used = d;
    eligible = members.filter(function (m) {
      return !roster.isExcluded(m.name, a, b) && !hasShiftOverlapping(rot, m.name, from, to);
    });
  }
  var note = '';
  if (eligible.length) {
    var lowest = Math.min.apply(null, eligible.map(function (m) { return m.score; }));
    var tolerance = settings.get('tolerance');
    var candidates = eligible.filter(function (m) { return m.score <= lowest + tolerance; });
    var joined = linkedHolders(ctx, rot, 'joined', a, b);
    var preferred = candidates.filter(function (m) { return joined.has(m.name); });
    entry.who = tiebreak(rot, entry, preferred.length ? preferred : candidates, settings);
    roster.credit(entry.who, units(a, entry.end, settings.unitsOptions(holidays)));
    if (used < minDistance) {
      note = 'min_distance relaxed to ' + used;
      rot.warnings.push({ start: a, message: note });
    }
  } else {
    var message = 'no eligible member for shift ' + formatDateTime(a) + ' to ' + formatDateTime(b);
    rot.problems.push({ start: a, message: message });
  }
  entry.generated = makeRow({ type: 'shift', start: a, what: entry.who === null ? '' : entry.who, note: note });
}

function sweep(items, rots, holidays, ctx) {
  items.forEach(function (item) {
    var rot = rots[item.rot];
    if (rot.errors.length) return;
    switch (item.kind) {
      case 'row': {
        var message = applyStateRow(rot, item);
        if (message !== null) rot.errors.push(rowError(item.row, message));
        break;
      }
      case 'snapshot':
        rot.snapshotWhat = rot.roster.snapshotWhat();
        rot.scoresAtS = rot.roster.scores();
        break;
      case 'precredit':
        precredit(rot, holidays);
        break;
      case 'credit':
      case 'tail':
        if (!rot.precredited.has(item.entry)) {
          rot.roster.credit(item.entry.who, units(item.a, item.b, rot.timeline.at(item.a).unitsOptions(holidays)));
        }
        break;
      case 'slot':
        assignSlot(rot, item.entry, holidays, ctx);
        break;
    }
  });
}

function collectErrors(rots, list) {
  var out = [];
  rots.forEach(function (rot) {
    rot[list].forEach(function (e) {
      out.push({ rotation: rot.name, rowIndex: e.rowIndex === undefined ? null : e.rowIndex, start: e.start, message: e.message });
    });
  });
  return out;
}

function writable(rots) {
  return rots.filter(function (rot) { return !rot.frozen; });
}

// DESIGN 6: rows unchanged plus an error row above each offending row.
function errorOutput(rots, global, now) {
  var errors = collectErrors(rots, 'errors').concat(global.errors);
  return {
    rotations: writable(rots).map(function (rot) {
      return { name: rot.name, rows: sortRows(rot.errors.map(errorRow).concat(rot.rows)) };
    }),
    global: { rows: global.rows, errors: global.errors },
    errors: errors,
    regenerated: false,
    status: buildStatus([], [], errors, now),
  };
}

// #Global rows parsed against the rotation names: set rows for the timelines, links for the sweep, error rows
// for the tab. A bad set row blocks regeneration (blocking); relation errors never do.
function prepareGlobal(rows, names) {
  var parsed = parseGlobal(rows || [], names);
  var errors = parsed.errors.map(function (e) {
    return { rotation: GLOBAL_TAB, rowIndex: e.rowIndex, start: e.start, message: e.message };
  });
  return { rows: parsed.rows, errors: errors, blocking: parsed.setErrors.length > 0, setRows: parsed.setRows, links: parsed.links };
}

// Sweep order and lookup of the rotations for the link filters.
function linkContext(global, rots) {
  var names = rots.map(function (r) { return r.name; });
  var order = linkedRotationOrder(global.links, names);
  rots.forEach(function (rot) { rot.rank = order.indexOf(rot.name); });
  var byName = {};
  rots.forEach(function (rot) { byName[rot.name] = rot; });
  return { links: global.links, byName: byName };
}

// Script rows go in front of the kept rows so undated comments still attach to the next kept row below them.
function rotationOutput(rot) {
  var rows = [makeRow({ type: 'snapshot', start: rot.S, what: rot.snapshotWhat })];
  rot.entries.forEach(function (e) { if (e.generated) rows.push(e.generated); });
  return { name: rot.name, rows: sortRows(rows.concat(rot.problems.map(errorRow), rot.kept)) };
}

// Pure regeneration of DESIGN 5.3 to 5.8 and 7.
// input: { rotations: [{ name, rows, snapshotAt }], holidays: [dayIndex], global: #Global row objects, now, only }.
// now is optional and only dates the effective settings in the status; the ledgers never depend on it.
// only: optional list of rotation names to regenerate; the others are swept frozen and not returned.
// Output: { rotations: [{ name, rows }], global: { rows, errors }, errors, regenerated, status }.
function regenerate(input) {
  var holidays = new Set(input.holidays || []);
  var only = input.only || null;
  var global = prepareGlobal(input.global, input.rotations.map(function (r) { return r.name; }));
  var rots = input.rotations.map(function (r, i) {
    return prepareRotation(r, i, holidays, only !== null && only.indexOf(r.name) < 0, global.setRows);
  });
  var ctx = linkContext(global, rots);
  var hasErrors = function () { return global.blocking || rots.some(function (rot) { return rot.errors.length > 0; }); };
  if (hasErrors()) return errorOutput(rots, global, input.now);
  sweep(mergeItems(rots), rots, holidays, ctx);
  if (hasErrors()) return errorOutput(rots, global, input.now);
  var warnings = collectErrors(rots, 'warnings').concat(collectErrors(rots, 'problems'));
  return {
    rotations: writable(rots).map(rotationOutput),
    regenerated: true,
    global: { rows: global.rows, errors: global.errors },
    errors: collectErrors(rots, 'problems').concat(global.errors),
    status: buildStatus(rots, warnings, global.errors, input.now),
  };
}
