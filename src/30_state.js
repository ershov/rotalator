// Effective settings at an instant: the rotation's own values over the global ones over the defaults.
class Settings {
  constructor(values) {
    this.values = Object.assign(defaultSettings(), values || {});
  }

  clone() {
    return new Settings(this.values);
  }

  get(key) {
    return this.values[key];
  }

  // No grid without a period and an anchor (an epoch set row gives a period but never an anchor).
  grid(holidays) {
    return this.values.period === null || this.values.anchor === null ? null : new Grid(this.values, holidays);
  }

  unitsOptions(holidays) {
    return { skip_weekends: this.values.skip_weekends, skip_holidays: this.values.skip_holidays, holidays: holidays };
  }
}

var SETTING_LAYERS = ['rotation', 'global'];

// Whether the grid differs: period, grid type or, when counted, the skips changed, or the anchor moved off
// a boundary of the grid in force. An anchor on such a boundary changes nothing (DESIGN 3.4).
function gridChangedBetween(before, after, holidays) {
  if (after.period !== before.period || after.grid !== before.grid) return true;
  if (after.grid === 'counted' && (after.skip_weekends !== before.skip_weekends || after.skip_holidays !== before.skip_holidays)) return true;
  if (after.anchor === before.anchor) return false;
  if (before.anchor === null || before.period === null || after.anchor === null) return true;
  return new Grid(before, holidays).floor(after.anchor) !== after.anchor;
}

// Settings of a rotation over time (DESIGN 3.5): its own set rows layered over the global ones. A key the
// rotation has set wins until a bare key returns it to the global value; keys set in neither layer use the
// defaults. Entries hold the effective Settings and the source of each key after every set row of either
// layer, in start order (global before rotation at the same instant). Rows whose what does not parse are
// skipped, so callers may pass unvalidated rows. holidays: Set of day indexes. impliedAnchor: start of the
// rotation's first shift, or null; it anchors the grid before the first explicit anchor when it comes
// first (source 'implied'), else that anchor itself extends backwards.
class SettingsTimeline {
  constructor(setRows, holidays, globalSetRows, impliedAnchor) {
    this.holidays = holidays || new Set();
    var layers = { global: {}, rotation: {} };
    var usable = function (r) { return r.start !== null && parseSetArg(r.what, r.start).error === null; };
    var events = sortRows((globalSetRows || []).filter(usable)).map(function (r) { return { row: r, layer: 'global' }; })
      .concat(sortRows(setRows.filter(usable)).map(function (r) { return { row: r, layer: 'rotation' }; }))
      .sort(function (a, b) { return a.row.start < b.row.start ? -1 : a.row.start > b.row.start ? 1 : 0; });
    var effective = function () {
      var values = defaultSettings();
      var sources = {};
      Object.keys(values).forEach(function (key) {
        sources[key] = 'default';
        SETTING_LAYERS.forEach(function (layer) {
          if (sources[key] === 'default' && key in layers[layer]) { values[key] = layers[layer][key]; sources[key] = layer; }
        });
      });
      return { values: values, sources: sources };
    };
    var states = [];
    var before = effective();
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var layer = layers[ev.layer];
      var parsed = parseSetArg(ev.row.what, ev.row.start);
      Object.keys(parsed.values).forEach(function (key) { if (parsed.reset.indexOf(key) < 0) layer[key] = parsed.values[key]; });
      parsed.reset.forEach(function (key) { delete layer[key]; });
      var after = effective();
      // A dated rotation row carrying period anchors at its start; a global period row never does (DESIGN 3.5).
      if (ev.layer === 'rotation' && 'period' in parsed.values && !('anchor' in parsed.values) && isFinite(ev.row.start)) {
        layer.anchor = ev.row.start;
        after = effective();
      }
      states.push({ start: ev.row.start, values: after.values, sources: after.sources });
      before = after;
    }
    var explicit = states.find(function (s) { return s.values.anchor !== null; });
    var origin = null;
    if (impliedAnchor !== null && impliedAnchor !== undefined && (!explicit || impliedAnchor < explicit.values.anchor)) {
      origin = { value: impliedAnchor, source: 'implied' };
    } else if (explicit) {
      origin = { value: explicit.values.anchor, source: explicit.sources.anchor };
    }
    var previous = defaultSettings();
    var holidays = this.holidays;
    this.entries = states.map(function (s) {
      if (s.values.anchor === null && origin) { s.values.anchor = origin.value; s.sources.anchor = origin.source; }
      var entry = { start: s.start, settings: new Settings(s.values), sources: s.sources, gridChanged: gridChangedBetween(previous, s.values, holidays) };
      previous = s.values;
      return entry;
    });
  }

  entryAt(t) {
    var found = null;
    for (var i = 0; i < this.entries.length && this.entries[i].start <= t; i++) found = this.entries[i];
    return found;
  }

  at(t) {
    var entry = this.entryAt(t);
    return entry ? entry.settings.clone() : new Settings();
  }

  // Earliest instant the schedule may begin: where the first entry with a grid (period and anchor) takes
  // effect, not before its anchor. Null when no entry completes the grid; hasPeriod tells the cases apart.
  gridStart() {
    var entry = this.entries.find(function (e) { return e.settings.grid(this.holidays) !== null; }, this);
    return entry ? Math.max(entry.start, entry.settings.get('anchor')) : null;
  }

  hasPeriod() {
    return this.entries.some(function (e) { return e.settings.get('period') !== null; });
  }

  // Source of each key at t: 'rotation', 'global', 'default' or, for the anchor, 'implied'.
  sourcesAt(t) {
    var entry = this.entryAt(t);
    if (entry) return Object.assign({}, entry.sources);
    var out = {};
    Object.keys(SETTINGS).forEach(function (key) { out[key] = 'default'; });
    return out;
  }

  // One Grid per entry, built on first use so its day caches survive across calls. Before the first entry
  // with a grid, that grid extended backwards (DESIGN 3.5); null when no entry has one.
  gridAt(t) {
    var entry = this.entryAt(t);
    if (!entry || this.entryGrid(entry) === null) entry = this.entries.find(function (e) { return this.entryGrid(e) !== null; }, this);
    return entry ? this.entryGrid(entry) : null;
  }

  entryGrid(entry) {
    if (entry.grid === undefined) entry.grid = entry.settings.grid(this.holidays);
    return entry.grid;
  }

  gridChanges() {
    return this.entries.filter(function (e) { return e.gridChanged; }).map(function (e) { return e.start; });
  }
}

// At most two decimals, trailing zeros and dot trimmed: 12.5, 14, 19.63, 0.
function formatScore(score) {
  var text = score.toFixed(2).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

// Clips [a, b) to start at `at`; b null is open. Returns null when nothing extends past `at`.
function clipToSnapshot(a, b, at) {
  if (at === null || at === undefined) return [a, b];
  if (b !== null && b <= at) return null;
  return [Math.max(a, at), b];
}

// Ordered members with scores and exclusions [{ from, to }], to null meaning open.
class Roster {
  constructor() {
    this.members = [];
  }

  size() {
    return this.members.length;
  }

  names() {
    return this.members.map(function (m) { return m.name; });
  }

  get(name) {
    for (var i = 0; i < this.members.length; i++) if (this.members[i].name === name) return this.members[i];
    return null;
  }

  has(name) {
    return this.get(name) !== null;
  }

  scores() {
    var out = {};
    this.members.forEach(function (m) { out[m.name] = m.score; });
    return out;
  }

  // kind: number, or 'median' | 'mean' | 'min' | 'max' over current scores. Empty roster gives 0.
  baseline(kind) {
    if (typeof kind === 'number') return kind;
    var scores = this.members.map(function (m) { return m.score; });
    if (!scores.length) return 0;
    if (kind === 'min') return Math.min.apply(null, scores);
    if (kind === 'max') return Math.max.apply(null, scores);
    var sum = scores.reduce(function (a, b) { return a + b; }, 0);
    if (kind === 'mean') return sum / scores.length;
    scores.sort(function (a, b) { return a - b; });
    var mid = scores.length >> 1;
    return scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  }

  addMember(name, baselineKind) {
    this.members.push({ name: name, score: this.baseline(baselineKind), exclusions: [] });
  }

  // items of a join row: name or name=baseline. Joiners are added one by one, so later baselines see earlier joiners.
  join(items, defaultBaseline) {
    for (var i = 0; i < items.length; i++) {
      if (this.has(items[i].name)) return 'join: "' + items[i].name + '" is already a member';
    }
    var self = this;
    items.forEach(function (it) { self.addMember(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline); });
    return null;
  }

  leave(names) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'leave: unknown member "' + unknown + '"';
    this.members = this.members.filter(function (m) { return names.indexOf(m.name) < 0; });
    return null;
  }

  // items of a team row. Leavers removed, joiners added, roster reordered, adjustments applied last.
  team(items, defaultBaseline) {
    var names = new Set();
    for (var i = 0; i < items.length; i++) {
      if (names.has(items[i].name)) return 'team: duplicate member "' + items[i].name + '"';
      names.add(items[i].name);
    }
    this.members = this.members.filter(function (m) { return names.has(m.name); });
    var existing = new Set(this.names());
    var self = this;
    items.forEach(function (it) {
      if (!existing.has(it.name)) self.addMember(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline);
    });
    this.members = items.map(function (it) { return self.get(it.name); });
    items.forEach(function (it) {
      if (it.op !== '=' || existing.has(it.name)) self.adjust(self.get(it.name), it);
    });
    return null;
  }

  // '=' sets to a number or to an aggregate of the current scores; '+=' and '-=' adjust; a bare name does nothing.
  adjust(member, it) {
    if (it.op === '=') member.score = this.baseline(parseBaseline(it.value));
    else if (it.op === '+=') member.score += Number(it.value);
    else if (it.op === '-=') member.score -= Number(it.value);
  }

  // items of a score row: same forms as team, only the members mentioned change.
  score(items) {
    for (var i = 0; i < items.length; i++) {
      var m = this.get(items[i].name);
      if (!m) return 'score: unknown member "' + items[i].name + '"';
      this.adjust(m, items[i]);
    }
    return null;
  }

  unknownMember(names) {
    for (var i = 0; i < names.length; i++) if (!this.has(names[i])) return names[i];
    return null;
  }

  exclude(names, from, to) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'exclude: unknown member "' + unknown + '"';
    var self = this;
    names.forEach(function (n) { self.get(n).exclusions.push({ from: from, to: to === undefined ? null : to }); });
    return null;
  }

  // Closes every exclusion of each name active at `at`.
  include(names, at) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'include: unknown member "' + unknown + '"';
    for (var i = 0; i < names.length; i++) {
      var closed = false;
      this.get(names[i]).exclusions.forEach(function (ex) {
        if (ex.from <= at && (ex.to === null || ex.to > at)) { ex.to = at; closed = true; }
      });
      if (!closed) return 'include: no active exclusion for "' + names[i] + '"';
    }
    return null;
  }

  isExcluded(who, a, b) {
    var m = this.get(who);
    if (!m) return false;
    return m.exclusions.some(function (ex) { return ex.from < b && (ex.to === null || ex.to > a); });
  }

  credit(who, units) {
    var m = this.get(who);
    if (m) m.score += units;
  }

  snapshotWhat() {
    return this.members.map(function (m) { return m.name + '=' + formatScore(m.score); }).join(', ');
  }

  fromSnapshotWhat(text) {
    var items = parseAssignments(text);
    this.members = typeof items === 'string' ? [] : items.map(function (it) {
      return { name: it.name, score: Number(it.value), exclusions: [] };
    });
  }
}
