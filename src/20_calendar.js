var COUNTED_DAY_SEARCH_LIMIT = 100000;

// Boundaries anchor + k*period (DESIGN 3.5, 4). With grid=counted the timeline is the concatenation of
// counted days (not skipped by skip_weekends/skip_holidays) and period counts counted days; an instant
// inside a skipped day projects onto the boundary between the adjacent counted days.
class Grid {
  constructor(settings, holidays) {
    this.period = settings.period;
    this.anchor = settings.anchor;
    this.counted = settings.grid === 'counted';
    this.options = { skip_weekends: settings.skip_weekends, skip_holidays: settings.skip_holidays, holidays: holidays };
    this.anchorDay = dayIndex(this.anchor);
    this.countCache = new Map();
    this.dayCache = new Map();
  }

  skipped(day) {
    return isSkippedDay(day, this.options);
  }

  // Counted days in [anchorDay, day), negative for days before the anchor day.
  countedBefore(day) {
    var n = this.countCache.get(day);
    if (n !== undefined) return n;
    n = 0;
    for (var d = Math.min(day, this.anchorDay); d < Math.max(day, this.anchorDay); d++) if (!this.skipped(d)) n++;
    if (day < this.anchorDay) n = -n;
    this.countCache.set(day, n);
    return n;
  }

  // The n-th counted day from the anchor day (0 is the first counted day at or after it).
  countedDay(n) {
    var cached = this.dayCache.get(n);
    if (cached !== undefined) return cached;
    var dir = n >= 0 ? 1 : -1;
    var d = n >= 0 ? this.anchorDay : this.anchorDay - 1;
    var k = n >= 0 ? 0 : -1;
    for (var i = 0; i < COUNTED_DAY_SEARCH_LIMIT; i++) {
      if (!this.skipped(d)) {
        this.dayCache.set(k, d);
        if (k === n) return d;
        k += dir;
      }
      d += dir;
    }
    return d;
  }

  // t itself, or the next boundary when t lies inside a skipped day of a counted grid.
  onCounted(t) {
    return this.counted && this.skipped(dayIndex(t)) ? this.ceil(t) : t;
  }

  // Wall-clock minutes to counted minutes and back; the identity in calendar mode.
  coord(t) {
    if (!this.counted) return t;
    var day = dayIndex(t);
    var base = this.countedBefore(day) * MINUTES_PER_DAY;
    return this.skipped(day) ? base : base + (t - dayStart(day));
  }

  instant(c) {
    if (!this.counted) return c;
    var n = Math.floor(c / MINUTES_PER_DAY);
    return dayStart(this.countedDay(n)) + (c - n * MINUTES_PER_DAY);
  }

  floor(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + Math.floor((this.coord(t) - a) / this.period) * this.period);
  }

  ceil(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + Math.ceil((this.coord(t) - a) / this.period) * this.period);
  }

  next(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + (Math.floor((this.coord(t) - a) / this.period) + 1) * this.period);
  }

  // t moved by minutes along the grid's timeline; t + minutes in calendar mode.
  offset(t, minutes) {
    return this.instant(this.coord(t) + minutes);
  }
}

function isSkippedDay(day, options) {
  if (options.skip_weekends) {
    var w = weekdayOfDay(day);
    if (w === 0 || w === 6) return true;
  }
  return Boolean(options.skip_holidays && options.holidays && options.holidays.has(day));
}

// Fractional days covered by [a, b), per calendar day, skipping days per options
// { skip_weekends, skip_holidays, holidays: Set<dayIndex> }.
function units(a, b, options) {
  options = options || {};
  if (b <= a) return 0;
  var minutes = 0;
  for (var day = dayIndex(a), last = dayIndex(b - 1); day <= last; day++) {
    if (isSkippedDay(day, options)) continue;
    var from = Math.max(a, dayStart(day));
    var to = Math.min(b, dayStart(day + 1));
    minutes += to - from;
  }
  return minutes / MINUTES_PER_DAY;
}

function firstAfter(instants, t) {
  if (!instants) return null;
  for (var i = 0; i < instants.length; i++) if (instants[i] > t) return instants[i];
  return null;
}

// DESIGN 5.4. grid: the Grid effective at shift.start. gridChanges: ascending instants of set rows changing the grid.
function claimEnd(shift, nextShiftStart, grid, gridChanges) {
  var end = shift.end !== null ? shift.end : grid.next(shift.start);
  if (nextShiftStart !== null && nextShiftStart !== undefined && nextShiftStart < end) end = nextShiftStart;
  var change = firstAfter(gridChanges, shift.start);
  if (change !== null && change < end) end = change;
  return end;
}

// DESIGN 3.4: explicit end, else the earlier of the next shift start and the next grid boundary.
function scoredEnd(shift, nextShiftStart, grid) {
  if (shift.end !== null) return shift.end;
  var end = grid.next(shift.start);
  return nextShiftStart !== null && nextShiftStart !== undefined && nextShiftStart < end ? nextShiftStart : end;
}

// Minutes of an interval on the grid's timeline (DESIGN 3.3): sl is one period, ts is rosterSize periods.
function resolveInterval(interval, grid, rosterSize) {
  if (interval.unit === 'sl') return interval.amount * grid.period;
  if (interval.unit === 'ts') return interval.amount * grid.period * rosterSize;
  return interval.minutes;
}
