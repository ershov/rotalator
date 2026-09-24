# Rotalator design

Rotalator is a small script that keeps an on-call rotation topped up in a
shared spreadsheet. Humans edit the spreadsheet; the script runs nightly or on
demand, replays the history, and rewrites the future so that on-call load stays
fair. There is no UI beyond the spreadsheet itself.

## 1. Goals and constraints

- Source of truth is a Google Spreadsheet. Multiple people edit it. The
  environment is trusted; no access control in the script.
- The script tops up the schedule to a configurable horizon (default 90 days).
- Fairness is measured over the whole history, in fractional days.
- Runs are idempotent and deterministic: same input, same output; a second run
  on the result changes nothing. No wall-clock reads or randomness inside the
  core. `now` is a parameter and is used only to advance the snapshot;
  regeneration is defined purely by the ledger.
- Normal team life is expressed as rows in the timeline: joins, leaves,
  vacations, swaps, substitutions, pinned shifts, settings changes.
- Zero runtime dependencies. Plain JavaScript that runs unchanged on the Apps
  Script V8 runtime and in Node for tests.
- Concurrency is not handled in v1. The scheduled run happens at night.

Design principles: Rotalator stays a periodic, idempotent script that edits a
spreadsheet. There is no app and no UI beyond the spreadsheet and its menu.
Pragmatic spreadsheet conventions (a column, a row type, a tab name prefix) are
preferred over new components, and the code has zero dependencies unless the
owner explicitly approves one.

## 2. Concepts

| Term | Meaning |
|---|---|
| rotation | One on-call role, one ledger tab. |
| ledger | Time-sorted rows of a rotation: shifts and events. |
| member | A person, identified by the verbatim string used in the spreadsheet. |
| roster | Ordered list of current members and their scores. |
| score | Fractional days a member has been on call, plus baseline adjustments. |
| units | Days credited for an interval, honouring `skip_weekends` and `skip_holidays`. |
| period | Regular shift length: `Nd` or `Nw`. |
| grid | Instants `anchor + k*period` for all integers `k`. Regular shifts start and end on the grid. |
| slot | A time span the script must fill with a generated shift. |
| claim | The span a kept shift occupies for the purpose of regeneration. |
| snapshot | Script-owned row with roster and scores at an instant. Replay starts there, and everything after it is recomputed. |
| current shift | The shift row starting at the snapshot instant. Kept as is. |
| pinned | Rows with a non-empty `pin` cell. The script never modifies them. |

## 3. Spreadsheet layout

### 3.1 Tabs

| Tab | Owner | Purpose |
|---|---|---|
| `<rotation>` | users and script | One per rotation. Tab name is the rotation name. |
| `#Holidays` | users | Column A: date `YYYY-MM-DD`, column B: note. Applies to all rotations. |
| `#Global` | users and script | Spreadsheet-wide `set` defaults, relations between rotations over time, comments; the script adds `error` rows. |
| `#Status` | script | Recognised tabs, scores, last and next shifts, exclusions, warnings. Fully rewritten each run. |
| `#All shifts` | script | Every shift of every rotation in one table. Fully rewritten each run. |
| `#Preview <rotation>`, `#Preview Global` | script | Dry run output. |

Every tab whose name starts with `#` is a system tab and is never a rotation.
Any other tab whose first row is the ledger header is a rotation; anything else
is ignored. Renaming `primary` to `#primary` disables the rotation: it is
neither read nor written, links naming it are dangling and get an `error` row
in `#Global`, and renaming it back later behaves like a stale run (5.2). The
`#Status` tab starts with a block listing the rotations found, the number of
holidays and `#Global` rows read, and the tabs ignored (including
`#`-prefixed tabs that are not system tabs, so a disabled rotation is visible
there). A missing
preview tab is created right after the tab it previews and never moved
afterwards.

### 3.2 Ledger columns

```
pin | start | type | what | end | duration | note
```

- `pin`: any non-empty value. Pinned rows are never modified or deleted.
- `start`: `YYYY-MM-DDTHH:MM`, spreadsheet time zone, plain text. Mandatory.
- `type`: row type, see 3.4.
- `what`: the row's payload: a member, a list of items, a settings list or a
  message, depending on `type`. One item grammar for every list, see 3.3.
- `end`: `YYYY-MM-DDTHH:MM`. Optional. Mutually exclusive with `duration`.
- `duration`: e.g. `2d`, `12h`, `1d12h`, `1w`. Optional.
- `note`: free text, preserved on user rows, script-written on generated rows.

The header row is fixed and is how the script recognises a ledger tab. Rows
are kept sorted by `start`; the script re-sorts on every write.

### 3.3 Value formats

- Datetime: `YYYY-MM-DDTHH:MM`. On read the script also accepts a space
  instead of `T`, a missing time (`00:00`), and real date cells, which it
  converts using the spreadsheet time zone. It always writes the canonical
  form. Text sorts correctly as a string and survives CSV round trips.
- Duration and period: an integer followed by `w`, `d`, `h` or `m`, optionally
  chained: `1w`, `3d`, `12h`, `1d12h`. Period accepts only `w` and `d`.
- Items: every list-taking `what` uses one grammar. Items are separated by
  `,` or `;`, whitespace trimmed; `:` is not a separator because times contain
  it. Each item is `name`, `name=value`, `name+=number` or `name-=number`.
  Which forms a row type accepts is given in 3.4.
- Member ids: any text without `,` `;` `=` `+`. Matched verbatim.
- Nobody: empty `what` on a `shift`, `-` or `none`.
- Scores are written with at most two decimals, trailing zeros trimmed:
  `12.5`, `14`, `19.63`, `0`. Any decimal is accepted on read.

### 3.4 Row types

| type | what | end/duration | owner |
|---|---|---|---|
| shift | one member, or nobody | optional | users or script |
| team | `name`, `name=baseline`, `name=number`, `name+=n`, `name-=n` | | users |
| join | `name`, `name=baseline`, `name=number`, one or more | | users |
| leave | `name`, one or more | | users |
| exclude | `name`, one or more | optional, open-ended if absent | users |
| include | `name`, one or more | | users |
| score | same forms as team | | users |
| set | `key`, `key=value` | | users |
| snapshot | `name=score` | | script |
| error | message | | script |
| (empty) | free text | | users |

A row with an empty `type` is a comment (internal type `comment`). It is never
validated beyond parsing `start`, never replayed, never pruned and never
rewritten except for sorting (3.6) and the canonical form of `start`, `end`
and `duration`; replay, generation, status and the `#All shifts` view ignore
it. A comment whose `start` does not parse counts as undated and produces a
`#Status` warning naming the row. An entirely blank row is dropped on read; a
comment needs content in some cell. `#Global` accepts comments the same way.

**shift.** Assigns the member in `what` from `start`. Its scored interval ends
at the explicit `end`, else at the earlier of the next `shift` row's start and
the next grid boundary strictly after `start`. The grid rule gives the final
row of the ledger a definite extent without a terminator row or an explicit
`end`, and keeps a stale ledger's last shift from being credited for the gap
before the next run; a hand-entered history shift spanning several periods
therefore needs `duration` or `end`. Its claim (see 5.4) ends at the explicit
`end`, else at the next grid boundary strictly after `start`. Unpinned shifts
starting after the snapshot belong to the script and are regenerated every
run. Any user edit to a future shift must be pinned or it is lost.

**team.** Sets the full roster. `alice, bob, carol=median, dave=12, erin+=2`.
The list is diffed against the current roster: absent members leave, new
members join with the given baseline or the `baseline` setting, `+=`/`-=`
adjust scores (a joiner's after its baseline), `=number` sets a score and
`=median|mean|min|max` sets an existing member to that aggregate of the
current scores. The list order becomes the roster order used by the `order`
tiebreak.

**join.** One or more members join: `erin, frank=min, gina=12`. The value is
`median`, `mean`, `min`, `max` or a number; default is the `baseline`
setting. Baselines are computed from the projected scores of the roster at
that instant, including excluded members; joiners are added one by one, so a
later item's aggregate includes the earlier joiners. Joining an existing member
is an error.

**leave.** One or more members removed, scores discarded. A later join starts
fresh with a baseline.

**exclude / include.** The listed members are ineligible from `start` until
`end`, `duration`, or a later `include` row naming them. `end` or `duration`
apply to every member listed. Score is kept and the members still count for
baselines.

**score.** `alice=10, bob+=2, carol-=1, dave=mean`. Manual corrections, e.g.
for history older than the snapshot. Same item forms as `team`, but only the
members mentioned change and they must be on the roster; a bare `name` is
accepted and does nothing.

**set.** Changes settings from `start` onward. Keys in 3.5, as `key=value` or a
bare `key`. A bare key applies the key's default behaviour: the fixed default
for most keys, and for `anchor` the row's own `start`. `anchor` never takes a
value; `period` always needs one. `set` rows are always replayed from the top
of the ledger even when older than the snapshot, so the settings history stays
in one visible place. When `period` changes and `anchor` is not given,
`anchor` defaults to the row's own `start`. A `set` row that changes `period`,
`anchor` or `grid`, or that changes `skip_weekends` or `skip_holidays` while
`grid=counted`, cuts claims and slots at its `start`; the grid realigns from
there.

**snapshot.** One per rotation, written by the script. Its instant is the
start of the current shift, see 5.2. `what` is the roster in order with scores
as of that instant: `alice=12.5, bob=11`. The snapshot is the single
boundary in the ledger: rows before it are ignored on replay, except `set`
rows and `shift` or `exclude` intervals that extend past it, which are clipped
to start at the snapshot; the shift starting at the same instant is the
current shift and is kept; unpinned shifts after it are regenerated. The
script never moves the snapshot backwards. Deleting the snapshot forces a full
replay from the top, which is the intended reset mechanism. Rows older than the
snapshot other than `set` rows may be cut to an archive tab by hand at any
time.

**error.** Written by the script, `what` is the message. Every `error` row is
removed on read, so they are purely diagnostic and never accumulate. See 6.

### 3.5 Settings (`set` keys)

| key | default | meaning |
|---|---|---|
| period | required | `Nd` or `Nw`; `w` is `7d`. Always `period=value`. |
| anchor | start of the `set` row | A grid instant. Also the earliest instant the schedule can begin. Written as a bare `anchor`; it takes no value and the row's `start` is the anchor. |
| grid | calendar | `calendar`: a boundary every `period` of wall-clock time. `counted`: a boundary every `period` of counted days, the days not skipped by `skip_weekends` and `skip_holidays` (see 4); a shift whose boundary would fall in skipped days runs through them to the next counted day. `1w` is then seven counted days and drifts across weekdays when weekends are skipped. |
| horizon | 90d | Generate slots up to the first grid boundary at or after `snapshot + horizon`. |
| skip_weekends | false | Saturdays and Sundays credit zero units. |
| skip_holidays | false | Dates in `#Holidays` credit zero units. |
| tolerance | 0 | Days. Candidates are members within `tolerance` of the lowest projected score. |
| min_distance | 0 | Grid steps (regular shifts) of rest required on both sides of a slot. |
| tiebreak | order | `order` or `shuffle`. |
| seed | 0 | Integer mixed into the shuffle hash. |
| baseline | median | Default for joiners: `median`, `mean`, `min`, `max`. |
| precredit | auto | Grid steps (regular shifts) after the snapshot within which pinned shifts are pre-credited. `auto` means the roster size. `0` disables. |

A bare key restores the default in this table (`tolerance`, `tiebreak`,
`precredit`, ...); a bare `anchor` re-anchors the grid at the row's `start`
without changing the period.

Global defaults: `set` rows in `#Global` use the same grammar and are replayed
from the top like a rotation's own. The effective value of a key for a
rotation at instant `t` is the rotation's own value when the rotation has set
the key (and not returned it) by `t`, else the global value at `t`, else the
built-in default. A bare key in a rotation returns that key to the global
value from then on; a bare key in `#Global` returns it to the built-in
default. `period` and `anchor` may be set globally (a bare global `anchor`
anchors at the global row's `start`); a grid change arriving from either
layer cuts claims and slots for the rotation like a local one (5.4). A
rotation that takes its grid from `#Global` starts with an empty `set` row,
the one row type whose `what` may be empty: a bare local `anchor` would pin
the anchor in the rotation, so a later global period change would re-anchor
the global layer only and leave that rotation on offset boundaries. A global
`set` row that fails validation blocks regeneration like a ledger error, since
every rotation depends on it; set rows that do not parse are skipped when a
settings timeline is built from unvalidated rows (Fill Shifts Grid, snapshot
advance). The `#Status` settings block shows the source of each key:
`rotation`, `global` or `default`.

The first row of a new rotation must be a `set` row, with `period` unless
`#Global` supplies it at that instant, followed by a `team` row. Dating the
`set` row at the intended first shift start makes it the anchor. The
templates and `init` date it at the most recent Monday 00:00: day-aligned
boundaries keep the arithmetic simple (a shift is a
whole number of days, `skip_weekends` and `skip_holidays` cut at midnight), and
the nightly run between 02:00 and 03:00 then produces today's schedule. A
rotation that hands over during the day sets its own time in the `set` row.

### 3.6 Same-instant ordering

Rows with equal `start` sort as: comment, `error`, `set`, `snapshot`, `team`,
`join`, `leave`, `score`, `exclude`, `include`, `shift`. State changes at an
instant therefore apply before the shift starting at it. Sorting is stable, so
user order is kept otherwise.

An undated comment attaches to the next dated row below it in the ledger as
read: its sort key becomes that row's `start` with an order just before that
row's type, resolved once when the ledger is validated and kept for the rest
of the run. The comment therefore sorts directly above the instant it was
written at even when the row below it is deleted and recreated: a comment
above a generated shift stays above the regenerated shift run after run, and a
comment above the snapshot row ends up above the shift that follows it once
the snapshot moves on. Undated comments with no dated row below them are
trailing and sort after everything. Rows the script adds (snapshot, generated
shifts, error rows) are placed in front of the kept rows before sorting.

## 4. Scoring

Units of an interval `[a, b)` are the sum over calendar days of the fraction of
each day covered by the interval, counting only days that are not skipped. A
full week is 7 units, or 5 with `skip_weekends`. Partial substitutions credit
fractions. The score of a member is the sum of units of their shift intervals
plus baseline and manual adjustments.

All datetimes are naive wall-clock values in the spreadsheet time zone.
Internally they are minutes since 1970 with the wall clock treated as UTC, so
arithmetic never crosses a DST boundary. A weekly shift that starts at 09:00
starts at 09:00 local in every week.

With `grid=counted` the grid is laid out on the counted timeline: the
concatenation of the days that are not skipped, each keeping its 24 hours. An
instant maps to counted minutes as the number of counted days before its day
times 1440 plus its offset within the day. An instant inside a skipped day,
including an anchor, maps to the boundary between the adjacent counted days,
with no error: a Saturday anchor at 09:00 therefore puts the boundaries at
00:00 of counted days. Boundaries are `anchor + k*period` in counted minutes,
mapped back to wall-clock instants, so with `skip_weekends` a daily shift
starting on Friday 09:00 ends on Monday 09:00 and credits one unit, and `1w`
means seven counted days and drifts across weekdays. Grid steps
(`min_distance`, `precredit`) are counted along the same timeline. Scoring is
identical in both modes: skipped days credit zero.

## 5. Algorithm

One run processes all rotations together. Input: the ledgers, `#Holidays`,
`#Global`, `now`, and optionally the names of the rotations to regenerate.
Output: new ledgers, status data, and a list of errors. `now` is consumed by
step 5.2 only. Everything from 5.3 on depends on the ledgers and `#Global`
alone, so `regenerate(ledgers, holidays, global, only)` is a pure function of
the spreadsheet content and can be tested without a clock.

Run scope: with `only`, rotations not listed are frozen. They are read,
validated and swept with all their rows kept as they stand (no prune, no
slots, no snapshot move), so link constraints still see their shifts and the
status still shows them; they are not returned for writing. A frozen rotation
with a validation error still stops the run (5.1). The tabs block of `#Status`
lists the rotations regenerated in the run.

### 5.1 Read and validate

Parse every ledger row. Drop `error` rows. Collect validation errors with row
references: unknown type, bad datetime, bad duration, both `end` and
`duration` set, `what` missing where required, an item form the type does not
accept (a `shift` with two names, `leave` with `name=1`, `anchor=value`, a
bare `period`), unknown setting key, `join` of a current member, `leave` or
`exclude` of an unknown member, first row other than a comment not a `set`
with `period`. Comments are skipped. If any error exists in any tab, no
regeneration happens in this run; see 6.

### 5.2 Advance the snapshot

For each rotation compute the new snapshot instant `S`:

1. If a shift row contains `now` (latest shift with `start <= now`, extent
   covering `now`), `S` is its start.
2. Otherwise `S` is the grid boundary at or before `now`, in the grid
   effective at `now`.
3. `S` is raised to the `anchor` if that is later, so a rotation whose first
   `set` row is dated next Monday starts next Monday.
4. `S` is raised to the start of the first `team` or `join` row if that is
   later, so no slot is generated before there is a roster. In steps 3 and 4
   an instant inside a skipped day of a counted grid is replaced by the next
   grid boundary, so `S` never sits inside skipped days.
5. `S` is never earlier than the existing snapshot.

The snapshot row is placed at `S`. Its scores are filled in by the sweep in
5.5, which records roster and scores when it passes `S`. If the script has not
run for a while, the span between the last shift and `S` stays empty and is
ignored; the current period is generated from its grid boundary, partly in the
past.

### 5.3 Prune and sort

Delete unpinned `shift` rows with `start > S`. Everything else is kept: rows
before `S`, the current shift at `S`, pinned shifts, comments, and all user
rows dated after `S`. Stable sort by `start` and the 3.6 type order.

### 5.4 Claims and slots

Every kept `shift` claims `[start, claimEnd)` where `claimEnd` is the explicit
end, else the next grid boundary strictly after `start` in the grid effective at
`start`, truncated by the start of the next kept `shift` row and by any `set`
row that changes the grid. An open-ended pinned shift is one regular shift; a
longer one needs `duration` or `end`.

Regeneration range: from `regenStart` to `horizonEnd`. `regenStart` is the
claim end of the current shift, or `S` itself when no shift starts at `S`.
`horizonEnd` is the first grid boundary at or after `S + horizon`.

Every uncovered span inside the range is split at grid boundaries into slots.
The first slot of a span may be short when it starts after a substitution or a
pinned shift with an odd end. Boundaries never move because of irregular rows.

### 5.5 Pre-credit

Pinned shifts with `start` in `(S, S')`, where `S'` is `precredit` grid steps
after `S`, whose assignee is on the roster are credited when the sweep
reaches `S`, after the state rows at `S` and after the snapshot is recorded,
and skipped when the sweep reaches them. Doing it at `S` lets a fresh ledger's
`team` row dated `S` and `precredit = auto` work. This lets someone who
volunteered for a shift inside the next cycle skip a turn before it. Pins
further out are credited when reached, and the greedy compensates afterwards.

### 5.6 Sweep

Walk all items of all rotations in `start` order, ties broken by rotation
order (link order, else tab order) and by 3.6. Replay begins at each
rotation's previous snapshot, with `set` rows applied from the top first.
Rows before the previous snapshot other than `set` rows are ignored; intervals
that extend past it are clipped.

- `set`, `team`, `join`, `leave`, `score`, `exclude`, `include`: update state.
  Baselines use projected scores at that instant.
- Kept `shift`: credit units of its scored interval to its assignee, unless
  pre-credited.
- Slot: choose an assignee, credit the units, emit an unpinned `shift`.
- When the walk passes `S` for a rotation, record roster and scores for the
  new snapshot. Scores at that instant include the part of any interval before
  it.

### 5.7 Selection for a slot `[a, b)`

1. Eligible: on the roster, no exclusion overlapping `[a, b)`, and no shift of
   theirs, kept or already generated, overlapping `[a', b')` where `a'` is
   `min_distance` grid steps before `a` and `b'` as many steps after `b`
   (`a - D` and `b + D` with `D = min_distance * period` in calendar mode).
2. Candidates: eligible members with `score <= min(score) + tolerance`.
3. Tiebreak `order`: walk the roster cyclically starting after the assignee of
   the previous shift in this rotation and take the first candidate. With no
   previous shift, start at the top.
4. Tiebreak `shuffle`: lowest FNV-1a 32-bit hash of
   `seed|rotation|a|member`, ties by roster order.
5. Relaxation: if nobody is eligible, decrement `min_distance` by one and
   retry. At zero with nobody eligible, emit a `shift` with nobody and an
   `error` row at `a`. Exclusions are never violated. Any relaxation used is
   recorded in the generated shift's `note`.

With `tolerance = 0` and `tiebreak = order` this is plain lowest-score-first
with a stable order for ties.

### 5.8 Write

Replace the old snapshot row with the new one at `S`. Write each ledger tab in
full, sorted. Rows at or before `S` are written back unchanged apart from
sorting. No terminator row and no explicit `end` on the last row: the last
shift's extent is the next grid boundary after its start, by the rule in 3.4,
and `horizonEnd` is always a grid boundary so the two agree.

Status data is built from the swept state: the run instant and mode, the
recognised tabs (rotations found, rotations regenerated in this run, holidays
and link rows read, tabs ignored),
and per rotation the snapshot instant, `horizonEnd`, and for each roster
member the score at `S`, the projected score at `horizonEnd`, the last shift
(latest start at or before `S`), the next shift (first start after `S`) and
the exclusions active at `S`; plus the warnings of the sweep (relaxations and
unassignable slots). On a validation error the data carries the errors and no
rotations. Each rotation also carries its effective settings at `now`: every
key of 3.5 with its value from the settings timeline (`anchor` as a datetime,
durations in short form, booleans as `true`/`false`, defaults for keys never
set) and the start of the next `set` row after `now`, if any, since later
rows change the values from there, plus the current shift (the entry covering
`now`) and the next one (first start after `now`). `now` reaches
`regenerate` as an optional input used only for status; the ledgers never
depend on it, and `S` stands in when it is absent. The `#Status` tab is this
data as text: a title line, the tabs block, then per rotation `rotation`,
`snapshot`, `horizon`, `current | <member> | until <end>` and `next |
<member> | from <start>` key/value rows in column A, the member table
indented to column B (`member`, `current` with `x` for the member on call,
`score`, `projected`, `last shift`, `next shift`, `exclusions`), and an
indented `settings` block of `key | value` rows with a `note` row when a
later `set` row exists. A warnings table follows only when there are
warnings, an errors table only when there are errors. The `#All shifts` tab
has the columns `pin | start | end | rotation | who | note`: `pin` the
ledger row's own pin text, `end` the scored end, every shift of every
rotation sorted by `start` then rotation order, and a divider row between
past and future shifts with `start` = `now` and `now` in the rotation cell
(omitted when `now` is unknown). `statusRows` and `shiftsRows` return
`{ rows, headerRows, dividerRows, currentRows }`: the row indexes of the
title, block and table header rows, of the divider and of each rotation's
current shift (empty when `now` is unknown), so adapters format them without
knowing the layout while the CLI prints rows only. Both tabs are rewritten in
full on every run, including dry runs.

### 5.9 Properties

- Deterministic: no clock in regeneration, no randomness, hash-based shuffle.
- Idempotent: generated rows are deleted and recreated from the same state.
  Running twice with the same `now`, or any `now` inside the same current
  shift, yields the same spreadsheet.
- Settings changes apply from their `set` row forward. Editing a `set` row in
  the past rescores history, which is intended.
- Pinned rows, rows before the snapshot, and the current shift are never
  touched. The current shift is editable; changing its assignee reshapes the
  future.

## 6. Errors and warnings

The script writes diagnostics into the ledger tabs as `error` rows. They are
removed on the next read, so fixing the cause and rerunning clears them.

- Validation errors: the run writes every tab back with its rows unchanged,
  with an `error` row for each offending row using the same `start`, so it
  sorts directly above the row it describes. Rotation-level errors use the
  `start` of the first row. No prune, no regeneration, no snapshot move in any
  tab.
- Unassignable slot: a `shift` with nobody plus an `error` row at the slot
  start. The empty shift keeps the interval rules intact.
- Relaxation used: text in the generated shift's `note` and in the `#Status`
  warnings table.
- Dangling link to a missing or disabled rotation tab: `error` row in
  `#Global`, link ignored.
- Malformed global `set` row: `error` row in `#Global` and no regeneration,
  like a ledger validation error.

## 7. Multiple rotations and the `#Global` tab

Rotations are tabs and can appear or disappear at any time. The `#Global`
tab is a timeline with the same column layout as a ledger that holds `set`
rows with spreadsheet-wide defaults (3.5), the relations between rotations
described here, and comments:

```
pin | start | type | what | end | duration | note
```

The tab carries the ledger header row.

- `link`: `what` is `distinct: primary, secondary` or `joined: alerts, tickets`,
  two or more distinct rotation names. Active from `start` until `end`,
  `duration`, or a matching `unlink` row.
- `unlink`: same `what`; closes every open link of the same kind and the same
  set of rotations, in any order, that is active at its `start`.

A link applies to a slot when it is active at the slot's start. Overlap is
tested on intervals, so rotations with different periods combine. `distinct`
removes from a slot's candidates any member holding a shift, kept or already
generated, that overlaps the slot in a linked rotation; it is applied before
`min_distance` relaxation and is never relaxed, so an empty candidate list
yields a `shift` with nobody and an `error` row as in 5.7. `joined` prefers,
among the candidates inside the tolerance band, the members holding an
overlapping shift in a linked rotation; when none is in the band, normal
selection applies.

Rotations are decided at equal starts in the order they first appear in the
`link` rows, top to bottom, then the remaining rotations in tab order. This
order is static for the run; it does not change when links start or end.

Link rows that fail validation (unknown type, bad `start`, malformed `what`, a
rotation name without a ledger tab, `unlink` without an active link, bad `end`
or `duration`) get an `error` row above them in `#Global` and are ignored; the
run still reports them. They do not stop regeneration, because the ledgers do
not depend on the relations being valid (global `set` rows do stop it, 3.5).
`#Global` is written back in full like a ledger when the tab exists; a dry run
writes `#Preview Global`. The sweep already walks all rotations in one merged
time order, so links add only the `#Global` reader and two candidate filters.
The `#All shifts` tab is the all-rotations view.

## 8. Code layout

```
build.sh              bundle src/ into dist/Code.js and copy the manifest
test.sh               node --test test/**/*.test.js
src/
  00_util.js          naive datetime, durations, lists, FNV-1a, CSV
  10_model.js         tab names, rows, item grammar, validation, serialization
  20_calendar.js      grid, claims, units
  30_state.js         roster, scores, exclusions, settings replay
  40_scheduler.js     prune, claims, pre-credit, sweep, selection
  50_status.js        status data, #Status and #All shifts rows
  60_links.js         #Global rows, rotation order, distinct and joined filters
  70_tools.js         template rows, Fill Shifts Grid rows, header notes
  80_runner.js        storage-agnostic run: read, advance, regenerate, write
  90_gas.js           Apps Script entry points and Sheets adapter
  appsscript.json     V8 runtime, time zone
node/
  load.js             evaluates src/*.js except 90_gas.js into one vm context
  storage.js          in-memory and CSV directory adapters
  cli.js              run, init and help commands behind bin/rotalator
bin/
  rotalator           bash wrapper: exec node node/cli.js "$@"
test/
  *.test.js           unit tests
  fixtures/<case>/    golden scenarios
dist/                 built bundle and manifest, committed; must match src/
README.md             features from the user's point of view
INSTALL.md            spreadsheet setup, clasp and manual deployment
DESIGN.md             this document
.PLAN.md              work plan
```

Rules for `src/`: no `import`/`export`, no private `#fields`, no static class
fields, no top-level code that references another file. Each file defines
classes or functions on the global scope, as Apps Script requires. The numeric
prefixes document load order and drive the bundler. Optional chaining and `??`
are used.

The core is storage-agnostic. The `Storage` interface:

```
readLedgers()   -> { [rotation]: rows[] }
readHolidays()  -> dates[]
readGlobal()    -> rows[]
ignoredTabs()   -> names[]
writeLedger(rotation, rows)
writeGlobal(rows)
writeStatus(status)
```

`90_gas.js` implements it on `SpreadsheetApp`, `node/storage.js` on memory and
CSV files. In the CSV directory `<rotation>.csv` is a rotation tab,
`holidays.csv` is `#Holidays`, `global.csv` is `#Global`, `status.json` holds
the `#Status` and `#All shifts` data and `now.txt` the run instant; a file
named `#<anything>.csv` is never a rotation, like a `#` tab. `writeStatus`
receives
the status data and writes both the `#Status` and the `#All shifts` tab;
`50_status.js` turns the data into the 2D text arrays so the adapters and the
CLI `--status` share one layout. `80_runner.js` holds the shared
`runStorage(storage, nowText, options)`: it reads through the storage, drops
blank rows, calls `advance` and then `regenerate`, fills in the tabs block, and
writes when asked. Its `rotations` option names the rotations to regenerate;
the others are read but not written, and an unknown name stops the run like a
bad `now`, with nothing written. The CLI exposes it as `rotalator run DIR
--rotation NAME`, repeatable. Each adapter only obtains `now` in the
spreadsheet time zone as `YYYY-MM-DDTHH:MM` text and converts date cells to
that form before handing them over.

Apps Script menu: `Run`, `Run - dry run` (writes `#Preview
<rotation>` tabs), `Run for current rotation`, `Run for current rotation -
dry run` (the active tab only, through the runner's `rotations` option; a
dry run then writes that rotation's preview, `#Preview Global` when a `#Global`
tab exists, and the status tabs), `Set Up Spreadsheet`, `Set Up Tab`, `Fill
Shifts Grid` (section 10), `Install nightly trigger`, `Remove trigger`. The
nightly trigger always runs all rotations. `90_gas.js` reads cells, calls the
core and writes cells; the row logic of the tools lives in `70_tools.js`.

## 9. Testing

- Unit tests: datetime parsing and formatting, durations, list grammar, units
  with skipped days, grid and claims, selection with each tiebreak, relaxation.
- Golden scenarios: a fixture directory holds `now.txt`, `holidays.csv`,
  optional `global.csv`, one `<rotation>.csv` per ledger, and
  `expected/<rotation>.csv`. The test runs the core and compares. A second run
  on the output must reproduce it exactly.
- Scenarios: fresh spreadsheet bootstrap; steady state; pin a future shift;
  swap two assignees; vacation exclusion; join with each baseline; leave and
  rejoin; team row diff; partial substitution with fill shift; stale run
  resumes at the current grid boundary; tolerance and min_distance interplay;
  shuffle determinism across runs; period change via `set`; validation errors
  produce error rows and no other change; unassignable slot; snapshot deletion
  triggers full replay; `distinct` and `joined` links between two rotations;
  a rotation disabled by a `#` prefix with a link that dangles; comment rows
  dated, attached and trailing; global defaults shared by two rotations with
  one overriding a key.

## 10. Deployment

Two paths, both in INSTALL.md.

- `clasp`: `clasp push` from the committed `dist/`. `build.sh` regenerates it
  after changes to `src/`; `test/dist.test.js` fails when the two diverge.
  `clasp` is an external tool, not a project dependency.
- Manual: create an Apps Script project bound to the spreadsheet, paste
  `dist/Code.js` and `appsscript.json`, run `onOpen` once to authorise, use the
  menu to install the nightly trigger.

INSTALL.md also provides the hand-made spreadsheet template as an appendix:
header row, ledger columns formatted as plain text, initial `set` and `team`
rows, `#Holidays` tab. The menu tools below do the same without typing.

### 10.1 Set Up Spreadsheet

`setupSpreadsheet()` is idempotent and never rewrites existing data. It
creates the missing `#Holidays`, `#Global`, `#Status` and `#All shifts` tabs
with their headers (`#Global` also gets one comment row explaining the tab),
creates `On-Call` from the rotation template when no rotation exists, and
formats every rotation tab, `#Holidays`, `#Global`,
`#All shifts` and empty non-`#` tabs: Roboto Mono on the whole tab, plain
text number format on the whole ledger columns (`A:G`), which is expected to
carry over to rows added later the way a select-all format does in the UI
(to be confirmed on a live spreadsheet), and on tabs that have their header
a bold header row on a light grey background, frozen, column widths per
column (`note` twice as wide as `what`), a note on each header cell
explaining the column and empty columns beyond the last one deleted; plus a
tab colour on `#` tabs (blue for the generated `#Status`, `#All shifts` and
previews, grey for the editable `#Holidays` and `#Global`). Tabs with content
but no ledger header are left alone. The runner keeps applying plain text to
the ranges it writes. Preview tabs are created right after the tab they
preview and never moved.

Rotation tabs and `#Global` also get conditional formatting: the tab's rules
are replaced (not appended to) by the script's set, so a user rule on these
tabs does not survive Set Up. Each rule is a custom formula over the whole
columns `A:G` keyed on the `type` cell. Rotation tabs: `error` light red,
`set` and `score` light blue, `team`, `join`, `leave`, `include` and
`exclude` light teal, `snapshot` light green, comment rows (empty type with
content, `=AND($C1="", COUNTA($A1:$G1)>0)`) light yellow, `shift` no colour.
`#Global`: `set` and `score` light blue, `link` light green, `unlink` light
grey, `error` light red, comments light yellow. Generated tabs (`#Status`,
`#All shifts`, previews) are cleared with their formats and rewritten on every
run; the adapter then
applies bold and the light grey background to the `headerRows`, light green
to the `dividerRows` and light orange to the `currentRows` reported with the
rows (5.8).

Palette: header `#eeeeee`, error `#f4c7c3`, settings `#c9daf8`, roster
`#d0e0e3`, snapshot and link and divider `#d9ead3`, current shift `#fce5cd`,
comment `#fff2cc`, unlink `#efefef`; tab colours generated `#4285f4`,
editable `#9e9e9e`.

### 10.2 Set Up Tab

`setupTab()` fills the active tab according to its name and formats it like
10.1. A non-`#` tab must
be empty, otherwise the command refuses with a toast; it gets the header, a
`set` row listing every setting explicitly at its default (`period=1w`, bare
`anchor`, `horizon=90d`, ...) dated the most recent Monday 00:00, and a
`team` row with sample names. `#Holidays` and `#Global` get their header row.
Tabs the script writes get a toast and nothing else.

### 10.3 Fill Shifts Grid

`fillShiftsGrid()` needs a selection of more than one row below the header of
a rotation tab. It fills `start` so that afterwards every selected row that is
not a comment is dated; a dated row with nothing but its `start` (and `pin`)
gets `type` = `shift`. `what`, `end` and `duration` are never written; the
other cells of existing rows travel with their rows. An undated row is either
an empty grid position (blank, or `type` = `shift` and nothing else), a
comment (empty `type` with other content), or an error: an undated row with a
`type` stops the command with a toast naming it. Dated comments are kept in
place like other non-shift rows; undated comments travel with the next dated
row below them, and trailing ones stay at the end. The grid comes from the
whole tab's `set` rows and from `#Holidays`.

Over the selected rows, `gridRows(rows, nPre, nPost, timeline)`:

1. `nPre` is the number of empty rows before the first dated row, `nPost`
   the number after the last one; empty rows between dated rows are dropped.
2. Dated rows are sorted by `start` and the 3.6 type order. Shift rows claim
   `[start, claimEnd)` exactly as in 5.4; a shift without `end` or `duration`
   claims to the next grid boundary, truncated by the next shift. Between the
   first row's `start` and the later of the last claim end and the last row's
   `start`, every uncovered span is split at grid boundaries and each piece
   becomes an empty `shift` row, so gaps and odd ends get a row at the gap
   start, like generation without assignment.
3. `nPre` empty `shift` rows are placed on the boundaries strictly before the
   first row, in the grid effective at that row. `nPost` rows start at the
   tail: the last claim end when it lies inside a period, else the boundary at
   or after the last row, then one per boundary.
4. The result is written over the selected region, which grows by the number
   of inserted rows (rows are inserted below the selection first), and the
   active range is set to the written rows.

One command therefore covers backfill, extension and gap filling. The CLI
`init` uses the same functions to create a ledger directory, optionally with
empty history rows from `--history-from` up to `--start`; the `set` and
`team` rows are then dated at the first of those boundaries so the ledger
validates (the grid is unchanged because every boundary is an anchor).

## 11. Stages

1. Core, memory and CSV adapters, CLI, tests, DESIGN.md.
2. Apps Script adapter, menu, trigger, README.md, INSTALL.md.
3. `#Status` tab and the `#All shifts` view.
4. `#Links` tab (now `#Global`) with `distinct` and `joined`.

## 12. Known limitations

- No concurrency protection. A human editing during the nightly run may have
  edits to unpinned future shifts overwritten; rows at or before the snapshot
  and pinned rows are safe.
- Cell formatting is not preserved when sorting moves a row. Values are.
- Edits to rows older than the snapshot have no effect; use `score` rows or
  delete the snapshot for a full replay.
- Period `Nm` (months) is not supported.
- Member identity is the verbatim string. Renaming a member means editing
  history or adding a `score` row.
- Only the seven ledger columns are managed. Content in further columns does
  not follow its row when the ledger is re-sorted.
- A hand-entered history shift without `end` or `duration` extends only to
  the next grid boundary, so a longer shift is credited one period.

## 13. Future extensions

- Month-based periods with day-of-month anchors.
- A `Members` tab mapping ids to names and emails for notifications.
- Calendar or PagerDuty export from the ledger.
- Concurrency guard via read-compute-reread-compare if runs ever collide with
  editing.
- A terminator `shift` row with nobody at `horizonEnd`, if a visible end of
  the schedule turns out to be wanted.
