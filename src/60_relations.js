// #Global tab (DESIGN 3.5 and 7): spreadsheet-wide set rows, relation rows between rotations, and comments.
// Relation rows (attract, repel, repel!, detach) also appear in rotation tabs, where they are one-sided.

var RELATION_TYPES = ['attract', 'repel', 'repel!', 'detach'];

function isRelationRow(row) {
  return RELATION_TYPES.indexOf(row.type) >= 0;
}

// Relation-specific checks. reader: the rotation whose tab holds the row, null for #Global.
function validateRelationRow(row, rotationNames, reader) {
  var names = whatNames(row);
  if (new Set(names).size !== names.length) return row.type + ' names a rotation twice';
  if (reader === null && names.length < 2) return row.type + ' in ' + GLOBAL_TAB + ' needs at least two rotations';
  for (var i = 0; i < names.length; i++) {
    if (names[i] === reader) return row.type + ' names its own rotation';
    if (rotationNames.indexOf(names[i]) < 0) return 'unknown rotation "' + names[i] + '"';
  }
  return null;
}

// rows: #Global row objects. Returns { setRows, setErrors, relationRows, errors, rows } where rows are the kept
// rows plus an error row above each rejected one. set rows are validated with the ledger rules; a bad one is in
// setErrors and blocks regeneration since every rotation depends on it. Rejected relation rows are ignored.
// Comments are kept and otherwise ignored.
function parseGlobal(rows, rotationNames) {
  var errors = [];
  var setErrors = [];
  var setRows = [];
  var relationRows = [];
  var kept = sortRows(attachComments(rows.filter(function (r) { return r.type !== 'error'; })));
  var epochs = {};
  var duplicateEpoch = function (row) {
    if (!isEpochRow(row)) return null;
    if (epochs[row.type]) return 'more than one undated ' + row.type + ' row';
    epochs[row.type] = true;
    return null;
  };
  kept.forEach(function (row) {
    if (row.type === 'comment') return;
    if (row.type === 'set') {
      var problem = validateRow(row) || duplicateEpoch(row);
      if (problem === null) setRows.push(row); else setErrors.push(rowError(row, problem));
      return;
    }
    var message = !isRelationRow(row) ? (row.type === '' ? 'missing type' : 'type "' + row.type + '" is not allowed in ' + GLOBAL_TAB)
      : validateRow(row) || validateRelationRow(row, rotationNames, null) || duplicateEpoch(row);
    if (message === null && row.durationInterval && row.durationInterval.unit !== 'clock') message = 'duration in ' + GLOBAL_TAB + ' takes clock units only';
    if (message === null) relationRows.push(row); else errors.push(rowError(row, message));
  });
  var all = setErrors.concat(errors);
  return { setRows: setRows, setErrors: setErrors, relationRows: relationRows, errors: all, rows: sortRows(all.map(errorRow).concat(kept)) };
}

function pairKey(a, b) {
  return a < b ? a + '\u0000' + b : b + '\u0000' + a;
}

// Pair states over time. Each relation row sets the state of every pair it names from its start (latest row
// wins, ties by processing order) and reverts it to neutral at its end. reader null means mutual; two tabs
// starting the same one-sided relation on each other at the same instant make the pair mutual.
class Relations {
  constructor() {
    this.events = new Map();
  }

  // entry: { row, reader, names }. Pairs: all pairs of names for #Global, (reader, name) for a rotation tab.
  add(entry) {
    var self = this;
    var kind = entry.row.type === 'detach' ? null : entry.row.type;
    var pairs = [];
    if (entry.reader === null) {
      entry.names.forEach(function (a, i) { entry.names.slice(i + 1).forEach(function (b) { pairs.push([a, b]); }); });
    } else {
      entry.names.forEach(function (b) { pairs.push([entry.reader, b]); });
    }
    pairs.forEach(function (p) {
      var key = pairKey(p[0], p[1]);
      if (!self.events.has(key)) self.events.set(key, []);
      var list = self.events.get(key);
      var opposite = list.find(function (e) {
        return e.starts === 1 && e.t === entry.row.start && e.kind === kind && e.reader !== null && e.reader === p[1] && entry.reader !== null;
      });
      if (opposite) { opposite.reader = null; opposite.target = null; }
      else list.push({ t: entry.row.start, starts: 1, seq: list.length, kind: kind, reader: entry.reader, target: p[1], entry: entry });
      if (entry.row.end !== null) list.push({ t: entry.row.end, starts: 0, seq: list.length, kind: null, reader: null, target: null, entry: entry });
    });
  }

  remove(entry) {
    this.events.forEach(function (list, key, map) {
      map.set(key, list.filter(function (e) { return e.entry !== entry; }));
    });
  }

  // Ends sort before starts at equal instants; later-added rows win among starts.
  sorted(list) {
    return list.slice().sort(function (x, y) { return (x.t < y.t ? -1 : x.t > y.t ? 1 : 0) || (x.starts - y.starts) || (x.seq - y.seq); });
  }

  // { kind, reader } in force between a and b at t, or null.
  stateAt(a, b, t) {
    var list = this.events.get(pairKey(a, b));
    if (!list) return null;
    var sorted = this.sorted(list);
    var state = null;
    for (var i = 0; i < sorted.length && sorted[i].t <= t; i++) state = sorted[i].kind === null ? null : sorted[i];
    return state;
  }

  // The kind reader is subject to towards other at t: a mutual state, or a one-sided one it holds itself.
  kindFor(reader, other, t) {
    var state = this.stateAt(reader, other, t);
    if (!state || (state.reader !== null && state.reader !== reader)) return null;
    return state.kind;
  }

  // Order edges { from, to, entry } (from is decided before to) of the one-sided states that are or will be in
  // force from t on: per pair the last event at or before t and every event after it. Mutual states add none.
  orderEdges(t) {
    var edges = [];
    var self = this;
    this.events.forEach(function (list) {
      var sorted = self.sorted(list);
      var from = 0;
      for (var i = 0; i < sorted.length; i++) if (sorted[i].t <= t) from = i;
      for (var j = from; j < sorted.length; j++) {
        var e = sorted[j];
        if (e.kind !== null && e.reader !== null) edges.push({ from: e.target, to: e.reader, entry: e.entry });
      }
    });
    return edges;
  }
}

// Kahn's algorithm with tab order as tiebreak. Returns { order, rest } where rest holds the rotations left in
// cycles (and those only reachable through them).
function topologicalOrder(edges, rotationNames) {
  var pending = edges.slice();
  var order = [];
  var rest = rotationNames.slice();
  var progress = true;
  while (progress) {
    progress = false;
    for (var i = 0; i < rest.length; i++) {
      var name = rest[i];
      if (pending.some(function (e) { return e.to === name; })) continue;
      order.push(name);
      rest.splice(i, 1);
      pending = pending.filter(function (e) { return e.from !== name; });
      progress = true;
      break;
    }
  }
  return { order: order, rest: rest };
}

// Rotations inside dependency cycles: what remains after repeatedly dropping sources and sinks. A rotation on
// a path between two cycles is included too.
function cyclicRotations(edges, rotationNames) {
  var nodes = rotationNames.slice();
  var changed = true;
  while (changed) {
    changed = false;
    nodes = nodes.filter(function (n) {
      var hasIn = edges.some(function (e) { return e.to === n && nodes.indexOf(e.from) >= 0; });
      var hasOut = edges.some(function (e) { return e.from === n && nodes.indexOf(e.to) >= 0; });
      if (hasIn && hasOut) return true;
      changed = true;
      return false;
    });
  }
  return nodes;
}

// Sweep order at equal starts (DESIGN 7): every rotation after the rotations it reads, then tab order. Entries
// whose edges lie inside a cycle are returned in `ignored`; the order is computed without them.
function relationOrder(edges, rotationNames) {
  var cyclic = cyclicRotations(edges, rotationNames);
  var ignored = [];
  var kept = edges.filter(function (e) {
    var inCycle = cyclic.indexOf(e.from) >= 0 && cyclic.indexOf(e.to) >= 0;
    if (inCycle && ignored.indexOf(e.entry) < 0) ignored.push(e.entry);
    return !inCycle;
  });
  var result = topologicalOrder(kept.filter(function (e) { return ignored.indexOf(e.entry) < 0; }), rotationNames);
  return { order: result.order.concat(result.rest), ignored: ignored, cyclic: cyclic };
}

function cycleMessage(entry, cyclic) {
  var others = cyclic.filter(function (n) { return n !== entry.reader; });
  return 'relation order cycle among ' + others.join(', ') + '; use a ' + GLOBAL_TAB + ' row';
}

// Adds to `holders` (Map member -> rotation names) the members holding a decided shift of `target`
// overlapping [from, to).
function addHolders(holders, target, from, to) {
  target.entries.forEach(function (e) {
    if (e.who === null || e.start >= to || e.end <= from) return;
    if (!holders.has(e.who)) holders.set(e.who, []);
    if (holders.get(e.who).indexOf(target.name) < 0) holders.get(e.who).push(target.name);
  });
}

// Members holding a decided shift overlapping [a, b) in rotations that `kind` applies to for rot at a.
function relatedHolders(ctx, rot, kind, a, b) {
  var holders = new Map();
  Object.keys(ctx.byName).forEach(function (other) {
    var target = ctx.byName[other];
    if (target !== rot && ctx.relations.kindFor(rot.name, other, a) === kind) addHolders(holders, target, a, b);
  });
  return holders;
}

// repel! partners of rot at a with the pair's rest window in minutes: D = (D_rot + D_partner) / 2, each
// min_distance resolved in its own grid space with its roster at a (DESIGN 7). localDistance: D_rot.
function strongPartners(ctx, rot, a, localDistance) {
  var partners = [];
  Object.keys(ctx.byName).forEach(function (other) {
    var target = ctx.byName[other];
    if (target === rot || ctx.relations.kindFor(rot.name, other, a) !== 'repel!') return;
    var grid = target.timeline.gridAt(a);
    var theirs = grid ? resolveInterval(target.timeline.at(a).get('min_distance'), grid, target.roster.size()) : 0;
    partners.push({ rot: target, distance: (localDistance + theirs) / 2 });
  });
  return partners;
}

// Members repelled from slot [a, b) of rot: holders of overlapping shifts in plain repel partners, and holders
// of shifts in repel! partners overlapping the slot widened by the pair's window less `shrink` (never below
// zero) along rot's grid. Map member -> rotation names.
function repelledHolders(ctx, rot, a, b, grid, partners, shrink) {
  var holders = relatedHolders(ctx, rot, 'repel', a, b);
  partners.forEach(function (p) {
    var d = Math.max(p.distance - shrink, 0);
    addHolders(holders, p.rot, grid.offset(a, -d), grid.offset(b, d));
  });
  return holders;
}
