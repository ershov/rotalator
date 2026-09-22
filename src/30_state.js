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

  // Returns true when the row changes the grid (period or anchor).
  apply(setRow) {
    var values = parseSetArg(setRow.arg).values;
    var changed = false;
    if ('period' in values && values.period !== this.values.period) {
      changed = true;
      if (!('anchor' in values)) this.values.anchor = setRow.start;
    }
    if ('anchor' in values && values.anchor !== this.values.anchor) changed = true;
    Object.assign(this.values, values);
    return changed;
  }

  grid() {
    return this.values.period === null ? null : new Grid(this.values);
  }

  // Number of regular shifts after the snapshot within which pins are pre-credited.
  precreditPeriods(rosterSize) {
    return this.values.precredit === 'auto' ? rosterSize : this.values.precredit;
  }

  unitsOptions(holidays) {
    return { skip_weekends: this.values.skip_weekends, skip_holidays: this.values.skip_holidays, holidays: holidays };
  }
}

// Settings after each set row, in start order.
class SettingsTimeline {
  constructor(setRows) {
    this.entries = [];
    var settings = new Settings();
    var rows = sortRows(setRows);
    for (var i = 0; i < rows.length; i++) {
      var gridChanged = settings.apply(rows[i]);
      this.entries.push({ start: rows[i].start, settings: settings.clone(), gridChanged: gridChanged });
    }
  }

  at(t) {
    var found = null;
    for (var i = 0; i < this.entries.length && this.entries[i].start <= t; i++) found = this.entries[i].settings;
    return found ? found.clone() : new Settings();
  }

  gridAt(t) {
    return this.at(t).grid();
  }

  gridChanges() {
    return this.entries.filter(function (e) { return e.gridChanged; }).map(function (e) { return e.start; });
  }
}

function formatScore(score) {
  var text = score.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
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

  join(who, baselineArg) {
    if (this.has(who)) return 'join: "' + who + '" is already a member';
    this.members.push({ name: who, score: this.baseline(baselineArg), exclusions: [] });
    return null;
  }

  leave(who) {
    if (!this.has(who)) return 'leave: unknown member "' + who + '"';
    this.members = this.members.filter(function (m) { return m.name !== who; });
    return null;
  }

  // items from parseAssignments. Leavers removed, joiners added, roster reordered, adjustments applied last.
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
      if (!existing.has(it.name)) self.join(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline);
    });
    this.members = items.map(function (it) { return self.get(it.name); });
    items.forEach(function (it) {
      var m = self.get(it.name);
      if (it.op === '=' && existing.has(it.name)) m.score = self.baseline(parseBaseline(it.value));
      else if (it.op === '+=') m.score += Number(it.value);
      else if (it.op === '-=') m.score -= Number(it.value);
    });
    return null;
  }

  score(items) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var m = this.get(it.name);
      if (!m) return 'score: unknown member "' + it.name + '"';
      var n = Number(it.value);
      if (it.op === '=') m.score = n;
      else if (it.op === '+=') m.score += n;
      else m.score -= n;
    }
    return null;
  }

  exclude(who, from, to) {
    var m = this.get(who);
    if (!m) return 'exclude: unknown member "' + who + '"';
    m.exclusions.push({ from: from, to: to === undefined ? null : to });
    return null;
  }

  // Closes every exclusion of `who` active at `at`.
  include(who, at) {
    var m = this.get(who);
    if (!m) return 'include: unknown member "' + who + '"';
    var closed = false;
    m.exclusions.forEach(function (ex) {
      if (ex.from <= at && (ex.to === null || ex.to > at)) { ex.to = at; closed = true; }
    });
    return closed ? null : 'include: no active exclusion for "' + who + '"';
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

  snapshotArg() {
    return this.members.map(function (m) { return m.name + '=' + formatScore(m.score); }).join(', ');
  }

  fromSnapshotArg(text) {
    var items = parseAssignments(text);
    this.members = typeof items === 'string' ? [] : items.map(function (it) {
      return { name: it.name, score: Number(it.value), exclusions: [] };
    });
  }
}
