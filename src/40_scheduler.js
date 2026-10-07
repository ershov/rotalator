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

// Start of the earliest shift row, the anchor of the grid before the first explicit one (DESIGN 3.5); null
// without a dated shift. Rows need not be sorted.
function impliedAnchor(rows) {
  return rows.reduce(function (min, r) {
    if (r.type !== 'shift' || r.start === null || !isFinite(r.start)) return min;
    return min === null || r.start < min ? r.start : min;
  }, null);
}

// An instant inside a skipped day of a counted grid moves to the next boundary, so S never lands there.
function onCountedDay(timeline, t) {
  var grid = t === null || t === undefined || !isFinite(t) ? null : timeline.gridAt(t);
  return grid ? grid.onCounted(t) : t;
}

// DESIGN 5.2. now may be null to skip the clock-dependent steps. holidays: Set of day indexes.
// globalSetRows: the set rows of #Global.
function advance(rows, now, holidays, globalSetRows) {
  rows = ledgerRows(rows);
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows, impliedAnchor(rows));
  var snapshot = firstOfType(rows, ['snapshot']);
  resolveDurations(rows, timeline, rosterSizeAt(rows));
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

// Roster members over time from the team/join/leave rows, replayed from the top: a function of t returning
// the member names at t. Row errors are left to the sweep.
function rosterNamesAt(rows) {
  var roster = new Roster();
  var initial = roster.names();
  var points = [];
  rows.forEach(function (row) {
    if (row.start === null) return;
    if (row.type === 'team') roster.team(whatItems(row));
    else if (row.type === 'join') roster.join(whatItems(row));
    else if (row.type === 'leave') roster.leave(whatNames(row));
    else return;
    points.push({ t: row.start, names: roster.names() });
  });
  return function (t) {
    var names = initial;
    points.forEach(function (p) { if (p.t <= t) names = p.names; });
    return names;
  };
}

// Roster size over time, for ts intervals that must be resolved before the sweep.
function rosterSizeAt(rows) {
  var namesAt = rosterNamesAt(rows);
  return function (t) { return namesAt(t).length; };
}

// sl/ts durations become an end on the grid effective at the row's start (DESIGN 3.3).
function resolveDurations(rows, timeline, sizeAt) {
  rows.forEach(function (row) {
    var interval = row.durationInterval;
    if (row.end !== null || row.start === null || !interval || interval.unit === 'clock') return;
    var grid = timeline.gridAt(row.start);
    if (grid) row.end = grid.offset(row.start, resolveInterval(interval, grid, sizeAt(row.start)));
  });
}

// frozen (DESIGN 5, run scope): the rotation is swept as it stands so relations see its shifts, but nothing is
// pruned, no slot is filled and the snapshot stays where it is; it is not written. globalSetRows: #Global.
// The script's domain (DESIGN 5.3, 5.4) is everything after the stored snapshot P: unpinned shifts there are
// pruned and every uncovered span from P (or, without a snapshot, from the first boundary at or after the first
// roster row) up to horizonEnd is filled, past spans included. An unpinned shift with nobody is never kept, so
// an unassignable slot at P re-emits its error row and a run stays idempotent. Without a snapshot (first run)
// unpinned shifts before now (before S when now is unknown) are hand-typed history and are kept; autopin then
// pins them and P protects them from the next run on. Replay itself always starts at the top of the ledger:
// the snapshot row is informational (DESIGN 3.4), its scores are recomputed, never read back.
function prepareRotation(input, index, holidays, frozen, globalSetRows, now) {
  var validated = validateLedger(input.rows, input.name);
  var rot = { name: input.name, index: index, frozen: frozen, rows: validated.rows, errors: validated.errors.slice(), problems: [], warnings: [] };
  if (rot.errors.length) return rot;
  var rows = rot.rows;
  rows.forEach(function (r) {
    if (r.type === 'comment' && r.start === null && r.startText !== '') {
      rot.warnings.push({ start: null, message: 'comment row ' + r.rowIndex + ': unparseable start, treated as undated' });
    }
  });
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows, impliedAnchor(rows));
  var previous = firstOfType(rows, ['snapshot']);
  var S = frozen || input.snapshotAt === null || input.snapshotAt === undefined ? advance(rows, null, holidays, globalSetRows) : input.snapshotAt;
  // The schedule starts where the grid takes effect (DESIGN 5.1): a period from any set row of either layer
  // and an anchor, explicit or implied by the first shift. Without a period the run stops; without any anchor
  // the rotation is skipped with a warning and left as it is. Rows before that instant use the grid extended
  // backwards.
  var gridAt = timeline.gridStart();
  if (gridAt === null) {
    if (!timeline.hasPeriod()) {
      rot.errors.push({ rowIndex: null, start: null, startText: '', message: input.name + ': no period in force; add period to a set row here or in ' + GLOBAL_TAB });
      return rot;
    }
    rot.warnings.push({ start: null, message: 'no anchor; add a dated set anchor row here or in ' + GLOBAL_TAB + ', or a first shift' });
    return skipRotation(rot, timeline);
  }
  S = raiseTo(raiseTo(S, previous ? previous.start : null), onCountedDay(timeline, gridAt));
  rot.timeline = timeline;
  rot.previousAt = previous ? previous.start : null;
  rot.S = S;
  rot.namesAt = rosterNamesAt(rows);
  rot.sizeAt = function (t) { return rot.namesAt(t).length; };
  resolveDurations(rows, timeline, rot.sizeAt);
  var P = rot.previousAt;
  var historyEnd = now === null || now === undefined ? S : now;
  rot.kept = rows.filter(function (r) {
    if (r.type === 'snapshot') return false;
    if (frozen || r.type !== 'shift' || r.pinned) return true;
    var assigned = shiftAssignee(r) !== null;
    if (P === null) return assigned && r.start < historyEnd;
    return r.start < P || (r.start === P && assigned);
  });

  var shifts = rowsOfType(rot.kept, 'shift');
  var changes = timeline.gridChanges();
  var claims = shifts.map(function (s, i) {
    return [s.start, claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes)];
  });
  var gridS = timeline.gridAt(S);
  var horizonAt = gridS.offset(S, resolveInterval(timeline.at(S).get('horizon'), gridS, rot.sizeAt(S)));
  rot.horizonEnd = timeline.gridAt(horizonAt).ceil(horizonAt);
  var roster = firstOfType(rows, ['team', 'join']);
  // Never before the grid start: rows may precede the anchor, slots may not.
  var fillStart = P !== null ? Math.max(P, gridAt)
    : roster && isFinite(roster.start) ? Math.max(timeline.gridAt(roster.start).ceil(roster.start), gridAt) : gridAt;
  rot.fillStart = fillStart;

  var entries = shifts.map(function (s) {
    return { start: s.start, slotEnd: null, end: null, who: shiftAssignee(s), slot: false, row: s };
  });
  if (!frozen) {
    uncoveredSpans(fillStart, rot.horizonEnd, claims).forEach(function (span) {
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

// A skipped rotation takes no part in the sweep and has no shifts for relations to see; it is neither written
// nor shown in the status blocks (DESIGN 5.1).
function skipRotation(rot, timeline) {
  rot.skipped = true;
  rot.timeline = timeline;
  rot.kept = [];
  rot.entries = [];
  rot.roster = new Roster();
  rot.namesAt = function () { return []; };
  return rot;
}

// Sweep items of a rotation, from the top of the ledger: state rows, the snapshot and precredit at S, a
// credit per decided shift (split at S so the snapshot scores cover the part before it) and a slot per gap.
function rotationItems(rot) {
  var items = [];
  var S = rot.S;
  var push = function (start, kind, data) {
    items.push(Object.assign({ start: start, order: sweepOrder(kind, data.row ? data.row.type : null), rot: rot.index, kind: kind }, data));
  };
  rot.roster = new Roster();
  rot.precredited = new Set();
  rot.kept.forEach(function (row) {
    if (row.type === 'shift' || row.type === 'comment' || row.type === 'set' || isRelationRow(row)) return;
    push(row.start, 'row', { row: row });
  });
  push(S, 'snapshot', {});
  push(S, 'precredit', {});
  rot.entries.forEach(function (entry) {
    if (entry.slot) { push(entry.start, 'slot', { entry: entry, row: entry.row }); return; }
    if (entry.who === null) return;
    if (entry.start < S && S < entry.end) {
      push(entry.start, 'credit', { entry: entry, row: entry.row, a: entry.start, b: S });
      push(S, 'tail', { entry: entry, a: S, b: entry.end });
    } else {
      push(entry.start, 'credit', { entry: entry, row: entry.row, a: entry.start, b: entry.end });
    }
  });
  return items;
}

function mergeItems(rots) {
  var items = [];
  rots.forEach(function (rot) { if (!rot.skipped) items = items.concat(rotationItems(rot)); });
  return items.sort(function (a, b) {
    return (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || (rots[a.rot].rank - rots[b.rot].rank) || (a.order - b.order);
  });
}

// Settings at an instant come from the timeline (own and global set rows), so set rows are not sweep items.
function applyStateRow(rot, item) {
  var row = item.row;
  var roster = rot.roster;
  switch (row.type) {
    case 'team': return roster.team(whatItems(row));
    case 'join': return roster.join(whatItems(row));
    case 'leave': return roster.leave(whatNames(row));
    case 'score': return roster.score(whatItems(row));
    case 'exclude': return roster.exclude(whatNames(row), row.start, row.end);
    case 'include': return roster.include(whatNames(row), row.start);
    default: return null;
  }
}

// The window is the precredit interval after S on the grid's timeline (DESIGN 5.5).
function precredit(rot, holidays) {
  var settings = rot.timeline.at(rot.S);
  var grid = rot.timeline.gridAt(rot.S);
  var limit = grid.offset(rot.S, resolveInterval(settings.get('precredit'), grid, rot.roster.size()));
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

// DESIGN 5.7 steps 3 and 4.
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

// Tolerance in score units at slot start a: a plain number as is; sl the units a regular shift earns there
// honouring skips, ts that times the roster size, clock units nominal days (DESIGN 3.5).
function toleranceUnits(tolerance, grid, a, rosterSize, options) {
  if (typeof tolerance === 'number') return tolerance;
  if (tolerance.unit === 'clock') return tolerance.minutes / MINUTES_PER_DAY;
  var shift = units(a, grid.offset(a, grid.period), options);
  return tolerance.amount * shift * (tolerance.unit === 'ts' ? rosterSize : 1);
}

// min_distance relaxation ladder: the full distance, then one period less each time, then 0 (DESIGN 5.7).
function distanceLadder(distance, period) {
  var ladder = [];
  for (var d = distance; d > 0; d -= period) ladder.push(d);
  ladder.push(0);
  return ladder;
}

// DESIGN 5.7 and 7. Exclusions are never violated. Relaxation order: the repel! cross window shrinks one
// period per step to zero (plain repel) with min_distance in force, then min_distance steps down, then repel
// is dropped (warning), then nobody. attract and attract! holders are preferred inside the band; with no
// preferred candidate in band, the band widens to the lowest eligible attract! holder within one team round
// (lowest + tolerance + 1ts) and the pick proceeds inside it.
function assignSlot(rot, entry, holidays, ctx) {
  var settings = rot.timeline.at(entry.start);
  var roster = rot.roster;
  var a = entry.start, b = entry.slotEnd;
  var grid = rot.timeline.gridAt(a);
  var options = settings.unitsOptions(holidays);
  var minDistance = resolveInterval(settings.get('min_distance'), grid, roster.size());
  var ladder = distanceLadder(minDistance, grid.period);
  var partners = strongPartners(ctx, rot, a, b, minDistance);
  var cross = partners.reduce(function (max, p) { return Math.max(max, p.distance); }, 0);
  var windowed = repelledHolders(ctx, rot, a, b, grid, partners, 0);
  var repelled = repelledHolders(ctx, rot, a, b, grid, partners, cross);
  var members = roster.members.filter(function (m) { return !roster.isExcluded(m.name, a, b); });
  var pick = null;
  var attempt = function (pool, d, found) {
    if (pick) return;
    var from = grid.offset(a, -d), to = grid.offset(b, d);
    var eligible = pool.filter(function (m) { return !hasShiftOverlapping(rot, m.name, from, to); });
    if (eligible.length) pick = Object.assign({ eligible: eligible, distance: d }, found);
  };
  distanceLadder(cross, grid.period).forEach(function (remaining) {
    var pool = members.filter(function (m) { return !repelledHolders(ctx, rot, a, b, grid, partners, cross - remaining).has(m.name); });
    attempt(pool, minDistance, { cross: remaining, repelDropped: false });
  });
  var unrepelled = members.filter(function (m) { return !repelled.has(m.name); });
  ladder.slice(1).forEach(function (d) { attempt(unrepelled, d, { cross: 0, repelDropped: false }); });
  // Dropping repel only adds repelled members back, so a pick made here is always a repelled one.
  if (repelled.size) ladder.forEach(function (d) { attempt(members, d, { cross: 0, repelDropped: true }); });
  var warnings = [];
  if (pick) {
    var lowest = Math.min.apply(null, pick.eligible.map(function (m) { return m.score; }));
    var tolerance = toleranceUnits(settings.get('tolerance'), grid, a, roster.size(), options);
    var candidates = pick.eligible.filter(function (m) { return m.score <= lowest + tolerance; });
    var attracted = relatedHolders(ctx, rot, 'attract', a, b);
    var strong = relatedHolders(ctx, rot, 'attract!', a, b);
    strong.forEach(function (names, who) { attracted.set(who, (attracted.get(who) || []).concat(names)); });
    var preferred = candidates.filter(function (m) { return attracted.has(m.name); });
    var widened = null;
    if (!preferred.length && strong.size) {
      var cap = lowest + tolerance + toleranceUnits({ unit: 'ts', amount: 1 }, grid, a, roster.size(), options);
      var holders = pick.eligible.filter(function (m) { return strong.has(m.name) && m.score <= cap; });
      if (holders.length) {
        var holder = holders.reduce(function (low, m) { return m.score < low.score ? m : low; }, holders[0]);
        widened = { score: holder.score, partners: strong.get(holder.name) };
        candidates = pick.eligible.filter(function (m) { return m.score <= widened.score; });
        preferred = candidates.filter(function (m) { return attracted.has(m.name); });
      }
    }
    entry.who = tiebreak(rot, entry, preferred.length ? preferred : candidates, settings);
    roster.credit(entry.who, units(a, entry.end, options));
    var inShifts = function (d) { return d === 0 ? '0' : formatScore(d / grid.period) + 'sl'; };
    if (widened !== null) {
      var shiftUnits = units(a, grid.offset(a, grid.period), options);
      var width = shiftUnits > 0 ? (widened.score - lowest) / shiftUnits : 0;
      warnings.push('tolerance widened to ' + formatScore(width) + 'sl for attract! with ' + widened.partners.join(', '));
    }
    if (pick.cross < cross && windowed.has(entry.who)) warnings.push('repel! relaxed to ' + inShifts(pick.cross));
    if (pick.distance < minDistance) warnings.push('min_distance relaxed to ' + inShifts(pick.distance));
    if (pick.repelDropped) warnings.push('repel relaxed: ' + entry.who + ' also on ' + (repelled.get(entry.who) || []).join(', '));
    warnings.forEach(function (n) { rot.warnings.push({ start: a, message: n }); });
  } else {
    rot.problems.push({ start: a, message: 'no eligible member for shift ' + formatDateTime(a) + ' to ' + formatDateTime(b) });
  }
  // The note cell is the user's: relaxations are reported in #Status only (DESIGN 6).
  entry.generated = makeRow({ type: 'shift', start: a, what: entry.who === null ? '' : entry.who });
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
  return rots.filter(function (rot) { return !rot.frozen && !rot.skipped; });
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

function globalError(e) {
  return { rotation: GLOBAL_TAB, rowIndex: e.rowIndex, start: e.start, message: e.message };
}

// #Global rows parsed against the rotation names: set rows for the timelines, relation rows for the sweep,
// error rows for the tab. A bad set row blocks regeneration (blocking); relation errors never do.
function prepareGlobal(rows, names) {
  var parsed = parseGlobal(rows || [], names);
  return { rows: parsed.rows, errors: parsed.errors.map(globalError), blocking: parsed.setErrors.length > 0, setRows: parsed.setRows, relationRows: parsed.relationRows };
}

// Relation state, sweep order and rotation lookup for the sweep (DESIGN 7). Rotation-tab relation rows are
// checked here against the rotation names; rejected rows and rows inside an order cycle get a non-blocking
// error row in their own tab.
function relationContext(global, rots) {
  var names = rots.map(function (r) { return r.name; });
  var byName = {};
  rots.forEach(function (rot) { byName[rot.name] = rot; });
  var entries = global.relationRows.map(function (row) { return { row: row, reader: null, names: whatNames(row) }; });
  rots.forEach(function (rot) {
    (rot.kept || []).filter(isRelationRow).forEach(function (row) {
      var message = validateRelationRow(row, names, rot.name);
      if (message !== null) rot.problems.push(rowError(row, message));
      else entries.push({ row: row, reader: rot.name, names: whatNames(row) });
    });
  });
  var relations = new Relations();
  entries.forEach(function (entry) { relations.add(entry); });
  // Only states that can be in force from the earliest snapshot on order the sweep; only one-sided rows
  // create edges, so only rotation-tab rows can form a cycle.
  var snapshots = rots.filter(function (r) { return r.S !== undefined; }).map(function (r) { return r.S; });
  var minS = snapshots.length ? Math.min.apply(null, snapshots) : -Infinity;
  var ordered = relationOrder(relations.orderEdges(minS), names);
  ordered.ignored.forEach(function (entry) {
    relations.remove(entry);
    byName[entry.reader].problems.push(rowError(entry.row, cycleMessage(entry, ordered.cyclic)));
  });
  rots.forEach(function (rot) { rot.rank = ordered.order.indexOf(rot.name); });
  return { relations: relations, byName: byName };
}

// DESIGN 5.8 autopin: every shift row starting at or before now + autopin (resolved on the grid at now) whose
// pin is empty gets the marker, on a copy so the swept rows and the status are untouched. Needs now. Shifts
// with nobody are not pinned: an unassignable slot must stay the script's so its error row comes back.
function autopinRows(rot, rows, now) {
  if (now === null || now === undefined) return rows;
  var autopin = rot.timeline.at(now).get('autopin');
  var grid = rot.timeline.gridAt(now);
  if (autopin === false || !grid) return rows;
  var limit = grid.offset(now, autopin.sign * resolveInterval(autopin.interval, grid, rot.sizeAt(now)));
  return rows.map(function (r) {
    if (r.type !== 'shift' || r.pin !== '' || r.start > limit || shiftAssignee(r) === null) return r;
    return Object.assign({}, r, { pin: autopin.marker, pinned: true });
  });
}

// Script rows go in front of the kept rows so undated comments still attach to the next kept row below them.
// No snapshot row for a rotation that has none yet and an empty roster at S (a fresh rotation whose first
// roster row is dated after S); a rotation that already has one keeps its boundary even when the roster empties.
function rotationOutput(rot, now) {
  var fresh = rot.snapshotWhat === '' && rot.previousAt === null;
  var rows = fresh ? [] : [makeRow({ type: 'snapshot', start: rot.S, what: rot.snapshotWhat })];
  rot.entries.forEach(function (e) { if (e.generated) rows.push(e.generated); });
  return { name: rot.name, rows: autopinRows(rot, sortRows(rows.concat(rot.problems.map(errorRow), rot.kept)), now) };
}

// Pure regeneration of DESIGN 5.3 to 5.8 and 7.
// input: { rotations: [{ name, rows, snapshotAt }], holidays: [dayIndex], global: #Global row objects, now, only }.
// now is optional: it dates the effective settings in the status and drives autopin (5.8); the schedule itself
// never depends on it.
// only: optional list of rotation names to regenerate; the others are swept frozen and not returned.
// Output: { rotations: [{ name, rows }], global: { rows, errors }, errors, regenerated, status }.
function regenerate(input) {
  var holidays = new Set(input.holidays || []);
  var only = input.only || null;
  var global = prepareGlobal(input.global, input.rotations.map(function (r) { return r.name; }));
  var rots = input.rotations.map(function (r, i) {
    return prepareRotation(r, i, holidays, only !== null && only.indexOf(r.name) < 0, global.setRows, input.now);
  });
  var ctx = relationContext(global, rots);
  var hasErrors = function () { return global.blocking || rots.some(function (rot) { return rot.errors.length > 0; }); };
  if (hasErrors()) return errorOutput(rots, global, input.now);
  sweep(mergeItems(rots), rots, holidays, ctx);
  if (hasErrors()) return errorOutput(rots, global, input.now);
  markUnmetRelations(rots, ctx);
  // Problems with a row (rejected relation rows) are errors in the status; unassignable slots are warnings.
  var problems = collectErrors(rots, 'problems');
  var rowProblems = problems.filter(function (p) { return p.rowIndex !== null; });
  var slotProblems = problems.filter(function (p) { return p.rowIndex === null; });
  return {
    rotations: writable(rots).map(function (rot) { return rotationOutput(rot, input.now); }),
    regenerated: true,
    global: { rows: global.rows, errors: global.errors },
    errors: problems.concat(global.errors),
    status: buildStatus(rots.filter(function (rot) { return !rot.skipped; }), collectErrors(rots, 'warnings').concat(slotProblems), rowProblems.concat(global.errors), input.now, ctx.relations),
  };
}
