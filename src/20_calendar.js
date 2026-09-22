class Grid {
  constructor(settings) {
    this.period = settings.period;
    this.anchor = settings.anchor;
  }

  floor(t) {
    return this.anchor + Math.floor((t - this.anchor) / this.period) * this.period;
  }

  ceil(t) {
    return this.anchor + Math.ceil((t - this.anchor) / this.period) * this.period;
  }

  next(t) {
    return this.floor(t) + this.period;
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

// DESIGN 3.4: explicit end, else next shift start, else next grid boundary.
function scoredEnd(shift, nextShiftStart, grid) {
  if (shift.end !== null) return shift.end;
  if (nextShiftStart !== null && nextShiftStart !== undefined) return nextShiftStart;
  return grid.next(shift.start);
}
