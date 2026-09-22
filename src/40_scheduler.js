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
  return sortRows(rows.filter(function (r) { return r.type !== 'error' && r.start !== null; }));
}

function rowsOfType(rows, type) {
  return rows.filter(function (r) { return r.type === type; });
}

function firstOfType(rows, types) {
  for (var i = 0; i < rows.length; i++) if (types.indexOf(rows[i].type) >= 0) return rows[i];
  return null;
}

// DESIGN 5.2. now may be null to skip the clock-dependent steps.
function advance(rows, now) {
  rows = ledgerRows(rows);
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'));
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
    S = raiseTo(S, timeline.at(now).get('anchor'));
  }
  var roster = firstOfType(rows, ['team', 'join']);
  S = raiseTo(S, roster ? roster.start : null);
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
  return makeRow({ type: 'error', start: e.start, startText: e.startText || '', arg: e.message });
}

// Effective end of each exclude row once include rows are applied, used to decide clipping at the snapshot.
function resolvedExcludeEnds(rows) {
  var ends = new Map();
  rows.forEach(function (row) {
    if (row.type === 'exclude') ends.set(row, row.end);
    if (row.type !== 'include') return;
    rows.forEach(function (ex) {
      if (ex.type !== 'exclude' || ex.who !== row.who || ex.start > row.start) return;
      var end = ends.get(ex);
      if (end === null || end > row.start) ends.set(ex, row.start);
    });
  });
  return ends;
}

function prepareRotation(input, index) {
  var validated = validateLedger(input.rows, input.name);
  var rot = { name: input.name, index: index, rows: validated.rows, errors: validated.errors.slice(), problems: [], warnings: [] };
  if (rot.errors.length) return rot;
  var rows = rot.rows;
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'));
  var previous = firstOfType(rows, ['snapshot']);
  var S = input.snapshotAt === null || input.snapshotAt === undefined ? advance(rows, null) : input.snapshotAt;
  S = raiseTo(raiseTo(S, previous ? previous.start : null), rows[0].start);
  rot.timeline = timeline;
  rot.previousAt = previous ? previous.start : null;
  rot.previousArg = previous ? previous.arg : '';
  rot.S = S;
  rot.kept = rows.filter(function (r) { return r.type !== 'snapshot' && !(r.type === 'shift' && !r.pinned && r.start > S); });

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
    return { start: s.start, slotEnd: null, end: null, who: isNobody(s.who) ? null : s.who, slot: false, row: s };
  });
  uncoveredSpans(regenStart, rot.horizonEnd, claims).forEach(function (span) {
    splitSlots(span[0], span[1], timeline, changes, entries);
  });
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
  rot.settings = new Settings();
  rot.roster = new Roster();
  rot.roster.fromSnapshotArg(rot.previousArg);
  rot.precredited = new Set();
  rot.kept.forEach(function (row) {
    if (row.type === 'shift') return;
    if (row.type === 'set') {
      if (afterPrevious(row.start)) push(row.start, 'row', { row: row });
      else rot.settings.apply(row);
    } else if (row.type === 'exclude') {
      var clip = clipToSnapshot(row.start, excludeEnds.get(row), P);
      if (clip) push(clip[0], 'row', { row: row, from: clip[0], to: row.end, clipped: clip[0] !== row.start });
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

function applyStateRow(rot, item) {
  var row = item.row;
  var roster = rot.roster;
  switch (row.type) {
    case 'set': rot.settings.apply(row); return null;
    case 'team': return roster.team(parseAssignments(row.arg), rot.settings.get('baseline'));
    case 'join': return roster.join(row.who, row.arg === '' ? rot.settings.get('baseline') : parseBaseline(row.arg));
    case 'leave': return roster.leave(row.who);
    case 'score': return roster.score(parseAssignments(row.arg));
    case 'exclude':
      if (item.clipped && !roster.has(row.who)) return null;
      return roster.exclude(row.who, item.from, item.to);
    case 'include': return roster.include(row.who, row.start);
    default: return null;
  }
}

function precredit(rot, holidays) {
  var n = rot.settings.precreditPeriods(rot.roster.size());
  var limit = rot.S + n * rot.settings.get('period');
  var options = rot.settings.unitsOptions(holidays);
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
function tiebreak(rot, entry, candidates) {
  var names = rot.roster.names();
  var chosen = new Set(candidates.map(function (m) { return m.name; }));
  if (rot.settings.get('tiebreak') === 'shuffle') {
    var prefix = rot.settings.get('seed') + '|' + rot.name + '|' + formatDateTime(entry.start) + '|';
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
  var settings = rot.settings;
  var roster = rot.roster;
  var a = entry.start, b = entry.slotEnd;
  var minDistance = settings.get('min_distance');
  var distinct = linkedHolders(ctx, rot, 'distinct', a, b);
  var members = roster.members.filter(function (m) { return !distinct.has(m.name); });
  var eligible = [];
  var used = 0;
  for (var d = minDistance; d >= 0 && !eligible.length; d--) {
    var D = d * settings.get('period');
    used = d;
    eligible = members.filter(function (m) {
      return !roster.isExcluded(m.name, a, b) && !hasShiftOverlapping(rot, m.name, a - D, b + D);
    });
  }
  var note = '';
  if (eligible.length) {
    var lowest = Math.min.apply(null, eligible.map(function (m) { return m.score; }));
    var tolerance = settings.get('tolerance');
    var candidates = eligible.filter(function (m) { return m.score <= lowest + tolerance; });
    var joined = linkedHolders(ctx, rot, 'joined', a, b);
    var preferred = candidates.filter(function (m) { return joined.has(m.name); });
    entry.who = tiebreak(rot, entry, preferred.length ? preferred : candidates);
    roster.credit(entry.who, units(a, entry.end, settings.unitsOptions(holidays)));
    if (used < minDistance) {
      note = 'min_distance relaxed to ' + used;
      rot.warnings.push({ start: a, message: note });
    }
  } else {
    var message = 'no eligible member for shift ' + formatDateTime(a) + ' to ' + formatDateTime(b);
    rot.problems.push({ start: a, message: message });
  }
  entry.generated = makeRow({ type: 'shift', start: a, who: entry.who === null ? '' : entry.who, note: note });
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
        rot.snapshotArg = rot.roster.snapshotArg();
        rot.scoresAtS = rot.roster.scores();
        break;
      case 'precredit':
        precredit(rot, holidays);
        break;
      case 'credit':
      case 'tail':
        if (!rot.precredited.has(item.entry)) {
          rot.roster.credit(item.entry.who, units(item.a, item.b, rot.settings.unitsOptions(holidays)));
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

// DESIGN 6: rows unchanged plus an error row above each offending row.
function errorOutput(rots, links) {
  var errors = collectErrors(rots, 'errors').concat(links.errors);
  return {
    rotations: rots.map(function (rot) {
      return { name: rot.name, rows: sortRows(rot.rows.concat(rot.errors.map(errorRow))) };
    }),
    links: { rows: links.rows, errors: links.errors },
    errors: errors,
    status: buildStatus([], [], errors),
  };
}

// Links rows and errors in the regenerate output shape; link errors never block regeneration.
function prepareLinks(rows, rots) {
  var names = rots.map(function (r) { return r.name; });
  var parsed = parseLinks(rows || [], names);
  var order = linkedRotationOrder(parsed.links, names);
  rots.forEach(function (rot) { rot.rank = order.indexOf(rot.name); });
  var errors = parsed.errors.map(function (e) {
    return { rotation: LINKS_NAME, rowIndex: e.rowIndex, start: e.start, message: e.message };
  });
  var byName = {};
  rots.forEach(function (rot) { byName[rot.name] = rot; });
  return { rows: parsed.rows, errors: errors, links: parsed.links, byName: byName };
}

function rotationOutput(rot) {
  var rows = rot.kept.concat([makeRow({ type: 'snapshot', start: rot.S, arg: rot.snapshotArg })]);
  rot.entries.forEach(function (e) { if (e.generated) rows.push(e.generated); });
  return { name: rot.name, rows: sortRows(rows.concat(rot.problems.map(errorRow))) };
}

// Pure regeneration of DESIGN 5.3 to 5.8 and 7.
// input: { rotations: [{ name, rows, snapshotAt }], holidays: [dayIndex], links: Links row objects }.
// Output: { rotations: [{ name, rows }], links: { rows, errors }, errors, status }.
function regenerate(input) {
  var holidays = new Set(input.holidays || []);
  var rots = input.rotations.map(prepareRotation);
  var links = prepareLinks(input.links, rots);
  var hasErrors = function () { return rots.some(function (rot) { return rot.errors.length > 0; }); };
  if (hasErrors()) return errorOutput(rots, links);
  sweep(mergeItems(rots), rots, holidays, links);
  if (hasErrors()) return errorOutput(rots, links);
  var warnings = collectErrors(rots, 'warnings').concat(collectErrors(rots, 'problems'));
  return {
    rotations: rots.map(rotationOutput),
    links: { rows: links.rows, errors: links.errors },
    errors: collectErrors(rots, 'problems').concat(links.errors),
    status: buildStatus(rots, warnings, links.errors),
  };
}
