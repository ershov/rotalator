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
owner explicitly approves one. Errors are reported in place: as script-owned
rows next to what they describe, removed and recomputed on every run, in
every tab the script reads (the ledgers, `#Global`, `#GCal`), and listed in
`#Status` as well. The core is complete on its own; optional
features (calendar export, Slack messages) ship as extensions, separate
bundles that the core probes for at call time and works without (8,
Extensions). The core only carries what the ledger grammar needs regardless
of which extensions are installed, such as the `cal` and `slack` settings and
the reserved `#GCal` and `#Slack` tabs.

## 2. Concepts

| Term | Meaning |
|---|---|
| rotation | One on-call role, one ledger tab. |
| ledger | Time-sorted rows of a rotation: shifts and events. |
| member | A person, identified by the verbatim string used in the spreadsheet. |
| roster | Ordered list of current members and their scores. |
| score | Fractional days a member has been on call, plus manual adjustments. |
| units | Days credited for an interval, honouring `skip_weekends` and `skip_holidays`. |
| period | Regular shift length: `Nd` or `Nw`. |
| grid | Instants `anchor + k*period` for all integers `k`. Regular shifts start and end on the grid. |
| slot | A time span the script must fill with a generated shift. |
| claim | The span a kept shift occupies for the purpose of regeneration. |
| snapshot | Script-owned row with the roster and scores at an instant, written for information: replay always starts at the top of the ledger. Its instant `P` bounds what the next run may rewrite (5.3). |
| current shift | The shift row starting at the snapshot instant. Kept when pinned, regenerated at the same boundary otherwise. |
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
| `#Preview <rotation>` | script | Preview output: the ledger a `Run - preview` would write, formatted like a rotation tab (10.1). |
| `#Help` | script | Plain-text help, rewritten by Set Up Spreadsheet, kept as the last tab. |
| `#GCal` | users | Calendar presets, reserved for the GCal extension (8, Extensions). The core neither reads nor shapes it. |
| `#Slack` | users and script | Slack presets and cached Slack ids, reserved for the Slack extension (14). The core neither reads nor shapes it. |
| `#Slack state` | script | What the Slack extension has posted (14.3). Created by the extension. |

Every tab whose name starts with `#` is a system tab and is never a rotation.
Any other tab whose first row is the ledger header is a rotation; anything else
is ignored. Renaming `primary` to `#primary` disables the rotation: it is
neither read nor written, relation rows naming it get an `error` row, and
renaming it back later behaves like a stale run (5.2). The
`#Status` tab starts with a block listing the rotations found, the number of
holidays and `#Global` rows read, and the tabs ignored (including
`#`-prefixed tabs that are not system tabs, so a disabled rotation is visible
there). A missing preview tab is created right after the tab it previews;
Set Up Spreadsheet keeps it there. Set Up Spreadsheet orders the tabs it
knows: the non-`#` tabs first in their existing order, each followed by its
preview tab, then `#All shifts`, `#Status`, `#Global`, `#Holidays`, the
extension tabs (`#GCal`, then `#Slack`) and `#Help` last; other `#` tabs
are not moved and end up between `#Holidays` and `#Help` (10.1).

### 3.2 Ledger columns

```
pin | start | type | what | end | duration | note
```

- `pin`: any non-empty value. Pinned rows are never modified or deleted. The
  script itself writes the `autopin` marker (3.5) into empty pin cells of past
  and near-future shifts after each run.
- `start`: `YYYY-MM-DDTHH:MM`, spreadsheet time zone, plain text. Mandatory.
- `type`: row type, see 3.4.
- `what`: the row's payload: a member, a list of items, a settings list or a
  message, depending on `type`. One item grammar for every list, see 3.3.
- `end`: `YYYY-MM-DDTHH:MM`. Optional. Mutually exclusive with `duration`.
- `duration`: e.g. `2d`, `12h`, `1d12h`, `1w`. Optional.
- `note`: free text, preserved on user rows and empty on generated rows; the
  script never writes into it (6).

The header row is fixed and is how the script recognises a ledger tab. Rows
are kept sorted by `start`; the script re-sorts on every write.

### 3.3 Value formats

- Datetime: `YYYY-MM-DD` for midnight, `YYYY-MM-DDTHH:MM` otherwise. On read
  the script also accepts a space instead of `T`, an explicit `T00:00`, and
  real date cells, which it converts using the spreadsheet time zone. It
  always writes the canonical form, so a midnight instant comes back as the
  bare date. Text sorts correctly as a string (the date is a prefix of the
  timed form and the script re-sorts anyway) and survives CSV round trips.
- Interval (`duration`, `horizon`, `min_distance`, `precredit`, suffixed
  `tolerance`): an amount followed by a unit. Clock units `w`, `d`, `h`, `m`:
  a single token may be fractional (`1.5w`, `0.5d`), integer tokens chain from
  large to small (`1d12h`). Grid units stand alone and may be fractional:
  `sl` is one shift length, the `period` in force at the instant the interval
  is applied; `ts` is the team size at that instant times the shift length,
  one full cycle (`0.5ts`, `2sl`). A plain `0` is the zero interval. Intervals
  are applied along the grid's timeline (4): `t' = instant(coord(t) + m)`,
  the plain sum in calendar mode, counted minutes in counted mode, so `2d` is
  two counted days there; from a grid instant `1sl` reaches the next boundary,
  from any other instant it is one period along the grid timeline. Clock
  intervals must come to whole minutes (`0.5h`, not `0.01d`).
- Period: an integer followed by `w` or `d`, optionally chained; `w` is `7d`.
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
| team | `name`, `name=number`, `name+=n`, `name-=n` | | users |
| join | `name`, `name=number`, one or more | | users, script |
| leave | `name`, one or more | | users |
| exclude | `name`, one or more | optional, open-ended if absent | users |
| include | `name`, one or more | | users |
| score | same forms as team | | users |
| set | `key`, `key=value` | | users |
| attract | rotation names, one or more | optional | users |
| attract! | rotation names, one or more | optional | users |
| repel | rotation names, one or more | optional | users |
| repel! | rotation names, one or more | optional | users |
| detach | rotation names, one or more | optional | users |
| snapshot | `name=score` | | script |
| error | message | | script |
| (empty) | free text | | users |

Undated rows: a `set`, `team`, `repel`, `repel!`, `attract` or `attract!`
row with an empty `start` takes the `start` of the nearest dated row above
it in the tab
as read, in document order; error rows (dropped on read), comments and other
undated rows are skipped while scanning upward. This is the first step on
read (`inheritStarts`), before validation, the prune and the sort (3.6), and
the inherited `start` is materialised: the next write puts it into the
`start` cell in canonical form, like any `start`, so from then on it is an
ordinary dated row and never drifts. It sorts at that instant by type order
(3.6), before the `shift` starting there, so a `team` row typed under the
shift of 3 March applies to that shift when the shift is unpinned and after
the snapshot. Several undated rows of one type are allowed, in `#Global`
too, and keep their document order through the stable sort: `set` values
merge in order, a later `team` row replaces the roster, relation rows
follow "latest row wins". The trap: an undated row typed at the very bottom
of a tab inherits the start of the last generated shift near the horizon,
not "now"; place it under the current shift.

Epoch rows: an undated row of those types with no dated row above it
applies from the beginning of the timeline. Internally its start is
`-Infinity`, so it sorts before every dated row (type order among epoch rows,
3.6) and compares as earlier than any instant. Epoch rows take no `end` or
`duration`. An epoch `set` row may carry every key but `anchor` (bare
`anchor` there is the error `anchor needs a dated set row`), and a `period`
in it does not anchor the grid: a dated `set` row of either layer does, or
else the rotation's first `shift` row (3.5). On replay an epoch `set` row is
a `set` row from the top, an epoch `team` row is pre-snapshot history like
any `team` row before the snapshot, and an epoch relation row is relation
state from the
beginning (`#Global` mutual, rotation tab one-sided). Other undated typed
rows are errors; undated untyped rows are comments.

**attract / attract! / repel / repel! / detach.** Relations between
rotations, see 7. In a rotation tab the row relates that rotation to each
listed rotation one-sidedly; in
`#Global` it relates all listed rotations mutually. `end` or `duration` revert
the pairs to neutral at that instant. The rows are configuration like `set`:
always read, never replayed, pruned or moved.

A row with an empty `type`, or a `type` that starts with `#` after trimming
(`#shift`, `#team`, `# set`, a bare `#`), is a comment (internal type
`comment`). The `#` prefix comments a row out the way it disables a tab: the
row is kept verbatim, type text included, so removing the `#` restores it. A
comment is never validated beyond parsing `start` (a `#shift` raises no
unknown-type error), never replayed, never pruned and never rewritten except
for sorting (3.6) and the canonical form of `start`, `end` and `duration`;
replay, generation, status, the `#All shifts` view and Fill Shifts Grid
ignore it, so commenting out a row has exactly the effect of deleting it: a
past `shift` before the stored snapshot changes nothing until the snapshot
is deleted (12), one after it leaves a span the generator fills again. A
comment whose `start` does not parse
counts as undated and produces a `#Status` warning naming the row. An
entirely blank row is dropped on read; a comment needs content in some cell.
`#Global` accepts comments the same way. In the other tabs the script reads
the same prefix comments a row out: in a preset tab (13.1) a `#` at the
start of the preset column disables the whole block and one at the start of
the setting column that row; in `#Holidays` a date cell starting with `#` is
a comment, not a bad date.

**shift.** Assigns the member in `what` from `start`. Its scored interval ends
at the explicit `end`, else at the earlier of the next `shift` row's start and
the next grid boundary strictly after `start`. The grid rule gives the final
row of the ledger a definite extent without a terminator row or an explicit
`end`, and keeps a stale ledger's last shift from being credited for the gap
before the next run; a hand-entered history shift spanning several periods
therefore needs `duration` or `end`. Its claim (see 5.4) ends at the explicit
`end`, else at the next grid boundary strictly after `start`. Unpinned shifts
starting after the stored snapshot (the previous run's snapshot row) belong to
the script and are regenerated every run, past ones included; an unpinned
shift with an empty assignee is never kept, and a pinned one is a wanted gap.
Any user edit to a
shift must be pinned or it is lost. After each run the script pins the shifts
up to `now + autopin` itself (5.8), so with the default `autopin=a:2sl` every
shift that has started and the next two regular shifts are pinned and only
the future floats. A kept shift whose assignee is not on the roster at its
start adds them: before the replay a generated bare-name `join` row is
inserted at that start (5.3), so they join there at the roster minimum like
a bare name, the shift is credited as usual, and the run writes the row,
which sorts directly above the shift (3.6). The row is the notice (no
warning) and an ordinary user row from then on, so the next run finds the
member and generates nothing; a typo in a shift therefore shows up as a
visible `join` row. A later `leave` or a `team` row omitting the person
removes them as usual. Nobody shifts are untouched.

**team.** Sets the full roster. `alice, bob, carol, dave=12, erin+=2`. The
list is diffed against the current roster: absent members leave, newcomers
join (a bare name at the roster minimum, `=number` at that score), an
existing member listed bare keeps their score, so a `team` row that re-lists
the roster to reorder it flattens nothing, `=number` sets an existing
member's score and `+=`/`-=` adjust one (a newcomer's after joining). The
list order becomes the roster order used by the `order` tiebreak.

One rule for a name without a number, across `team`, `join` and `score`: it
scores the roster minimum at that instant, the lowest projected score on the
current roster, excluded members included, zero on an empty roster. Items
apply one by one, so a later bare joiner sees the earlier one.

**join.** One or more members join: `erin, frank=12`. A bare name joins at
the roster minimum, `=number` at that score. Joining an existing member is an
error. The script writes a bare-name `join` row itself for a kept shift that
names a non-member (see `shift`).

**leave.** One or more members removed, scores discarded. A later join starts
fresh.

**exclude / include.** The listed members are ineligible from `start` until
`end`, `duration`, or a later `include` row naming them. `end` or `duration`
apply to every member listed. Score is kept and the members still count for
the roster minimum.

**score.** `alice=10, bob+=2, carol-=1, dave`. Manual corrections, e.g. for
history that is not in the ledger. Same item forms as `team`, but only the
members mentioned change and they must be on the roster; a bare `name` sets
the member to the roster minimum, re-levelling someone after a long absence.

**set.** Changes settings from `start` onward. Keys in 3.5, as `key=value` or a
bare `key`. A bare key applies the key's default behaviour: the fixed default
for most keys, and for `anchor` the row's own `start`. `anchor` never takes a
value; `period` always needs one. `set` rows are always replayed from the top
of the ledger even when older than the snapshot, so the settings history stays
in one visible place. A dated `set` row in a rotation tab that carries
`period` anchors the grid at its own `start`, whether or not the value
changes; in `#Global` a `period` sets the period only and an anchor needs
the bare `anchor` key (3.5). A `set` row that changes `period` or `grid`,
that changes `skip_weekends` or `skip_holidays` while `grid=counted`, or
that anchors off a boundary of the grid in force, cuts claims and slots at
its `start`; the grid realigns from there. A row that anchors on such a
boundary changes nothing: a `set anchor` row dated at a shift start, or an
undated `set period=...` row typed under a `shift` or `set` row, which takes
that row's start (3.4) and is written back dated. `#Status` shows the
anchor's source and instant.

**snapshot.** One per rotation, written by the script. Its instant is the
start of the current shift, see 5.2. `what` is the roster in order with scores
as of that instant: `alice=12.5, bob=11`, recorded after the state rows
dated at that instant and before the shift starting there, which is where
the row sorts (3.6). The row is informational: replay always runs from the
top of the ledger and recomputes it, nothing reads it back. Its instant `P`
is the protection boundary of the next run: rows before it are never pruned
or rewritten, the shift at it is kept, unpinned
shifts after it are regenerated and every uncovered span from it on is
filled (5.3, 5.4). No snapshot row is written for a rotation that has none
yet and an empty roster at `S` (a fresh rotation whose first roster row is
dated after `S`); the next run writes it once a roster exists. A rotation that
already has a snapshot keeps one even when its roster empties, so its
boundary survives dormancy. The script never moves the snapshot backwards.
Deleting the snapshot drops `P` for one run, which then prunes and
regenerates the unpinned shifts from `now` on as a first run does (5.3); the
next run writes a new one. To archive old history, change the snapshot
row's type to `team`: with the same `name=score` items it sets the roster
and the scores at that instant, so the rows above it, other than `set`
rows, which are replayed from the top, can be cut to another tab without
changing the schedule; `score` rows still need their members on the roster,
so corrections go below that row.

**error.** Written by the script, `what` is the message. Every `error` row is
removed on read, so they are purely diagnostic and never accumulate. See 6.

### 3.5 Settings (`set` keys)

| key | default | meaning |
|---|---|---|
| period | required | `Nd` or `Nw`; `w` is `7d`. Always `period=value`. |
| anchor | start of the `set` row, else the first `shift` | A grid instant. Also the earliest instant the schedule can begin. Written as a bare `anchor`; it takes no value and the row's `start` is the anchor. A dated rotation `set` row carrying `period` anchors there too; a global `period` never does. Without one before the first `shift` row, that shift's `start` is the anchor (implied). |
| grid | calendar | `calendar`: a boundary every `period` of wall-clock time. `counted`: a boundary every `period` of counted days, the days not skipped by `skip_weekends` and `skip_holidays` (see 4); a shift whose boundary would fall in skipped days runs through them to the next counted day. `1w` is then seven counted days and drifts across weekdays when weekends are skipped. |
| horizon | 30w | Interval. Generate slots up to the first grid boundary at or after the snapshot plus `horizon`. |
| skip_weekends | true | Saturdays and Sundays credit zero units. |
| skip_holidays | true | Dates in `#Holidays` credit zero units. |
| tolerance | 0.5sl | Candidates are members within `tolerance` of the lowest projected score. A plain number is score units (days). With a unit: `sl` is the units a regular shift earns at the slot's start honouring skips, `ts` that times the roster size, clock units nominal days (`1w` is 7). |
| min_distance | 0.5ts | Interval of rest required on both sides of a slot, `[a - D, b + D)`. `2sl` is two regular shifts; a plain number other than `0` is an error. |
| tiebreak | order | `order` or `shuffle`. |
| seed | 0 | Integer mixed into the shuffle hash. |
| precredit | 1ts | Interval after the snapshot within which pinned shifts are pre-credited: one full cycle by default. `0` disables. |
| autopin | a:2sl | `false`, or a signed interval relative to `now` (`0`, `2w`, `-2w`, `1sl`, `0.5ts`), optionally `marker:interval` (`a:2w`; the marker is everything before the last colon, default `a`, so the default is spelled `a:2sl`). After the schedule step, every `shift` row starting at or before `now + autopin` whose pin cell is empty gets the marker (5.8). |
| cal | (empty) | Space-separated names of calendar presets from `#GCal` (`cal=team backup`); a name is letters, digits, `-` and `_`, anything else is an error; single spaces on read, case kept. The core only validates and reports it: the GCal extension exports the shifts, and without it a rotation with a non-empty `cal` in force at `now` gets the `#Status` warning `calendar extension not installed`. The templates do not spell it. |
| slack | (empty) | Space-separated names of Slack presets from `#Slack` (`slack=team heads-up`), same grammar as `cal`. The core only validates and reports it: the Slack extension posts and keeps the user groups, and without it a rotation with a non-empty `slack` in force at `now` gets the `#Status` warning `slack extension not installed`. The templates do not spell it. |

A bare key restores the default in this table (`tolerance`, `tiebreak`,
`precredit`, ...); a bare `anchor` re-anchors the grid at the row's `start`
without changing the period.

Global defaults: `set` rows in `#Global` use the same grammar and are replayed
from the top like a rotation's own. The effective value of a key for a
rotation at instant `t` is the rotation's own value when the rotation has set
the key (and not returned it) by `t`, else the global value at `t`, else the
built-in default. A bare key in a rotation returns that key to the global
value from then on; a bare key in `#Global` returns it to the built-in
default. `period` and `anchor` may be set globally: a global `period` sets
the period only, never an anchor, so a global anchor needs the bare `anchor`
key, which anchors at the global row's `start` (`set period=2w, anchor`
re-anchors every rotation that takes its grid from `#Global` at that
instant); a global `set` row that changes the period in force without
`anchor` is the validation error `period change in #Global needs anchor`,
judged against the global rows alone, epoch row included, while a global row
repeating the period is a no-op. A grid change arriving from either layer
cuts claims and slots for the rotation like a local one (5.4). A
rotation that takes its grid from `#Global` starts with an empty `set` row,
the one row type whose `what` may be empty: a bare local `anchor` would pin
the anchor in the rotation, so a later global re-anchoring (`period=2w,
anchor`) would move the global layer only and leave that rotation on offset
boundaries. A global
`set` row that fails validation blocks regeneration like a ledger error, since
every rotation depends on it; set rows that do not parse are skipped when a
settings timeline is built from unvalidated rows (Fill Shifts Grid, snapshot
advance). The `#Status` settings block shows the source of each key:
`rotation`, `global` or `default`, and `implied` for an anchor taken from
the first shift.

A new rotation needs a `period` in some `set` row of the rotation or of
`#Global`, an anchor and a `team` row. The anchor is explicit (a dated
rotation `set` row carrying `period` or a bare `anchor`, or a global `set`
row with a bare `anchor`) or implied
by the rotation's first `shift` row: the grid before the first explicit
anchor is anchored at the start of the first shift, whatever its `end` or
`duration`, so any on-grid shift gives the same grid and trimming history
does not move it; explicit anchors re-anchor the grid at their `start` from
there on. With an explicit anchor and no earlier shift, its grid extends
backwards, so dated rows before the anchor are allowed and use it. A
rotation with a period but neither an explicit anchor nor a shift row is
skipped with a warning (5.1). The templates use this shape: epoch `set` and
`team` rows (3.4), then a dated `set anchor` row at the first shift start.
The
templates and `init` date it at the most recent Monday 00:00: day-aligned
boundaries keep the arithmetic simple (a shift is a
whole number of days, `skip_weekends` and `skip_holidays` cut at midnight), and
the nightly run between 02:00 and 03:00 then produces today's schedule. A
rotation that hands over during the day sets its own time in the `set` row.

### 3.6 Same-instant ordering

Rows with equal `start` sort as: comment, `error`, `set`, `attract`,
`attract!`, `repel`, `repel!`, `detach`, `team`, `score`, `join`, `leave`,
`exclude`, `include`, `snapshot`, `shift`. State changes at an instant
therefore apply before the shift starting at it, a `score` correction
applies right after the `team` row of the same instant, and the snapshot
records the roster and scores after the state rows dated at `S`, before the
shift starting there and before the pre-credit of 5.5. Sorting is stable,
so user order is kept otherwise, so several undated rows that inherited one
instant (3.4) keep their document order. Epoch rows (3.4) sort before every
dated row, in the same type order among themselves, and an undated comment
above an epoch row attaches to it and stays on top of the tab.

An undated comment attaches to the next dated row below it in the ledger as
read: its sort key becomes that row's `start` with an order just before that
row's type, resolved once when the ledger is validated and kept for the rest
of the run. The comment therefore sorts directly above the instant it was
written at even when the row below it is deleted and recreated: a comment
above a generated shift stays above the regenerated shift run after run, and a
comment above the snapshot row ends up above the shift that follows it once
the snapshot moves on. Undated comments with no dated row below them are
trailing and sort after everything. Rows the script adds (snapshot, generated
shifts, generated `join` rows, error rows) are placed in front of the kept
rows before sorting.

## 4. Scoring

Units of an interval `[a, b)` are the sum over calendar days of the fraction of
each day covered by the interval, counting only days that are not skipped. A
full week is 7 units, or 5 with `skip_weekends`. Partial substitutions credit
fractions. The score of a member is the sum of units of their shift intervals
plus manual adjustments.

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
means seven counted days and drifts across weekdays. Every interval
(`horizon`, `min_distance`, `precredit`, `duration`) is applied along the same
timeline. Scoring is identical in both modes: skipped days credit zero.

## 5. Algorithm

One run processes all rotations together. Input: the ledgers, `#Holidays`,
`#Global`, `now`, and optionally the names of the rotations to regenerate.
Output: new ledgers, status data, and a list of errors. `now` is consumed by
step 5.2 only. Everything from 5.3 on depends on the ledgers and `#Global`
alone, so `regenerate(ledgers, holidays, global, only)` is a pure function of
the spreadsheet content and can be tested without a clock.

Run scope: with `only`, rotations not listed are frozen. They are read,
validated and swept with all their rows kept as they stand (no prune, no
slots, no snapshot move), so relations still see their shifts and the
status still shows them; they are not returned for writing. A frozen rotation
with a validation error still stops the run (5.1). The tabs block of `#Status`
lists the rotations regenerated in the run.

### 5.1 Read and validate

Parse every ledger row. Drop `error` rows. Collect validation errors with row
references: unknown type, bad datetime, bad duration, both `end` and
`duration` set, `what` missing where required, an item form the type does not
accept (a `shift` with two names, `leave` with `name=1`, `anchor=value`, a
bare `period`), unknown setting key, an epoch row with `end` or `duration`
or a bare `anchor`, a global `set` row that changes the period in force
without `anchor` (`period change in #Global needs anchor`, 3.5), `join` of a
current member, `leave` or `exclude` of an unknown member. Comments are
skipped.
Before the sweep each rotation needs a grid: a `period` from any `set` row
of either layer, else the run stops, like a validation error, with `no
period in force`; and an anchor, explicit or implied by the first `shift`
row (3.5), else the rotation is skipped with the `#Status` warning `no
anchor; add a dated set anchor row here or in #Global, or a first shift`:
no snapshot advance, no generation, its tab is left exactly as it is and it
has no block in `#Status` or `#All shifts`; relations see no shifts from it
and the other rotations run normally, the run itself is not in error. Dated
rows before the anchor are allowed: the grid extends backwards to them. If
any error exists in any tab, no regeneration happens in this run; see 6.

### 5.2 Advance the snapshot

For each rotation compute the new snapshot instant `S`:

1. If a shift row contains `now` (latest shift with `start <= now`, extent
   covering `now`), `S` is its start.
2. Otherwise `S` is the grid boundary at or before `now`, in the grid
   effective at `now`.
3. `S` is raised to the `anchor` in force at `now`, explicit or implied
   (3.5), if that is later, so a rotation whose first `set` row is dated
   next Monday starts next Monday.
4. `S` is raised to the start of the first `team` or `join` row if that is
   later, so no slot is generated before there is a roster. In steps 3 and 4
   an instant inside a skipped day of a counted grid is replaced by the next
   grid boundary, so `S` never sits inside skipped days.
5. `S` is never earlier than the existing snapshot.

The snapshot row is placed at `S`. Its scores are filled in by the sweep in
5.5, which records roster and scores when it passes `S`. `S` only places the
snapshot; the span the script fills is defined by the stored snapshot `P` of
the previous run (5.4), so if the script has not run for a while the gap
between the last shift and `S` is filled like any other uncovered span and
the schedule has no holes.

### 5.3 Prune and sort

Delete unpinned `shift` rows with `start > P`, where `P` is the stored
snapshot of the previous run, and every unpinned `shift` with an empty
assignee at or after `P` (it is the script's record of an unassignable slot,
whose `error` row must come back). Without a snapshot (the first run of a
rotation) the unpinned assigned shifts before `now` are hand-typed history
and are kept, and only the unpinned shifts from `now` on are pruned; when
`now` is unknown the cut is `S`. Autopin then pins that history on the same
run and `P` protects it from the next run on; this is the one place where
the schedule depends on `now`. Everything else is kept: rows at or before
`P`, pinned shifts (including a pinned shift with an empty assignee, a wanted
gap), comments, and all user rows. The shift at the new `S` is kept only when
pinned or at `P`; otherwise it is regenerated at the same boundary, which
reproduces it unless its inputs changed. The shift starting at `P` is kept
even when unpinned and even if a roster row dated before it has since removed
its holder, so an incremental run and a full replay may differ for that one
shift; this is intended: the shift in progress at the previous run never
moves. Stable sort by `start` and the 3.6 type order. Then the implicit
joins (3.4): the roster rows and the kept shifts are replayed in that order
and every kept shift whose assignee is absent at its start gets a generated
bare-name `join` row inserted at that start. They are decided once, on the
rows as read, with the same stored snapshot and `now`, before the snapshot
advance (5.2) and before anything else reads the roster over time
(durations in `sl` and `ts`, the horizon, the autopin limit, the relation
checks), so the run that writes the rows computes exactly what the next run
reads back.

### 5.4 Claims and slots

Every kept `shift` claims `[start, claimEnd)` where `claimEnd` is the explicit
end, else the next grid boundary strictly after `start` in the grid effective at
`start`, truncated by the start of the next kept `shift` row and by any `set`
row that changes the grid. An open-ended pinned shift is one regular shift; a
longer one needs `duration` or `end`.

Regeneration range: from `fillStart` to `horizonEnd`. `fillStart` is the
stored snapshot `P` (or the grid start, if later); without a snapshot it is
the first grid boundary at or after the first `team` or `join` row, so no
slot precedes the roster, and never before the grid start (5.1): rows may
precede the anchor, slots may not. `horizonEnd` is the first grid boundary
at or after `S` plus the `horizon` interval on the grid's timeline. An `sl`
or `ts` `duration` is resolved into an `end` on the grid effective at the
row's `start`, with the roster size at that instant, before claims are
computed.

Every uncovered span inside the range is split at grid boundaries into slots,
past spans included: a stale ledger is backfilled up to `S` and beyond. The
first slot of a span may be short when it starts after a substitution or a
pinned shift with an odd end. Boundaries never move because of irregular rows.

### 5.5 Pre-credit

Pinned shifts with `start` in `(S, S')`, where `S'` is `S` plus the
`precredit` interval on the grid's timeline (`1ts`: the roster size at `S`
times the period), whose assignee is on the roster are credited when the sweep
reaches `S`, after the state rows at `S` and after the snapshot is recorded,
and skipped when the sweep reaches them; a pinned shift naming a non-member
is left to its own start, where the assignee joins and is credited (3.4).
Doing it at `S` lets a fresh ledger's `team` row dated `S` count for `ts`.
This lets someone who volunteered for a shift inside the next cycle skip a
turn before it. Pins
further out are credited when reached, and the greedy compensates afterwards.

### 5.6 Sweep

Walk all items of all rotations in `start` order, ties broken by rotation
order (the dependency order of 7, else tab order) and by 3.6. Replay begins at
the
ledger's top for every rotation: every state row is applied and every kept
shift credited from its own `start`, whatever the stored snapshot says; the
snapshot item at `S` records the roster and scores reached there (5.8).

- `set`, `team`, `score`, `join`, `leave`, `exclude`, `include`: update state.
  A bare name scores the roster minimum of the projected scores at that
  instant (3.4).
- Kept `shift`: credit units of its scored interval to its assignee, unless
  pre-credited; the assignee is on the roster, by the generated `join` row of
  5.3 if by nothing else.
- Slot: choose an assignee, credit the units, emit an unpinned `shift`.
- When the walk passes `S` for a rotation, record roster and scores for the
  new snapshot. Scores at that instant include the part of any interval before
  it. A rotation without a snapshot and with an empty roster at `S` gets no
  snapshot row (3.4).

### 5.7 Selection for a slot `[a, b)`

1. Eligible: on the roster, no exclusion overlapping `[a, b)`, not repelled
   (7, including the `repel!` rest window), and no shift of theirs, kept or
   already generated, overlapping
   `[a - D, b + D)` where `D` is the `min_distance` interval resolved at `a`
   (`sl` and `ts` with the period and roster size at `a`) and the subtraction
   and addition run along the grid's timeline.
2. Candidates: eligible members with `score <= min(score) + tolerance`, the
   tolerance resolved at `a` (3.5); when some of them are attracted (7), only
   those. When none is but an eligible `attract!` holder scores at most
   `min(score) + tolerance + 1ts` (`1ts` resolved at `a` like `tolerance`),
   the band widens to the score of the lowest such holder and the candidates
   are the eligible members inside the widened band, the attracted ones
   preferred (7, Widening for `attract!`); the warning `tolerance widened to
   <n>sl for attract! with <rotation>` records the widened width in shift
   lengths.
3. Tiebreak `order`: walk the roster cyclically starting after the assignee of
   the previous shift in this rotation and take the first candidate. With no
   previous shift, start at the top.
4. Tiebreak `shuffle`: lowest FNV-1a 32-bit hash of
   `seed|rotation|a|member`, ties by roster order.
5. Relaxation: if nobody is eligible, first shorten the `repel!` rest window
   (7) by one period per step down to zero, `D` staying in force; then
   shorten `D` by one period and retry, down to zero. At zero with nobody
   eligible, drop repel and walk `D` down again; a member chosen this way gets
   the warning `repel relaxed: <who> also on <rotation>`. Still nobody: emit a
   `shift` with nobody and an `error` row at `a`. Exclusions are never
   violated. Any relaxation used is reported in the `#Status` warnings with
   the rotation and the slot start (`repel! relaxed to 1sl`, `min_distance
   relaxed to 1sl`: the remaining distance in shift lengths); the generated
   shift's `note` stays empty.

With `tolerance = 0` and `tiebreak = order` this is plain lowest-score-first
with a stable order for ties.

### 5.8 Write

Replace the old snapshot row with the new one at `S`. Write each ledger tab in
full, sorted. Rows at or before `P` are written back unchanged apart from
sorting and the `autopin` marker below; between `P` and `now` only unpinned
shifts may change, and never rows before `P` regardless of pins. Because
generation is deterministic and a slot depends only on the rows at or before
it plus the pinned shifts within `min_distance` and the pre-credit window
after it, regenerating an unpinned span whose inputs did not change
reproduces it exactly: a past shift changes only when something that feeds it
changed (a roster row, an exclusion, a setting or a pin), never merely
because it was regenerated. No terminator row and no explicit
`end` on the last row: the last shift's extent is the next grid boundary after
its start, by the rule in 3.4, and `horizonEnd` is always a grid boundary so
the two agree.

Autopin is the last step of the output stage, after the schedule of the same
run, so previews and the CLI show it: for each written rotation the `autopin`
setting in force at `now` is resolved on the grid at `now` (`ts` with the
roster size at `now`) into a limit `now + autopin`, and every `shift` row,
kept or generated in this run, with `start <= limit`, an assignee and an
empty pin cell gets the marker; a shift with nobody stays unpinned so an
unassignable slot keeps reporting its `error` row until it is fixed or pinned
by hand as a wanted gap; rows with any non-empty pin keep theirs and no other
column changes. It needs `now`; `regenerate` without `now` pins nothing. Frozen
rotations and the error path are not written and get no pins. It has no
effect on the snapshot, the status or `#All shifts` of the run that writes
it; a second run with the same `now` writes nothing new.

The stability window: because pinned rows are never pruned, the shifts inside
`now + autopin` are kept as they stand from the next run on, so a roster or
settings change reshapes only the schedule beyond the window, and a shift the
user unpins inside the window is pinned again on the next run. Lowering
`autopin` (or `autopin=false`) is the way to let near-future shifts float
again; a negative value leaves a margin of recent shifts unpinned. With
`autopin=false` the rows between the previous snapshot and `now` may be
regenerated when unpinned; since the snapshot moves forward every run, what
lies before it is fixed either way.

Status data is built from the swept state: the run instant and mode, the
recognised tabs (rotations found, rotations regenerated in this run, holidays
and `#Global` rows read, tabs ignored),
and per rotation the snapshot instant, the stored snapshot the run started
from (`previousAt`, null on a first run), `horizonEnd`, and for each roster
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
depend on it, and `S` stands in when it is absent. The status also carries
the relation states in force at `now` as `{ reader, target, kind }` entries
for every ordered pair, a mutual state appearing twice, and every shift of
every rotation as `{ start, end, rotation, who }` with its scored extent. The
`#Status` tab is this data as text, 17 columns wide: a title line; a `Tabs`
block of key/value rows; a `Relations` matrix with one column and one row per
rotation in tab order, `+` where the row's rotation attracts the column's and
`-` where it repels it (mutual states fill both cells, one-sided ones only the
reader's row), omitted with a single rotation or without relations; then per
rotation
one horizontal block of three column groups separated by two empty columns:
the key/value rows `rotation`, `snapshot`, `horizon`, `current | <member> |
until <end>` and `next | <member> | from <start>` (columns A to C), the
member table (`member`, `current` with `x` for the member on call, `score`,
`projected`, `last shift`, `next shift`, `exclusions`, columns F to L) and
the settings table (`settings | as of <now> | source`, then `key | value |
source` rows and a `note` row when a later `set` row exists, columns O to
Q), groups padded to the tallest and the block's first row serving as the
header of all three. The CLI `--status` prints the same data vertically: the
three groups of each rotation one after another, tables indented by one
cell, as `statusRowsVertical` arranges them from the shared group builder. A
warnings table follows only when there are warnings, an errors table only
when there are errors, then the block of each installed extension that
renders one (`<prefix>_status`, 8). The `#All shifts` tab is a grid: header
`start |
<rotation> | ...` in tab order, one row per distinct shift start across all
rotations, sorted; a rotation's cell holds the assignee of the shift starting
at that instant, `-` for a nobody shift, and stays empty when that rotation
does not change then. Comments are not shifts and do not appear. A now row
with `start` = `now` and `--now--` in every rotation column separates past
from future, placed after any row with the same start (omitted when `now` is
unknown). `statusRows` and `shiftsRows` return `{ rows, headerRows,
dividerRows }`: the row indexes of the title, `Tabs` and `Relations` headers,
each rotation block's first row, the warnings and errors headers and the
`#All shifts` header, and of the now row, plus `errorRows` and
`warningRows`, the data rows of the errors and warnings tables and the
error and warning rows extension blocks report (8); `shiftsRows` adds
`currentCells`,
the `{ row, col }` (0-based) of each rotation's shift covering `now` (the
same rule as `current`), empty when `now` is unknown, and `errorCells`, the
`{ row, col, note }` of the shifts that do not meet a relation in force (7,
Unmet relations), the note naming each relation and partner (`repel with
P`; several joined with `; `); the adapter paints them like error rows and
sets the note; a current cell is set in bold, whether or not it is also
red. Adapters format them without knowing the layout while the CLI prints
rows only. Both tabs are rewritten in full on every run, previews included.

### 5.9 Properties

- Deterministic: no clock in regeneration, no randomness, hash-based shuffle.
- Idempotent: generated rows are deleted and recreated from the same state.
  Running twice with the same `now`, or any `now` inside the same current
  shift, yields the same spreadsheet.
- Settings changes apply from their `set` row forward. Editing a `set` row in
  the past rescores history, which is intended.
- Pinned rows, rows before the stored snapshot and comments are never
  rewritten; editing them changes the scores and the unpinned future on the
  next run, since replay starts at the top. The current shift is
  regenerated at the same boundary when unpinned; pin an edit to it and the
  future reshapes around it.

## 6. Errors and warnings

The script writes diagnostics into the ledger tabs as `error` rows. They are
removed on the next read, so fixing the cause and rerunning clears them. The
same rule holds for every tab the script reads (section 1): `#Global` and,
through its extension, `#GCal`. User-editable cells carry user input only:
the script never writes into the `note` or `what` of a user row, and
generated shifts get an empty `note`; its only rewrites are error rows, the
canonical form of `start`, `end` and `duration`, the inherited `start` (3.4),
the `autopin` marker in an empty `pin` cell (5.8) and the `join` row it adds
for a kept shift naming a non-member (3.4). Warnings therefore
live in `#Status` only. Every run ends with the counts in the toast
(`finished with N error(s) and M warning(s)`, or `finished, no errors`),
covering core and extension errors alike (10.4), and logs one line per error
and per warning (`error: <text>`, `warning: <rotation> <start>: <message>`;
`runLogLines`): to the Apps Script executions log from the menu and the
trigger, to stderr from the CLI `run`, whether or not `--status` is given.
The extension menu actions log their errors and stop notes the same way.

- Validation errors: the run writes every tab back with its rows unchanged,
  with an `error` row for each offending row using the same `start`, so it
  sorts directly above the row it describes. Rotation-level errors use the
  `start` of the first row. No prune, no regeneration, no snapshot move in any
  tab.
- Unassignable slot: a `shift` with nobody plus an `error` row at the slot
  start. The empty shift keeps the interval rules intact.
- Relaxation used: a `#Status` warning naming the rotation and the slot
  start; nothing in the ledger.
- Relation row naming a missing or disabled rotation, itself, or a rotation
  twice, or part of an order cycle: `error` row above it in its own tab, row
  ignored, run continues.
- Malformed global `set` row: `error` row in `#Global` and no regeneration,
  like a ledger validation error.

Audit of every error and warning a run can produce, where it is written in
place and where it is only reported in `#Status` (and why):

| message | in place | `#Status` |
|---|---|---|
| Validation errors of 5.1 (`unknown type`, `bad start`, `bad duration`, `shift takes exactly one member id`, `unknown setting`, ...) | `error` row above the row, same `start`, in the ledger or `#Global` | errors |
| `<rotation>: ledger is empty`, `no period in force` | `error` row at the top of the ledger (no `start`) | errors |
| Replay errors (`join: "x" is already a member`, `leave: unknown member`, `exclude`/`include`/`score` on an unknown member, `team: duplicate member`) | `error` row above the row | errors |
| Relation row errors (unknown or disabled rotation, itself, twice, `#Global` shape, `relation order cycle`) | `error` row above the row in its own tab | errors |
| Malformed global `set` row, `period change in #Global needs anchor` | `error` row in `#Global`; blocks regeneration | errors |
| `no eligible member for shift <a> to <b>` | `error` row at the slot start, next to the `shift` with nobody | warnings |
| `no anchor; add a dated set anchor row here or in #Global, or a first shift` | none: the rotation is left as it is (5.1) | warnings |
| `tolerance widened to <n>sl for attract! with <rotation>` | none: `#Status` warnings only (rotation and slot start) | warnings |
| `min_distance relaxed to ...`, `repel! relaxed to ...`, `repel relaxed: <who> also on <rotation>` | none: `#Status` warnings only (rotation and slot start); the `note` stays the user's | warnings |
| `comment row N: unparseable start, treated as undated` | none: comments are never rewritten and the row stays where it is | warnings |
| `calendar extension not installed; cal=... has no effect`, `slack extension not installed; slack=... has no effect` | none: no extension is there to write it | warnings |
| `<Name> extension: <message>` (a hook threw, 8) | none: no source row | errors |
| `bad now`, `holidays row N: bad date` (a `#` date cell is a comment, not a bad date), `unknown rotation` | none: the run stops before writing; toast, log, CLI stderr | none (no status) |
| `another Rotalator run is in progress` | none; toast and log | none |
| `#GCal` preset errors (13.1) | `error` row above the offending `#GCal` row | Calendar block errors |
| `unknown preset "p" in cal; add it to #GCal` | `error` row above the `set` row carrying `cal` at `now`: in the rotation tab, or in `#Global` prefixed with the rotation | Calendar block errors, run errors |
| `preset "p" skipped: calendar <id> is already used by preset "q"` | same as above | same |
| `preset "p" skipped: <its errors>` | in `#GCal` through the preset's own error rows; not repeated at the `cal` row | Calendar block errors, run errors |
| `calendar "<id>" not found or not shared with this account`, API failures per calendar | `error` row above the preset's `id` row in `#GCal` (the preset row without one), written after the export | Calendar block errors, run errors |
| `aborted after N event(s)`, `time budget reached ...` (10.4) | none: transient, nothing to fix in a tab | warnings (once; the Calendar block repeats it in its toast only) |
| `#Slack` preset errors (14.1) | `error` row above the offending `#Slack` row | Slack block errors, run errors as `Slack <where>: <message>` |
| `unknown preset "p" in slack; add it to #Slack` | `error` row above the `set` row carrying `slack` at `now`: in the rotation tab, or in `#Global` prefixed with the rotation (14.4) | Slack block errors, run errors |
| `preset "p" skipped: <its errors>` (slack) | in `#Slack` through the preset's own error rows; not repeated at the `slack` row | Slack block errors, run errors |
| `group @x: nobody on call in <rotation>`, `group @x: nobody on call, left as it is` (14.3) | none: nothing to fix in a row | warnings |
| Slack delivery failures per destination, group or member (14.4) | `error` row above the preset's `to` row (a destination that does not resolve, a member without an id, a failed post) or above the `group` row of the first preset naming the group (a group failure), with the cause in brackets | Slack block errors, run errors as `Slack <where>: <message>` |
| `group @x: member "m" has no Slack id; ...`, `group @x: no member has a Slack id, left as it is` (14.4) | none: the member has no row of its own | warnings |
| Menu-action failures: a clean that cannot open a calendar, `unknown rotation`/`unknown preset`/`preset has errors` from a clean, `N error(s), nothing exported` from a re-export, an extension `setup` failure named in the Set Up toast | none: no run result and no row to attach to | none; toast and log |

## 7. Multiple rotations and the `#Global` tab

Rotations are tabs and can appear or disappear at any time. The `#Global`
tab is a timeline with the same column layout as a ledger that holds `set`
rows with spreadsheet-wide defaults (3.5), relation rows between rotations,
and comments:

```
pin | start | type | what | end | duration | note
```

The tab carries the ledger header row. Relation rows also appear in rotation
tabs. Four types, `what` a plain list of rotation names:

- `repel`: members holding a shift that overlaps the slot in a related
  rotation are removed from the slot's candidates.
- `repel!`: like `repel`, and the member is also kept off the slot while
  their shift in the related rotation lies within a rest window around it
  (below).
- `attract`: among the candidates inside the tolerance band, members holding
  an overlapping shift in a related rotation are preferred.
- `attract!`: like `attract`, and when no preferred member is inside the band
  the band may widen to reach one (below).
- `detach`: the pairs return to neutral.

### State per pair

Relations are states of unordered pairs of rotations over time. Each row sets
the state of every pair it names from its `start`; the latest row wins per
pair, and `end` or `duration` revert the pair to neutral at that instant. A
pair holds at most one relation at a time. In `#Global` a row names all pairs
among the listed rotations, mutually. In rotation A's tab a row names the
pairs (A, x) one-sidedly: A reads x, so A's slots are filtered or steered by
x's shifts while x is unaffected. Mutual and one-sided rows set the same pair
state, with the direction recorded; a later one-sided row therefore replaces
an earlier mutual one for that pair and vice versa. At equal instants an end
applies before a start, `#Global` rows are applied before rotation rows, and
rotation rows in tab order, so the last one wins. Two rotation tabs that start
the same one-sided relation on each other at the same instant make the pair
mutual from that instant.

A relation applies to a slot when it is in force at the slot's start, or
when it comes into force inside the slot (the state just before the slot's
end then counts; `kindForSlot`): a `repel` row dated mid-week on a fresh
setup therefore applies to the slot containing `now`, whose shift is
regenerated anyway, and not only from the next slot on; a relation that ends
inside a slot still applied at its start, and one that replaces another
inside a slot (`attract` at the start, `repel` from Wednesday) leaves the
start's kind in charge of that slot and applies from the next slot on. The
same rule marks unmet relations (below). Overlap
is tested on `[start, scored end)` intervals, so rotations with different
periods combine. A rotation only sees shifts already decided when its slot is
chosen: kept shifts, and generated shifts of rotations decided earlier at the
same instant. A one-sided `repel` is therefore complete only when the reading
rotation's grid is at least as fine as the grid it reads: a weekly rotation
reading a daily one sees, for its Monday slot, only the Monday of the daily
rotation and may still collide with its Tuesday.

### Widening for `attract!`

`attract` keeps fairness first: it only chooses among the members the
tolerance band already allows, so two rotations drift apart as soon as an
exclusion or a pin desynchronises them, and the preference then misses
until the scores happen to realign. `attract!` lets the band give way, within
a cap: once eligibility (exclusions, `min_distance` at the current ladder
step, the repel filters) and the band are known and no preferred candidate
is in band, the eligible `attract!` holders whose projected score is at most
`lowest eligible + tolerance + 1ts` are considered, `1ts` resolved in this
rotation's grid at the slot start like `min_distance`; the band widens
directly to the score of the lowest-scoring such holder (no stepping
constant) and the pick proceeds inside the widened band with the usual
preference and tiebreak. With no eligible `attract!` holder, `attract!`
behaves as `attract`. Widening never relaxes exclusions, `min_distance` or
repel: it is a preference step and takes part in the relaxation ladder
exactly where the `attract` preference does. The cap is relative to the
configured tolerance and amounts to one extra team round: the holder may be
at most a full cycle ahead of the lowest member, the debt is repaid
afterwards because the member left behind stays lowest and gets the next
shifts the relation allows. The simulation behind the feature cut attract
misses by 50 to 100 percent at a spread cost of at most 0.06 shift lengths.
The warning `tolerance widened to <n>sl for attract! with <rotation>` names
the related rotation of the holder the band widened for and the widened band
width in shift lengths (5.7).

### Rest across rotations (`repel!`)

`repel!` extends the overlap test of `repel` by a rest window: for a slot
`[a, b)` in rotation A and a related rotation B, a member is excluded when
they hold a shift in B overlapping `[a - D, b + D)`, where `D = (D_A + D_B) /
2`. `D_A` and `D_B` are the two rotations' `min_distance` settings at `a`,
each resolved in its own grid space (`sl` and `ts` with that rotation's period
and roster at `a`) to minutes, averaged, and the window is laid out along A's
grid with `offset` (4). Plain `repel` is the same rule with `D = 0`. For a
mutual row both sides compute the same average, so each rotation keeps its
members off the other for half the combined rest before and after their shift;
a one-sided row applies the window to the reader only. Half of each side's
rest is the compromise that respects both rotations' expectations without
letting the stricter one dictate the other's schedule; the alternative of
taking the smaller of the two distances was rejected because it lets a
rotation with `min_distance=0` cancel the rest of the other entirely.

When the window leaves no candidate, relaxation proceeds in this order: the
window shrinks by one period of A per step down to zero, `min_distance`
staying in force, with the warning `repel! relaxed to <remaining>` in shift
lengths (`0` at plain repel); then `min_distance` is relaxed as in
5.7; then repel is dropped with its warning; then nobody. Overlapping shifts
across the two rotations therefore stay forbidden until the third step, like
plain `repel`.

### Order at equal starts

At equal starts rotations are decided in dependency order: a rotation comes
after every rotation it reads; everything else, including rotations related
mutually by a `#Global` row, follows tab order. Only one-sided rows create
dependencies, and only the pair states that are or will be in force from the
earliest snapshot of the run on (per pair, the last state at or before it and
every later one); rows that ended or were superseded before that order
nothing. The order is static for the run. Two tabs reading each other, at any
time in that range, form a cycle that cannot be ordered: each row involved
gets an `error` row above it (`relation order cycle among ...; use a #Global
row`), its relations are ignored, and the order is computed without them. The
cycle test is coarse: a rotation on a dependency path between two cycles
counts as part of them. The `#Status` relations matrix marks `attract` `+`,
`attract!` `+!`, `repel` `-` and `repel!` `-!`.

### Soft repel

`repel` is relaxed only after `min_distance`: the candidate search first
walks the `repel!` window down (above), then `min_distance` down to zero with
repel in force, then the `min_distance` ladder once more without repel, and
only then gives up with a `shift` for nobody and an `error` row (5.7). A
member chosen without repel gets the `#Status` warning `repel relaxed:
<who> also on <rotation>`. Exclusions are never relaxed. `attract`
needs no relaxation.

### Errors

Relation rows that fail validation (unknown or disabled rotation, a rotation
naming itself, a name listed twice, fewer than two names in `#Global`, a type
other than `set`, relation or comment in `#Global`, bad `start`, `end` or
`duration`) get an `error` row above them and are ignored; the run reports
them but continues, because the ledgers do not depend on the relations being
valid (global `set` rows do stop it, 3.5). `#Global` is written back in full
like a ledger when the tab exists; a preview reads it as usual and writes
nothing for it (its errors still reach `#Status`). The
sweep already walks all rotations in one merged time order, so relations add
only the pair states, the order and two candidate filters. The `#All shifts`
tab is the all-rotations view.

### Unmet relations in `#All shifts`

After the sweep every decided shift is checked against the pair states in
force at its start (`markUnmetRelations`), kept shifts and history before
the stored snapshot included, and the shifts that break one are painted red
in `#All shifts` with a note naming the relation and the partner (5.8). For
a shift of rotation R held by `h` over `[a, scored end)` and a pair (R, P)
whose relation is in force at `a` for R as reader (a one-sided row marks the
reader's cell only; a mutual one lets each side evaluate and mark its own
cell): `repel` and `repel!` are not met when `h` holds a shift in P
overlapping the interval, the same name in both cells (a `repel!` rest
window miss is not painted); `attract` and `attract!` when an overlapping shift
in P is held by `p != h` while `p` could hold R's shift (on R's roster at
`a`, not excluded there) and `h` could hold P's (on P's roster at `a`, not
excluded there), so a vacation on either side does not paint; the roster is
replayed from the top, so every shift is judged against the roster of its
own time. In the grid a red shift paints its
continuation too: the empty cells below it in its column at rows whose start
lies inside `[start, scored end)`, with the same note, past the now row and
up to the shift's own end, never into the next shift. Shifts for
nobody are never painted. The relations are the ledger's own rule set, so
the cells point at the places where a relaxation, a pin or a hand edit made
the schedule deviate; nothing is written to `#Status` for them.

## 8. Code layout

```
build.sh              dist/Code.js from src/ after Setup(), the manifest,
                      dist/<Name>.js from each src/ext/<Name>/
test.sh               node --test test/**/*.test.js
src/
  00_util.js          naive datetime, durations, lists, FNV-1a, CSV
  10_model.js         tab names, rows, item grammar, validation, serialization
  20_calendar.js      grid, claims, units
  30_state.js         roster, scores, exclusions, settings replay
  40_scheduler.js     prune, claims, pre-credit, sweep, selection
  50_status.js        status data, #Status and #All shifts rows
  60_relations.js     #Global rows, pair states, sweep order, repel, attract
  70_tools.js         template rows, Fill Shifts Grid rows, header notes
  72_presets.js       preset tab grammar, message templates and set-row error placement shared by extensions
  75_extensions.js    extension names and hook probing
  80_runner.js        storage-agnostic run: read, advance, regenerate, write
  90_gas.js           Apps Script entry points and Sheets adapter
  appsscript.json     V8 runtime, time zone
  ext/<Name>/*.js     one optional extension per directory (below)
  ext/GCal/
    10_presets.js     #GCal settings and presets, gcal_readInputs
    20_format.js      strftime subset, title and body templates
    30_plan.js        export, repair and clean plans
    40_status.js      status block data, gcal_status
    50_calendar.js    CalendarApp reconcile and clean, gcal_afterRun
    60_menu.js        menu actions, gcal_menu, gcal_setup, gcal_help
  ext/Slack/
    10_presets.js     #Slack settings, destinations and offsets, slack_readInputs
    20_plan.js        due messages and group membership
    30_status.js      status block data, slack_status
    40_api.js         Slack Web API over UrlFetchApp, id resolution
    50_run.js         post, update groups, write state, slack_afterRun
    60_menu.js        token, test message, slack_menu, slack_setup, slack_help
node/
  load.js             evaluates src/*.js except 90_gas.js into one vm context,
                      plus the extensions asked for
  storage.js          in-memory and CSV directory adapters
  cli.js              run, init and help commands behind bin/rotalator
bin/
  rotalator           bash wrapper: exec node node/cli.js "$@"
test/
  *.test.js           unit tests
  fixtures/<case>/    golden scenarios
dist/                 built bundles and manifest, committed; must match src/
README.md             project page: pitch, example, quick start, doc map
MANUAL.md             user manual: tabs, rows, settings, menu, tasks, CLI
INSTALL.md            spreadsheet setup, clasp and manual deployment
DESIGN.md             this document
.PLAN.md              work plan
```

Rules for `src/`: no `import`/`export`, no private `#fields`, no static class
fields, no top-level code that references another file. Each file defines
classes or functions on the global scope, as Apps Script requires. The numeric
prefixes document load order and drive the bundler. Optional chaining and `??`
are used. Extension files under `src/ext/` follow the same rules.

### Extensions

The core is complete on its own. An optional feature is an extension: a
directory `src/ext/<Name>/*.js` that `build.sh` concatenates, with the same
separator lines as the core and without the `Setup` prelude, into
`dist/<Name>.js`, a second file to install next to `Code.js`. The core keeps
the fixed list `EXTENSIONS` (`GCal`, `Slack`) in `75_extensions.js` and knows an
extension only by the global functions it may define, `<prefix>_<hook>`, where
the prefix is the lower-case name (`gcal_menu`). Nothing registers at load
time: at each call site the core asks `extensionHooks(hook)` for the
`{ name, prefix, fn }` of every listed extension whose function exists, a
`typeof` probe on the shared global scope at call time (Apps Script and the
Node loader share one scope, and `typeof` on an undeclared name does not
throw), so file load order never matters and a missing hook is skipped.
`callExtensionHooks(hook, args, onError)` calls them in order and returns the
values of the calls that returned; `extensionInstalled(name)` is true when
any hook is defined. An extension error never fails the core: an exception in
a hook is caught, that extension is skipped, and the failure is reported as
`<Name> extension: <message>`, as an error of the run and a row of the
`#Status` errors block for `readInputs`, `afterRun` and `status`, as a console
line for `menu` and `help`, and as a console line plus a mention in the final
toast for `setup`. A `readInputs` failure also skips that run's `afterRun`.

| hook | called from | contract |
|---|---|---|
| `<prefix>_menu(menu)` | `onOpen` | Adds items to the Rotalator menu after the core items, before `addToUi`. |
| `<prefix>_setup(ss)` | Set Up Spreadsheet | Creates and formats the extension's own tabs, after the core tabs and before `#Help` is moved last. |
| `<prefix>_setupTab(sheet)` | Set Up Tab, before the core's own handling | Returns `true` when the extension filled or refused the active tab itself (its own tabs); anything else leaves the tab to the core. |
| `<prefix>_help(lines)` | `helpText()`, used by Set Up Spreadsheet for `#Help` | Receives a copy of `HELP_TEXT` and returns extra lines appended after it (a line ending with `:` is a heading); anything but an array adds nothing. |
| `<prefix>_readInputs(storage)` | `runStorage`, before `advance` and `regenerate` | Reads the extension's inputs through the storage (a tab, a CSV file); the value is kept as `result.ext[prefix]`. |
| `<prefix>_afterRun(result, storage, options)` | `runStorage`, when the run had no errors | After the ledgers and `#Global` are written (when writing) and before the status tabs; `result` is the runner's result including `ext`, and whatever the hook records in `result.status` (by convention under `status.ext[prefix]`) reaches `<prefix>_status`. `options` tells write and mode, so a preview stays a preview. |
| `<prefix>_status(status)` | `statusRows`, `statusRowsVertical` | Returns `{ rows, headerRows, errorRows, warningRows }` (cell arrays; the index lists point into `rows`, `headerRows` default the first row) appended to `#Status` after the errors table, preceded by a blank row; rows are padded or cut to the tab's 17 columns; error and warning rows are painted like the core's; null or no rows add nothing. |

Core helpers for extension actions (10.4): `withLock(fn)` runs a menu action
under the script lock with the abort flag cleared and the run guard armed;
`currentRunGuard()` gives `stopReason()` and `elapsedSeconds()` for loops that
may run long; `stopNote(reason, done, what)` is the standard text. In Node
the guard never stops. For their tabs, `placeTabAfter(ss, sheet, anchor)`
moves a tab directly after another once and `formatPresetTab(sheet, widths,
rules)` formats a preset tab like an editable system tab (13.5); each
extension passes only its constants.

The core carries the pieces of the grammar an extension needs regardless of
whether it is installed, so a ledger validates the same way with and without
it: the `cal` and `slack` settings (3.5), the `#GCal`, `#Slack` and `#Slack
state` tabs as known system tabs (not rotations, not listed under ignored, not
shaped by Set Up: `tabLayout` leaves them to the extension), and the warnings
`calendar extension not installed` and `slack extension not installed` that
`runStorage` adds to the status when a rotation has a non-empty `cal` or
`slack` in force at `now` while `extensionInstalled` says no for that
extension. Extensions never call each other: either may be absent. What two
extensions share lives in the core, in `72_presets.js`: the preset tab
grammar `parsePresetTab(rows, settings, { tab, placeholders, check })` and
its error write-back `presetRowsWithErrors(rows, errors)` (13.1), and the
template formatter `formatTemplate(template, values)` with
`templateErrors(template, field, names)` (13.2), and the in-place write of
the errors a setting's value causes, `writeSettingErrors(result, storage,
errors, key)` over `cellsWithSettingErrors(cells, now, key, messages)`
(13.4, 14.4). `settings` is the table `{
key: { parse, def, hint, template, required } }`; `tab` labels the `where`
text, `placeholders` are checked in `template` settings, a `required`
setting left unset is reported on the preset row, and `check(preset)` may
return one more message for the preset row. `formatTemplate` takes the keys
of `values` as the allowed placeholders and formats `start` and `end` as
instants. GCal and Slack call them with their own settings tables and
placeholder lists. `node/load.js` takes an
optional list of extension names: `load(['GCal'])` evaluates
`src/ext/GCal/*.js` into the same context after the core, once per process,
so a test that loads an extension shares it with the CLI in that process; the
tests and the golden runs load the core alone by default.

The core is storage-agnostic. The `Storage` interface:

```
readLedgers()   -> { [rotation]: rows[] }
readHolidays()  -> dates[]
readGlobal()    -> rows[]
ignoredTabs()   -> names[]
readTabRows(name, header) -> rows[]   (extension tabs; [] without tab or header)
writeTabRows(name, header, rows)      (mirror; creates a missing tab; no-op when read-only)
writeLedger(rotation, rows)
writeGlobal(rows)
writeStatus(status)
```

`90_gas.js` implements it on `SpreadsheetApp`, `node/storage.js` on memory and
CSV files. In the CSV directory `<rotation>.csv` is a rotation tab,
`holidays.csv` is `#Holidays`, `global.csv` is `#Global`, `gcal.csv` is
`#GCal`, `slack.csv` is `#Slack`, `slack-state.csv` is `#Slack state`,
`status.json` holds
the `#Status` and `#All shifts` data and `now.txt` the run instant; a file
named `#<anything>.csv` is never a rotation, like a `#` tab. `writeStatus`
receives
the status data and writes both the `#Status` and the `#All shifts` tab;
`50_status.js` turns the data into the 2D text arrays so the adapters and the
CLI `--status` share one layout. `80_runner.js` holds the shared
`runStorage(storage, nowText, options)`: it reads through the storage, drops
blank rows, calls `advance` and then `regenerate`, fills in the tabs block, and
writes when asked. Its result is `{ ledgers, read, global, errors, status,
ext }`: `ledgers` the regenerated rotations as written, `read` every rotation
as read (frozen ones included, so an extension needs no second read),
`global` the `#Global` rows or null, `ext` the values of the `readInputs`
hooks. Its `rotations` option names the rotations to regenerate;
the others are read but not written, and an unknown name stops the run like a
bad `now`, with nothing written. The CLI exposes it as `rotalator run DIR
--rotation NAME`, repeatable. Each adapter only obtains `now` in the
spreadsheet time zone as `YYYY-MM-DDTHH:MM` text and converts date cells to
that form before handing them over.

Apps Script menu: `Run`, `Run - preview` (`previewRun`: writes `#Preview
<rotation>` tabs and the status tabs, nothing for `#Global`; the runner's
`mode` is `preview`), `Run for current rotation`, `Run for current rotation -
preview` (`previewRunCurrent`: the active tab only, through the runner's
`rotations` option; the preview then writes that rotation's preview tab and
the status tabs), `Set Up Spreadsheet`, `Set Up Tab`, `Fill
Shifts Grid` (section 10), `Install nightly trigger`, `Remove trigger`, then
the items of each installed extension (`<prefix>_menu`, Extensions above);
`Abort run` follows the run items (10.4). The
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
  swap two assignees; vacation exclusion; join at the roster minimum and
  with a number; leave and rejoin; team row diff; partial substitution with
  fill shift; stale run resumes at the current grid boundary; tolerance and
  min_distance interplay;
  shuffle determinism across runs; period change via `set`; validation errors
  produce error rows and no other change; unassignable slot; snapshot deletion
  triggers full replay; mutual `repel` and `attract` between two rotations, a
  one-sided `repel`, a `repel` relaxed with its warning; a rotation disabled
  by a `#` prefix with a relation row that dangles; comment rows
  dated, attached and trailing; global defaults shared by two rotations with
  one overriding a key.

## 10. Deployment

Two paths, both in INSTALL.md.

- `clasp`: `clasp push` from the committed `dist/`. `build.sh` regenerates it
  after changes to `src/`; `test/dist.test.js` fails when the two diverge.
  `clasp` is an external tool, not a project dependency.
- Manual: create an Apps Script project bound to the spreadsheet, paste
  `dist/Code.js` and `appsscript.json`, run `Setup` once to authorise, use the
  menu to install the nightly trigger. Each wanted extension is one more file
  pasted from `dist/<Name>.js`.

`build.sh` prepends `function Setup() { onOpen(); }` with a two-line comment
to the bundle so that the first function in the Apps Script editor's list
installs the menu and triggers authorisation; `src/` has no such function
and `test/dist.test.js` mirrors the prelude byte for byte. Extension bundles
get no prelude. `test/dist.test.js` checks every bundle, `dist/Code.js` and
one `dist/<Name>.js` per `src/ext/<Name>/` directory, and fails on a stale
bundle in `dist/` whose directory is gone; with no extension directory it
checks the core bundle alone.

INSTALL.md also provides the hand-made spreadsheet template as an appendix:
header row, ledger columns formatted as plain text, initial `set` and `team`
rows, `#Holidays` tab. The menu tools below do the same without typing.

### 10.1 Set Up Spreadsheet

`setupSpreadsheet()` is idempotent and never rewrites existing data. It
creates the missing `#Holidays`, `#Global`, `#Status` and `#All shifts` tabs
(`#Holidays` and `#Global` from their templates of 10.2), creates `Rotation 1
Primary` from the rotation template when no rotation exists, rewrites the
`#Help` tab from `HELP_TEXT` in `70_tools.js` (one line per row in column A,
first row bold, column width 900, tab colour light cyan 1 `#76a5af`, no
conditional rules, columns beyond A removed) and moves it to the last
position, orders the tabs (`orderCoreTabs`, 3.1): every non-`#` tab first in
its existing order, each followed by its `#Preview` tab, then `#All shifts`,
`#Status`, `#Global`, `#Holidays`, each moved only when it is not already
directly after the previous one, so `#` tabs the core does not know are
never moved and end up after that block; then calls each installed
extension's `<prefix>_setup(ss)` (8, Extensions), which place `#GCal`
directly after `#Holidays` and `#Slack` after `#GCal` (13.5, 14.5), before
`#Help` is placed last; sets the spreadsheet theme font to Roboto Mono once
when the spreadsheet has a theme (`getSpreadsheetTheme()` is null
otherwise), so cells, tabs and columns without an explicit font default to
it, flushes the pending inserts and moves (`SpreadsheetApp.flush()`) before
enumerating the tabs, and formats every rotation tab, `#Holidays`,
`#Global`, `#All shifts` and empty non-`#` tabs: Roboto Mono and top-left
alignment on the whole
columns present (`A:<last column>`, `setVerticalAlignment('top')` and
`setHorizontalAlignment('left')`, re-applied by `writeTextCells` on every
range the script writes, since generated tabs are cleared with their
formats), wrapped text (`setWrap(true)`) on the same columns of the tabs
with the ledger layout (rotation tabs, previews, `#Global`) and of
`#Holidays`, not of `#Status` and `#All shifts`, plain text number format on
the whole ledger columns (`A:G`), and on tabs that have their header a bold
header row on a light grey
background, frozen, column widths per column (`note` twice as wide as
`what`), a note on each header cell explaining the column and empty columns
beyond the last one deleted; plus a tab colour on `#` tabs (blue for the
generated `#Status`, `#All shifts` and previews, grey for the editable
`#Holidays`, `#Global` and `#GCal`). Sheets extends whole-column formats to
rows added later, which is why the font, alignment and plain text go on
whole columns rather than the bounded grid. Tabs
with content but no ledger header are left alone; `#GCal` is placed and
formatted by the GCal extension (13.5). A tab the service cannot format (a
`Sheet` handle that no longer resolves, `Sheet <id> not found`, seen on a
freshly copied spreadsheet) is skipped: the message is logged with the
`error:` prefix (6) and named in the final toast, and the rest of the setup
completes; running Set Up Spreadsheet again formats it. The runner keeps
applying plain text to the ranges it writes. Preview tabs are created right
after the tab they preview and never moved, and get the rotation tab
formatting in full: the writer calls `formatTab` after writing a preview
(`tabLayout` gives preview tabs the ledger layout) and Set Up formats them
the same way, so plain text on `A:G`, the bold grey frozen header with widths
and notes, trimmed spare columns and the rotation conditional row colours
(`LEDGER_FORMAT_RULES`) apply on both paths, with the generated blue tab
colour.

Rotation tabs and `#Global` also get conditional formatting: the tab's rules
are replaced (not appended to) by the script's set, so a user rule on these
tabs does not survive Set Up. Each rule is a custom formula over the whole
columns `A:G` keyed on the `type` cell. Rotation tabs: `error` light red,
`set` and `score` light blue, `team`, `join`, `leave`, `include` and
`exclude` light teal, `snapshot` light green, `attract`, `attract!` and
`repel` light green, `detach` light grey, comment rows (empty type with
content, or a type starting with `#`:
`=OR(AND($C1="", COUNTA($A1:$G1)>0), LEFT(TRIM($C1), 1)="#")`) light yellow,
`shift` no colour; the exact-match rules of the real types do not match
`#shift`.
`#Global`: `set` and `score` light blue, `attract`, `attract!` and `repel`
light green, `detach` light grey, `error` light red, comments light yellow.
`#GCal` gets
the same palette from its extension (13.5). Generated tabs
(`#Status`,
`#All shifts`, previews, `#Help`) are cleared with their formats and notes
(`Sheet.clear()` leaves notes, so `clearNotes()` follows it; `clearGenerated`)
and rewritten on every run; the adapter then
applies bold and the light grey background to the `headerRows`, light green
to the `dividerRows`, light red to the `errorRows`, light orange to the
`warningRows` and bold to the `currentCells` reported with the rows (5.8).
`#All shifts` columns are auto-sized to their content on every run
(`autoResizeColumns`) and then widened to at least 120px, so names
always fit and short names never leave needle-thin columns; columns beyond
the last rotation are deleted when they hold nothing, like the ledger trim.
In `#Help` the first line and every heading (a line ending with `:`) are
bold; `helpHeadingRows()` in `70_tools.js` lists them.

Palette: header `#eeeeee`, error `#f4c7c3`, warning `#fce5cd`, settings
`#c9daf8`, roster
`#d0e0e3`, snapshot and relation and divider `#d9ead3`, comment and current
shift cell `#fff2cc`, detach `#efefef`; tab colours generated `#4285f4`,
editable `#9e9e9e`.

### 10.2 Set Up Tab

`setupTab()` fills the active tab according to its name and formats it like
10.1. The tab must be empty, otherwise the command refuses with a toast. An
installed extension gets the tab first through `<prefix>_setupTab(sheet)`
(8, Extensions): the GCal extension fills an empty `#GCal` from its template
(13.5); without the extension `#GCal` gets a toast naming it.
Templates start with in-tab help: undated comment rows (empty `type`, text
in `note`) that attach to the `set` row below them and therefore stay at the
top of the tab through every run (3.6). A rotation tab gets the header, the
help rows

```
ROWS:
shift: one member, or nobody
team / score: name, name=number, name+=n, name-=n [, ...]; a bare name scores the roster minimum (a newcomer in team, anyone in score)
join: name, name=number [, ...]; a bare name joins at the roster minimum
leave: name [, name ...]
exclude / include: name [, name ...]
set: key, key=value
```

then an epoch `set` row (no `start`) listing every setting explicitly at its
default except `anchor` (`period=1w`, `horizon=30w`, ...), an epoch `team`
row with sample names, and one dated `set anchor` row at the most recent
Monday 00:00 where the first shift starts. `#Global` gets the header, the
help rows

```
ROWS:
repel / repel! / attract / attract! / detach: Rotation1, Rotation2
set: key, key=value
set / repel / repel! / attract / attract! without start: take the date of the nearest dated row above, or apply from the beginning at the top
```

and an epoch `set` row of the same defaults.
`#Holidays` gets its header and one sample row, `<previous year>-01-01 | New
Year`. Tabs the script writes get a toast and nothing else.

### 10.3 Fill Shifts Grid

`fillShiftsGrid()` needs a selection of more than one row below the header of
a rotation tab. It fills `start` so that afterwards every selected row that is
not a comment is dated; a dated row with nothing but its `start` (and `pin`)
gets `type` = `shift`. `what`, `end` and `duration` are never written; the
other cells of existing rows travel with their rows. An undated row is either
an empty grid position (blank, or `type` = `shift` and nothing else), a
comment (empty `type` with other content, or a `type` starting with `#`), an
undated `set`, `team` or
relation row, which takes the date of the nearest dated `set`, `shift` or
other typed row above it, in the selection or in the tab above the selection
(3.4, so the tool and the next run agree), or stays in place before
everything when there is none, or an
error: an undated row with another
`type` stops the command with a toast naming it. Dated comments are kept in
place like other non-shift rows; undated comments travel with the next dated
row below them, and trailing ones stay at the end. The grid comes from the
whole tab's `set` rows, its first `shift` row when no `set` row anchors it,
`#Global` and `#Holidays` (3.5); a selected row dated before the grid start
(5.1), or empty rows that would land there, are refused with the grid start
named.

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

### 10.4 Long runs

Apps Script stops an execution after six minutes, and two people (or a person
and the nightly trigger) can start a run at the same time. Three measures keep
that harmless; they live in `90_gas.js` and `80_runner.js` and are reused by
extensions.

- Lock: every user-triggered run (`Run`, the previews, the current-rotation
  runs, the trigger handler, the calendar re-export and clean actions, the
  Slack connection check, test message and hourly tick)
  and the two actions that rewrite cells a run may be sorting (`Fill Shifts
  Grid`, `Set Up Spreadsheet`) go through `withLock(fn)`, which takes the
  script lock (`LockService.getScriptLock().tryLock(5000)`), shared by all
  users and the trigger. When the lock is not free within five seconds the
  action is skipped with the toast `another Rotalator run is in progress`,
  also written to the execution log so a skipped night is visible, and
  nothing changes. The lock is always released in `finally`. `Set Up Tab`,
  `Abort run`, the token items and the trigger installers of the core and
  of the Slack extension take no lock.
- Cooperative abort: the menu item `Abort run` sets the script property
  `rotalator.abort` when a run holds the lock (`tryLock(0)` fails); when the
  lock is free it only toasts `no run in progress`. `withLock` clears the
  property when a run starts and arms the run guard with an abort check that
  reads the property at most every three seconds (`throttledFlag`), so a loop
  over hundreds of events costs few service calls and an abort takes effect
  within a few seconds; long loops ask `currentRunGuard().stopReason()`
  between steps and stop cleanly when it says `aborted`, recording `aborted
  after N event(s)` in their status block and toast. The ledger write is
  never interrupted: the scheduler writes before any extension loop runs.
- Time budget: the same guard answers `budget` once the run has used
  `RUN_BUDGET_SECONDS` (300) measured from the run start, so a long export
  stops between events well before the execution limit, with `time budget
  reached after N event(s); the next run continues`. The calendar reconcile
  is idempotent, so the next run picks up where this one stopped.

The decision is pure and tested: `runGuard({ start, budgetSeconds, clock,
aborted })` in `80_runner.js` gives `elapsedSeconds()` and `stopReason()`
from an injected clock and abort flag; `throttledFlag(read, intervalMs,
clock)` caches a flag between reads; `stopNote(reason, done, what)` is the
text; `currentRunGuard()` returns the guard armed by `withLock`, or, outside
a guarded run (Node, a call without the lock), one that never stops and
reports zero seconds. The Calendar block shows the elapsed seconds of each
run (13.4). Progress is visible as toasts: `withLock` itself is silent, the
calendar export announces its size, flushes pending spreadsheet writes
(`SpreadsheetApp.flush()`) before its loop, toasts `<action> <calendar>: X /
Y events done, N s` at most every ten seconds per calendar loop (the first
at loop start with `0 / Y`; `throttledProgress(report, intervalMs, clock)`
in `80_runner.js` is the pure cadence, tested with an injected clock) and
toasts the counts per finished calendar. On the trigger toasts are harmless
no-ops; in Node they are skipped.

### 10.5 Insert Scores At Cursor

`insertScoresAtCursor()` needs the cursor on a dated row below the header of
a rotation tab (else a toast). It computes the roster and scores of the
rotation just before that row's `start` with the run's own pieces
(`scoresAtCursorRow` in `70_tools.js`: the settings timeline, `applyStateRow`
for every state row before the instant in 3.6 order, and the credit of every
shift before it up to the instant, as the snapshot item records them at
`S`); a row starting at the instant counts for nothing, so a `join` or a
`shift` dated there is not included. It inserts one row directly above the
first row with that `start` in sheet order (a tab edited since the last run
may be unsorted; the next run's sort settles the position): `#team` in
`type`, the instant in `start`, the roster in roster order as `name=score`
in `what`, the shape of a `snapshot` and of a `team` row; nothing else is
written. The row is a comment (3.4), so
it has no effect on replay, and a dated comment sorts first at its instant,
which keeps it above that row on the next run. Removing the `#` turns it
into a `team` row that fixes the roster and the scores there, the archive
step of 3.4. It is a comment rather than a `score` row because, with the
informational snapshot, a `score` row would freeze the history above it
into the scores and make later corrections to that history ineffective. A
state row before the instant that fails on replay (`leave: unknown member`,
...) stops the action with its message. The action runs under the script
lock like Fill Shifts Grid, since it inserts a row a concurrent run may be
re-sorting.

## 11. Stages

1. Core, memory and CSV adapters, CLI, tests, DESIGN.md.
2. Apps Script adapter, menu, trigger, README.md, INSTALL.md.
3. `#Status` tab and the `#All shifts` view.
4. `#Links` tab (now `#Global`) with `distinct` and `joined`.

## 12. Known limitations

- No concurrency protection. A human editing during the nightly run may have
  edits to unpinned future shifts overwritten; rows before the snapshot, the
  assigned shift at it, and pinned rows are safe.
- Cell formatting is not preserved when sorting moves a row. Values are.
- Period `Nm` (months) is not supported.
- Member identity is the verbatim string. Renaming a member means editing
  history or adding a `score` row.
- Only the seven ledger columns are managed. Content in further columns does
  not follow its row when the ledger is re-sorted.
- A hand-entered history shift without `end` or `duration` extends only to
  the next grid boundary, so a longer shift is credited one period.

## 13. Google Calendar extension

The first extension (8, Extensions): `src/ext/GCal/`, bundle `dist/GCal.js`,
prefix `gcal`. It exports the shifts of the rotations that ask for it to
Google Calendars through `CalendarApp`. 13.1 to 13.3 are the pure part:
presets, templates and the plans, tested directly; 13.4 to 13.6 the adapter,
the menu and the credentials, tested against a mock `CalendarApp`.

### 13.1 Presets: the `#GCal` tab

`#GCal` (CSV: `gcal.csv`) has the header `preset | setting | value`. A row
with a non-empty column A starts a preset named A, column C its free-text
note; a row with an empty A and a non-empty B is a setting of the current
preset, C the whole value; a row with A and B empty is a comment. A `#` at
the start of column A disables the whole block: that row and every following
row with an empty preset cell, up to the next preset row, with no `setting
before any preset` or duplicate errors for any of them; a `cal` or `slack`
setting naming a disabled preset gets the usual unknown-preset error. A `#`
at the start of column B disables that row only. Preset names follow the
`cal` rule (letters, digits, `-`, `_`), so every preset can be named in a
`cal` value. Settings:

| setting | default | meaning |
|---|---|---|
| id | required | Calendar id (`x@group.calendar.google.com`, an address, `primary`). |
| title | `{rotation}: {who}` | Event title template (13.2). |
| body | `Rotalator shift {rotation} {start} to {end}. {note}` | Event description template. |
| allday | auto | `auto`: all-day when both instants are at 00:00; `true` or `false` force it. |
| color | default | `default` (or `none`): the calendar's own colour, left alone on the events. Else a `CalendarApp.EventColor` name (`pale blue`, `PALE_BLUE`), its number 1 to 11, or `#RRGGBB` (6 hex digits, any case) mapped to the nearest palette colour by RGB distance, ties to the lowest number. |
| free | true | Show the time as free (transparent) rather than busy. |
| invite | true | Invite the assignee when their member id contains `@`. |
| reminders | none | Comma-separated clock intervals before the start (`1d, 1h`), stored as minutes. Empty leaves the event's reminders alone, so the calendar's default notifications apply (13.4). |

Palette of the event colours, as the Calendar UI shows them: 1 pale blue
`#a4bdfc`, 2 pale green `#7ae7bf`, 3 mauve `#dbadff`, 4 pale red `#ff887c`,
5 yellow `#fbd75b`, 6 orange `#ffb878`, 7 cyan `#46d6db`, 8 gray `#e1e1e1`,
9 blue `#5484ed`, 10 green `#51b749`, 11 red `#dc2127`.

The grammar is the core's `parsePresetTab` (8, Extensions) with GCal's
settings table. `parseGCalPresets(rows)` returns every preset in tab order with its own error
list (and `setRows`, the tab row of each setting given) and the flat errors
as `{ row, where: '#GCal row N', message }`, sorted by row (`N` as below): a
setting before any preset, an unknown or duplicate setting, a bad value (with
the accepted forms), a bad or duplicate preset name, a preset without `id`
(reported on the preset row), and unknown placeholders or
directives in a template, reported once each. A preset with errors stays in
the list but is unusable: a rotation naming it gets a plan error and the
preset is skipped, like an unknown name.

Errors are also written into the tab (section 1): `gcal_readInputs(storage)`
reads `storage.readTabRows('#GCal', header)`, drops the rows whose `setting`
column reads `error` (the script's own rows from the previous run, never
parsed), parses the rest, and when there are errors, or error rows were
dropped, writes the tab back through `storage.writeTabRows('#GCal', header,
rows)` with a row `| error | <message>` directly above each offending row
(`gcalRowsWithErrors`; several errors on one row keep their order, a preset
without `id` gets its row above the preset row), everything else unchanged.
`where` names the offending row where it sits after the write-back, below
the error rows inserted at or above it (`row` is its position before), so
the `#Status` entry matches the tab the user sees. A second run reproduces
the same tab; fixing a row removes its error row on the next run.
This happens on every read, previews included, wherever the storage can
write: the Sheets adapter always, the CSV directory unless it was opened
read-only (the CLI without `--write`), the memory storage in tests; a storage
without `writeTabRows` only reads. The inputs keep the cleaned rows
(`inputs.rows`), so the adapter can add its own error rows after the export
(13.4).

### 13.2 Templates

`gcalFormat(template, values)` is the core's `formatTemplate` (8,
Extensions) with GCal's placeholders. It substitutes `{who}`, `{rotation}`,
`{note}`, `{pin}`, `{start}` and `{end}` (`{note}` is the user's note; a
generated shift has none), names case-insensitive; the two instants take
an optional strftime format after a colon, `{start:%a %e %b}`, and without
one give the sheet's datetime form (`2026-10-05`, `2026-10-05T09:00`). The
directives are `%Y %m %d %e %H %M %a %A %b %B %j %u` and `%%`, with English
names; `%e` is the day without padding (not space-padded as in C), `%u` runs
from Monday 1 to Sunday 7 and `%j` is zero-padded to three digits. An unknown
placeholder or directive stays in the
text verbatim and is reported by `gcalTemplateErrors` when the preset is
parsed. Title and body are trimmed, so an empty `{note}` at the end leaves no
trailing space.

### 13.3 Plans

`gcalPlan(run, inputs, options)` is pure. `run` is the runner's result
(`ledgers`, `status`), `inputs` the parsed presets, `options` `repair` and
`rotations`. For every written rotation whose effective `cal` at `now` names
presets it takes the shifts from `status.shifts` (start, end and assignee,
the swept extents) joined by start with the written rows for `pin` and
`note`, and plans the shifts inside the export window: `[P, horizonEnd)`
where `P` is the stored snapshot the run started from, the earliest instant
the run may have changed; without one (a first run), or with `repair`, from
the rotation's first shift. Shifts with nobody inside the window are skipped
and counted. Each remaining shift gives one event per preset:

```
{ key: '<rotation>|<start>', rotation, preset, calendar: id, title, body,
  start, end, allDay, color, free, guests, reminders }
```

`start` and `end` in the sheet's form, `allDay` per the preset's `allday`,
`guests` the assignee when `invite` is on and the id contains `@`, `reminders`
in minutes. The key is what the adapter tags events with (`rotalator=<key>`)
to find them again. The plan is `{ rotations: [{ rotation, presets,
calendars, from, to, shifts, skipped }], events, errors }`, events in
rotation, start, preset order, errors the preset errors plus the rotation's
unknown or skipped presets. Frozen rotations (run scope) are not planned, so
`Run for current rotation` exports that rotation only.

`gcalCleanPlan(run, inputs, target)` lists what a clean removes: for `{
rotation }` the keys of every shift of the rotation with the calendars of its
presets and the window from its first shift to the later of the last shift end
and `horizonEnd`; for `{ preset }` the calendar and `all: true`, every
Rotalator-tagged event there. `gcalStatusData(plan)` is the status block
data, one line per rotation and preset with the counts `create`, `update`,
`delete`, `unchanged` at zero for the adapter to fill and `skipped` from the
plan, plus the plan's errors; `gcal_status(status)` renders `status.ext.gcal`
as a `Calendar` block (a `(preview)` suffix when `mode` is set), one row per
line and a `calendar errors` table when there are errors.

A rotation naming two presets on the same calendar keeps the first: their
events would share keys. Golden scenario `gcal`: two rotations, one with
`cal=team personal` and a stored snapshot, one without; the golden run loads
the extension (the directory holds a `gcal.csv`), writes the ledgers and
shows the plan's counts in a `Calendar (no calendar)` block of
`expected/status.txt`, and `test/gcal.test.js` compares the plan with
`expected/gcal.json`. The CLI loads the extension for any directory that
holds a `gcal.csv`, so `run` mirrors the spreadsheet (error rows written
with `--write`, the Calendar block in `--status`, exit 1 on preset errors)
without calendar calls, and `rotalator export DIR [--rotation NAME]
[--repair]` runs the scheduler without writing and prints the plan as text.

### 13.4 Reconcile

`gcalReconcile(plan, data, { tz, dry })` brings each calendar of the plan in
line with the desired events and fills the counts of `data`
(`gcalStatusData`). Per rotation and preset it fetches the events of the
window with `getEvents(from, to)`, keeps those tagged `rotalator=<key>` whose
key names the rotation and a start at or after `from` (so a shift before the
window that reaches into it is left alone), and indexes them by key. A
desired event without a match is created: `createAllDayEvent(title, start,
endExclusive, options)` or `createEvent(title, start, end, options)` with
`description`, and `guests` plus `sendInvites: true` when there are guests,
then `setTag`, `setColor(CalendarApp.EventColor.<name>)` when the preset sets
a colour, `setTransparency(TRANSPARENT|OPAQUE)` for `free`, and, when the
preset lists reminders, `removeAllReminders` followed by
`addPopupReminder(minutes)` for each, so the event carries exactly that
list; a preset without reminders never touches them, and the new event keeps
the calendar's default notifications. An existing event is compared field by
field (title, description, all-day flag and dates or times, colour when the
preset sets one, transparency, sorted guests, sorted reminders when the
preset lists some) and only the
differing fields are written: `setTitle`, `setDescription`,
`setAllDayDates` or `setTime` (which also switches between all-day and
timed), `setColor`, `setTransparency`, `addGuest` and `removeGuest` (no
invitations on update), reminders as above; a preset that goes from a list
back to empty therefore leaves existing events' reminders as they are.
Tagged events of the rotation in
the window that no desired event claims are deleted, and duplicates of one
key are deleted down to one; untagged events and other rotations' events are
never touched. With `dry` the counts are computed and nothing is written.
A calendar that cannot be opened or fails is also written in place (section
6): `gcalWriteCalendarErrors` puts `| error | <message> (<rotation> /
<preset>)` above the preset's `id` row in `#GCal`, on top of the parse
errors, wherever the storage can write; the next read drops it like any
error row, so a shared calendar clears it. The plan errors the `cal` value
causes (an unknown preset, two presets on one calendar; they carry `setting:
'cal'`) go above the `set` row that put `cal` in force at `now`
(the core's `writeSettingErrors`): in the rotation tab, or in
`#Global` prefixed with the rotation name when the value comes from there;
written through `writeLedger`/`writeGlobal` only when the run writes, and
into the result's cells so the CLI prints them. That tab is therefore
written a second time in the same run, after the core wrote it, only when
such an error row has to be added. The extension's errors are
appended to the run's errors (`GCal <where>: <message>`) and a stop note to
the status warnings, so the toast counts them and `#Status` lists the note
once, in the warnings table (6).
Between calendars and between events the reconcile asks the run guard (10.4)
whether to stop; on `aborted` or `budget` the remaining events and calendars
are left for the next run, `data.note` carries `aborted after N event(s)` or
`time budget reached after N event(s); the next run continues`, and the
status block shows it on a `note` row. `data.elapsed` is the run's elapsed
seconds, shown on the block's title row (0 in Node). `options.progress(line)`
is called when a calendar is done; the hook and the menu actions use it to
toast the counts per calendar after the opening toast `exporting N event(s)
to M calendar(s)` and a `SpreadsheetApp.flush()`. `options.ticker()` gives a
step function per calendar loop, called at loop start and after each event
with `{ calendar, done, total, what, elapsed }` (`total` the wanted plus
stale events of that calendar); `gcalTicker(action)` supplies one that
toasts `<action> <calendar>: X / Y events done, N s` at most every ten
seconds (10.4), with `exporting` from the run, `re-exporting` from the menu
and `cleaning` in `gcalClean`, which steps per deletion with `what`
`deletions`. `gcalClean` checks the guard between deletions the same way.
Datetimes travel as the sheet's text: `Utilities.parseDate(text, tz,
"yyyy-MM-dd'T'HH:mm")` into the calendar and `Utilities.formatDate` back,
canonicalised, timed instants in the spreadsheet time zone and all-day dates
in the script time zone (13.6). Creates and updates stay inside the window;
the rotation's tagged events are fetched up to `until`, the later of the
horizon end and the clean bound (three years after `now`, see `gcalClean`
below), so events left beyond a shortened `horizon` are deleted too, while
anything further out is left alone. A missing calendar
(`getCalendarById` null: not found or not shared with the running account)
or an API exception is recorded as `{ where: '<rotation> / <preset>',
message }` in `data.errors`; the other calendars proceed and nothing is
thrown.

`gcalClean(clean, { tz, dry, from, to })` deletes per a clean plan: for a
rotation, the events tagged with its prefix in its window in each of its
calendars; for a preset, every tagged event of that calendar between `from`
and `to`, which `gcalCleanWindow(now)` sets to one year back and three years
ahead of `now`, since `getEvents` needs a range and a whole-calendar scan
is unbounded.

`gcal_afterRun(result, storage, options)` plans the regenerated rotations,
reconciles when `CalendarApp` exists (dry when `options.write` is false or
`options.mode` is `preview`, which the block marks) and stores the counts and
errors under `result.status.ext.gcal` when a rotation uses `cal` or the
presets have errors; the core writes the status tabs afterwards, so the
`Calendar` block is in the same run's `#Status`. Without `CalendarApp` (Node)
the block is marked `no calendar`. `options.export === false` skips the
hook: the menu actions run the scheduler without writing and export
themselves.

### 13.5 Menu and Set Up

`gcal_menu` adds a separator and four items. `Re-export calendar` and
`Re-export calendar: current rotation` run the scheduler without writing
(the ledgers stay as they are; run first if they changed), plan with
`repair` (every shift from the first one) and reconcile, so a calendar that
was cleaned or edited by hand is rebuilt; the toast sums the counts and names
the first error. `Clean calendar: current rotation` deletes the events of the
active tab's rotation in its presets' calendars. `Clean calendar: selected
preset` takes the preset from the active cell's row in `#GCal`, walking up
from a setting row to its preset row, and deletes every Rotalator event of
that calendar in the window above.

`gcal_setup(ss)` creates `#GCal` directly after `#Holidays` when missing,
and moves an existing one there when it sits elsewhere (once, with the
core's `placeTabAfter`; a tab coming from before `#Holidays` is moved to
`#Holidays`' current index, since `#Holidays` shifts up when the tab
leaves), so the system tabs read `#All shifts`, `#Status`, `#Global`,
`#Holidays`, `#GCal` and `#Help` stays last (10.1). An empty tab gets the
template
(`gcalTemplateRows`): the header, the cheat sheet `gcalCheatSheet()` as
comment rows in column C (a `SETTINGS` heading, one line per setting with
its values and default, a `TEMPLATES` line with the variables and the
`{start:%fmt}` directives, a `USE` line with `set cal=<preset> [<preset>
...]`), then the preset block `preset-1` (note `First Google Calendar
preset`) with `id` = `FILL IN WITH CALENDAR ID`, `title` and `body` at their
defaults, `allday` `auto`, `color` `default`, `free` `true`, `invite`
`true` and `reminders` empty, one empty row between the cheat sheet and the
block, so a run with `cal=preset-1` reports the placeholder id as not found
until it is filled in. It then formats the tab like an editable system tab
(the core's `formatPresetTab` with the extension's widths and rules; the
placement is the core's `placeTabAfter`):
script font, wrap text and top-left alignment on the whole columns, plain
text, bold grey frozen header, widths 140, 120, 700, spare columns removed,
grey tab colour, and conditional row colours consistent with the ledgers
(10.1), replacing the tab's rules: error rows (`=$B1="error"`) light red,
disabled blocks (every row whose last non-empty preset cell at or above it
starts with `#`: `=LEFT(LOOKUP(2, 1/($A$1:$A1<>""), $A$1:$A1), 1)="#"`, a
Sheets array formula) and disabled setting rows
(`=AND($A1="", LEFT($B1, 1)="#")`) light yellow, preset rows (column A
non-empty, below the header) light blue like `set`, comment rows (A and B
empty, C non-empty) light yellow; the formulas are shared constants of
`72_presets.js`. `gcal_setupTab(sheet)` gives
`Set Up Tab` the same template on an empty `#GCal` (and refuses a filled
one), returning `true` for that tab only.
`gcal_help` returns the `CALENDAR` lines appended to `#Help` (8,
Extensions): the same cheat sheet plus the export rule and the menu items.
The `#GCal` tab is a known system tab of the core, read through
`readTabRows`.

### 13.6 Credentials and time zone

`appsscript.json` lists the OAuth scopes explicitly: spreadsheets, the
container UI (menu and toasts), `script.scriptapp` (the trigger), `calendar`
and `script.external_request` (the Slack extension, 14.5). With automatic
scope detection an extension's scope would only be requested once its bundle
is present, and a trigger installed before that would then fail nightly until
someone re-authorised; listing them up front means one authorisation covers
every extension whenever it is added. Changing
the manifest scopes requires re-authorising the script once (INSTALL). Menu
actions run as the user who clicks, the nightly trigger as the account that
installed it: every calendar named by a preset must be shared with write
access to those accounts, otherwise `getCalendarById` returns null and the
preset is reported as not found. Timed instants are converted in the
spreadsheet time zone; all-day dates in the script time zone
(`Session.getScriptTimeZone()`, the manifest `timeZone`), which is the zone
`createAllDayEvent`, `setAllDayDates`, `getAllDayStartDate` and
`getAllDayEndDate` work in, so a spreadsheet at +10 with a manifest at UTC
still gets its all-day events on the right day and a second run changes
nothing.

## 14. Slack extension

The second extension (8, Extensions): `src/ext/Slack/`, bundle
`dist/Slack.js`, prefix `slack`. It posts messages about shifts to Slack
channels and people and keeps Slack user groups such as `@oncall` pointing at
the people on call. Everything is outbound: the extension calls the Slack Web
API from the run; Slack never calls the script. 14.1 to 14.3 are the pure
part: presets, the plan and the state, tested directly; 14.4 to 14.6 the
adapter, the menu and the credentials, tested against a mock `UrlFetchApp`.

Timing is the run's: a message goes out in the first run that finds it due,
and a group changes when a run finds it stale, so with the nightly trigger
both happen between 02:00 and 03:00 after the fact. Exact-time delivery (a
one-off trigger per handover, Slack's scheduled posts) is left for later
(15); a user who wants finer granularity installs the hourly Slack trigger
(14.5).

### 14.1 Presets: the `#Slack` tab

`#Slack` (CSV: `slack.csv`) has the header `preset | setting | value` and the
grammar of `#GCal` (13.1) through the core's `parsePresetTab`: a non-empty
column A starts a preset, an empty A with a non-empty B is a setting, A and
B empty is a comment, a `#` prefix in A disables the block and in B the row
(13.1; an id row whose name starts with `#` is blanked and not cached),
`| error | <message>` rows are the script's own and
are dropped on read and rewritten above the offending rows. One more kind of
script-owned row is specific to this tab: `<name> | id | <Slack id>` caches
a resolved id (14.4) and is kept, never parsed as a preset. A preset is one
kind of message, or one group to keep, or both. Settings:

| setting | default | meaning |
|---|---|---|
| to | (empty) | Comma-separated destinations, each a template (14.2): a channel by id (`C…`, `G…`) or by name (`#oncall-team`), a person by email or by Slack id (`U…`, `W…`), or a member placeholder `{who}`, `{prev}` or `{next}`. |
| when | `0` | Signed clock interval relative to the shift start: `0` at the handover, `-3d` three days before, `2h` two hours after. Units `d`, `h`, `m`. |
| text | `{who} is on call for {rotation} from {start} to {end}` | Message template (14.2). |
| group | (empty) | A user group by handle (`@oncall`) or id (`S…`). The people on call in every rotation whose `slack` names a preset with this group are its members (14.3). |

A preset with neither `to` nor `group` is an error on the preset row; `text`
without `to` is allowed and unused. Errors follow 13.1: setting before any
preset, unknown or duplicate setting, bad value with the accepted forms
(`when` not an interval, a destination that is none of the forms above, a
group not `@handle` or `S…`), bad or duplicate preset name, unknown
placeholder in `to` or `text`. `slack_readInputs(storage)` reads the tab,
drops and rewrites error rows, keeps the id rows, and stores `{ presets,
errors, rows, ids }` as `result.ext.slack`.

Rotations opt in with `set slack=<preset> [<preset> ...]` (3.5), the mirror
of `cal`: two presets on one rotation, `team` with `to=#team` and `heads-up`
with `to={who}` and `when=-3d`, give the channel a handover message and the
person a reminder; a third with `to=manager@example.com, {prev}` and a longer offset is
an early warning to fixed and moving recipients alike.

### 14.2 Templates and destinations

`text` and each destination in `to` go through the core's `formatTemplate`
(13.2) with the Slack placeholders: `{who}` the shift's assignee, `{prev}` the
assignee of the rotation's previous shift, `{next}` of the following one,
`{rotation}`, `{start}` and `{end}` (with the strftime directives), `{note}`,
`{pin}`, and `{group}` (the preset's group, empty without one). `{prev}` on
the first shift and `{next}` beyond the last are empty; a nobody shift makes
`{who}` empty and is never a message's own shift (14.3).

In `text` a member placeholder renders as a mention `<@U…>` when the member
resolves to a Slack id (14.4) and as the verbatim member id otherwise;
`{group}` renders as `<!subteam^S…>`; the other values are escaped for
Slack's markup (`&`, `<`, `>`). Text is trimmed. `slackRenderText(template,
values, mention)` does this with `mention(kind, id)` supplying the mention
or null; the pure plan renders with no resolver, so its `text` shows member
ids and the group handle verbatim, and each message carries its `values`
so the adapter re-renders the template once the ids are resolved. In `to` a member placeholder
renders as the member id, which is then resolved like a literal email or
id: a destination that renders empty is skipped and counted, one that does
not resolve is an error (14.4).

### 14.3 Plan and state

`slackPlan(run, inputs, state)` is pure. `run` is the runner's result, `inputs`
the parsed presets and `state` the rows of `#Slack state`. It considers every
rotation the run read, frozen ones included (run scope, 8): a message is
about the ledger as it stands, and a group is a union over rotations, so
`Run for current rotation` must not drop the other rotations' people from
`@oncall`. Shifts come from `status.shifts` (start, end, assignee) joined
with the rotation's rows for `pin` and `note` (the written rows, or the
runner's `read` rows for a frozen rotation), in start order, so `{prev}` and
`{next}` are neighbours in that order.

Messages: for each rotation, each preset named by its effective `slack` at
`now` that has `to`, and each shift with an assignee, the message window is
`[start + when, end + when)`. The shift whose window contains `now` is the
preset's shift of the moment; there is at most one per rotation and preset,
since shifts do not overlap. Its message is due for a destination when
`#Slack state` has no row for that rotation, preset and rendered destination,
or the row names a different shift start or assignee. A shift already
recorded with the same start and assignee is not sent again, whatever
happened to `{prev}` or `{next}`; a reassigned shift is announced again with
the new person. A destination that renders empty, or like an earlier
destination of the same preset (`#chan, #chan`, or `{who}, {prev}` when the
same person holds both shifts), is skipped and counted, so one state key
gets one message. A run that comes more than one shift length late therefore
skips the shifts whose windows have passed: with the nightly trigger alone a
period shorter than a day loses messages, and the hourly Slack trigger
(14.5) is the remedy. Deleting a state row, or the whole `#Slack state` tab, re-sends the message of the moment
once, which doubles as "announce again".

Groups: for each group named by a preset in force in any rotation, the
desired members are the assignees of the shifts in force at `now` (`start <=
now < end`) in those rotations, sorted and de-duplicated, as member ids; the
adapter resolves them. A rotation contributes nothing and gets the warning
`group @oncall: nobody on call in <rotation>` when its shift at `now` has
nobody or when no shift covers `now`; a member the adapter cannot resolve
is warned about too. An empty
desired set leaves the group unchanged with the warning `group @oncall:
nobody on call, left as it is`, because Slack refuses to empty a group
through the API. The group has no state row: the adapter compares with the
members Slack reports and updates only when they differ. Rotalator owns the group: anyone added by hand
is removed at the next run.

The plan is `{ lines: [{ rotation, preset, due, skipped }], messages: [{
rotation, preset, to, start, end, who, text, values }], groups: [{ group,
rotations, members }], skipped, errors, warnings }`: one line per rotation
and message preset in force, `to` the rendered destination and `members`
member ids, both resolved by the adapter; messages in rotation, preset and
destination order; `warnings` the group warnings above, added to the run's
warnings by the hook. `slackStateRows(state, posted, run, inputs)` gives the
new state rows from the entries read (`slackStateFromRows`) and the posted
messages with their `sentAt`, keeping only pairs of a rotation the run read
and a preset the tab knows. `#Slack state` (CSV:
`slack-state.csv`) has the header `rotation | preset | to | start | who |
sent at`, one row per rotation, preset and rendered destination, rewritten
after each run that posted: rows of pairs whose rotation or preset no longer
exists are dropped, the others kept, sent rows replaced. The adapter creates
the tab when it first has something to write. A preview leaves it alone.

### 14.4 Adapter

`slackApi(method, params)` in `40_api.js` posts form-encoded parameters to
`https://slack.com/api/<method>` through `UrlFetchApp.fetch` with the bot
token as a bearer header and `muteHttpExceptions`, parses the body and throws `<method>:
<error>` when `ok` is false, with a hint after the common errors
(`not_in_channel`: invite the bot or grant `chat:write.public`; the token
errors `not_authed`, `invalid_auth`, `token_revoked`, `account_inactive` and
a missing property: set the token from the menu; `missing_scope`); on HTTP
429 it sleeps for `Retry-After` seconds (one by default) once and retries,
then fails like any other error. Calls used: `users.lookupByEmail`,
`conversations.list` (paged with `cursor`, `types` public and private,
`exclude_archived`), `usergroups.list`, `usergroups.users.list`,
`usergroups.users.update`, `chat.postMessage`, `auth.test` (the menu's
connection check).

Id resolution (`slackResolver(ids)`, `resolve(text)`) turns a destination or
member into a Slack id and remembers it: an email through
`users.lookupByEmail`; a `#name` through `conversations.list`, which on a
large workspace pages through thousands of channels, so the listing is
fetched once per run, the result is cached and a channel id in `to` is the
recommended form; an `@handle` group through `usergroups.list`, fetched once
per run too; a bare `U…`, `W…`, `C…`, `G…` or `S…` as it is. A member id that
contains `@` is looked up as an email; one that does not needs an `| id |`
row and is otherwise unresolved. Every resolution is written back to
`#Slack` as `<name> | id | <Slack id>` appended after the last row in
lookup order, so the next run makes no lookup call for it; a user may add or
edit these rows by hand (a member whose id is not an email, a channel the
bot cannot list) and delete one to force a fresh lookup. The rows are the
`ids` of the inputs; the resolver starts from them as its cache. A lookup
that finds nothing (`#name` or `@handle` not listed, `users_not_found`) is
not cached and is reported by the caller; an API failure throws.

`slack_afterRun(result, storage, options)` plans, then delivers
(`slackDeliver`) when `UrlFetchApp` exists, `options.mode` is not `preview`,
and either the run writes or `options.slack` is `true` (the hourly tick,
14.5, which leaves the ledgers alone but still posts, updates groups and
writes `#Slack state` and the `#Slack` rows through the storage). It resolves
each due message's destination and posts it with `chat.postMessage`
(`channel` a channel or user id, users get the direct message opened by
Slack; the text re-rendered with `slackRenderText` and a `mention` from the
resolver, so members with an id and the group become mentions and the
others stay verbatim), records the state rows of the successful posts, and
brings each group in line: the desired members resolved (a member without an
id or unknown to Slack is a warning `group @x: <why>` and left out; when
none resolves the group is left alone with the warning `group @x: no member
has a Slack id, left as it is`), compared as sorted id lists with
`usergroups.users.list`, and `usergroups.users.update` called only when they
differ, the block's `result` set to `updated`, `unchanged` or `failed`. An
empty desired set makes no call (14.3). Before each post and each group it
asks the run guard (10.4) whether to stop; on `aborted` or `budget` the
remaining posts and groups wait for the next run, which finds them still
due, `data.note` carries the standard stop note (`after N message(s)`) and
the run's warnings list it once. Failures are reported in place (section
1): a destination that does not resolve or a post that fails
(`channel_not_found`, `not_in_channel` with the hint, `users_not_found`
from the email lookup, a token error) gets `| error | <message> (<rotation>
/ <preset>)` above the preset's `to` row; a group failure `| error |
<message> (group @x)` above the `group` row of the first preset naming the
group; a member without an id above the `to` row that named it, with the
hint `add a row "<member> | id | U..."`. After the delivery `#Slack state`
is written when at least one post succeeded (the storage creates the tab),
and `#Slack` is written once when there are new id rows or delivery errors:
the cleaned rows, the id rows appended, the parse and delivery error rows
above their rows. The plan errors the `slack` value causes (`setting:
'slack'`, an unknown preset) go above the `set` row that put `slack` in
force at `now`, in the rotation tab or in `#Global` prefixed with the
rotation (the core's `writeSettingErrors`, as for `cal` in 13.4),
written only when the run writes and into the result's cells. The
extension's errors are appended to the run's errors as `Slack <where>:
<message>` and counted in the toast. A failed post is not recorded, so it
is retried next run; the destinations that succeeded are, so they are not
sent twice.

`slackStatusData(plan)` and `slack_status(status)` render a `Slack` block
in `#Status` (suffix `(preview)`, or `(no slack)` in Node): one line per
rotation and preset with `due`, `posted`, `skipped`, `failed`; one line per
group with its rotations, members and a `result` of `updated`, `unchanged`
or `failed` (empty when nothing was delivered); the elapsed seconds on the
title row; a `slack errors` table. Without `UrlFetchApp` (Node) the block
lists what would be posted. `options.slack === false` skips the hook, for
menu actions that run the scheduler for another purpose.

### 14.5 Menu, trigger and Set Up

`slack_menu` adds a separator and six items. `Set Slack token…` prompts for
the bot token (`ui.prompt`) and stores it in the script property
`rotalator.slack.token`, never in a cell and never echoed; an empty answer
or Cancel changes nothing. `Remove Slack token` deletes it. `Check Slack
connection` calls `auth.test` and toasts the workspace and bot name or the
error. `Send test message: selected preset` takes the preset from the
active cell's row in `#Slack` (`slackSelectedPreset`, walking up from a
setting or id row to its preset row), runs the scheduler without writing
and with both extension hooks off, plans with `slackTestPlan(run, inputs,
name)` (pure: the preset's destinations rendered for the shift in force at
`now` in the first rotation whose `slack` names it; an unknown preset, one
with errors or without `to`, no rotation naming it, or nobody on call is
the error toasted) and posts through `slackDeliver` (the candidates come from
`slackShiftMessages`, shared with the plan) with the text prefix
`[test] `, so the id rows and the error rows reach `#Slack` as after a run
while `#Slack state` is left alone; the toast counts sent and failed and
names the first failure. `Install hourly Slack trigger` and `Remove hourly
Slack trigger` manage a time-based trigger on `slackTick`, which runs
`runStorage` for all rotations with `SLACK_TICK_OPTIONS`, `{ write: false,
export: false, slack: true }`: the ledgers and status tabs stay as they
are, the calendar export is skipped, and the hook posts and updates groups
from the plan of that read (14.4); the core's `Remove trigger` leaves it
alone and `Install nightly trigger` does not replace it. `Check Slack
connection`, `Send test message` and `slackTick` run through `withLock`
like the calendar actions; the token items and the trigger installers take
no lock, like the core's.

`slack_setup(ss)` creates `#Slack` directly after `#GCal` when that tab
exists, else after `#Holidays`, and moves an existing one there once, following
the `#GCal` rules (13.5); the hooks run in `EXTENSIONS` order, so `#GCal`
is in place first. An empty tab gets the template
(`slackTemplateRows`): the header, the cheat sheet `slackCheatSheet()` as
comment rows in column C (a `SETTINGS` heading with the settings, their
forms and defaults, a `TEMPLATES` line with the placeholders and the
`{start:%fmt}` directives, an `IDS` line explaining the `| id |` rows, a
`USE` line with `set slack=<preset> [<preset> ...]`), one empty row, then
two preset blocks: `team` (note `Channel handover message and the @oncall
group`) with `to` = `#FILL-IN-WITH-CHANNEL` (a valid channel name, so the
preset parses and a run reports the channel as not found above the `to`
row until it is filled in, like the placeholder id of `#GCal`), `when` `0`,
`text` at its default and `group` `@oncall`; `heads-up` (note `Reminder to
the person three days before`) with `to` `{who}`, `when` `-3d` and `text`
`Reminder: you are on call for {rotation} from {start:%a %e %b} to {end:%a
%e %b}`. Formatting follows `#GCal` through the core's `formatPresetTab`
and `placeTabAfter`: script font, wrap, frozen bold grey
header, widths 140, 120, 700, grey tab colour, error rows light red, `| id
|` rows light grey (this rule before the preset rule, since both match a
non-empty column A), disabled blocks and disabled setting rows light yellow
(the shared formulas of 13.5), preset rows light blue, comment rows light
yellow.
`slack_setupTab` fills an empty `#Slack` the same way and refuses a filled
one. `#Slack state` is created by the adapter through `writeTabRows`, not
by Set Up: bold grey header, frozen, script-owned; Set Up only colours an
existing one blue like the other script-written tabs. `slack_help` appends
the `SLACK` lines to `#Help`: the cheat sheet, the timing rule, the group
rule and the menu items.

### 14.6 Credentials and scopes

The Slack side is one app installed in the workspace with a bot token
(`xoxb-…`); INSTALL.md carries an app manifest to paste. Bot scopes:
`chat:write` (post to channels the bot is in and to people), `chat:write.public`
(public channels without joining), `users:read` and `users:read.email`
(lookup by email), `channels:read` and `groups:read` (`#name` resolution),
`usergroups:read` and `usergroups:write`. Corporate workspaces may need an
admin to approve the app and to allow the app to edit user groups; on
Enterprise Grid a group synced from the identity provider cannot be changed
through the API, so `@oncall` must be a workspace group Rotalator owns. The
token is read from the script property at each call and never logged; the
menu actions and `slackTick` run as the user who installed them, the nightly
trigger as the account that installed it, and the script property is shared
by all, so one token serves every path. `appsscript.json` lists
`script.external_request` up front (13.6). Slack's rate limit for posting
is about one message per second per channel; the adapter honours
`Retry-After` once and otherwise reports the failure and moves on.

Node: `node/load.js` loads `Slack` like `GCal`; the CLI loads it for any
directory that holds a `slack.csv`, so `run` mirrors the spreadsheet (error
rows with `--write`, the block in `--status`, exit 1 on preset errors)
without Slack calls, and `rotalator slack DIR [--rotation NAME]` runs the
scheduler without writing and prints the plan as text: the messages that
would go out with their rendered text and destinations, the desired members
of each group. Golden scenario `slack`: two rotations sharing `@oncall`
through two presets, one with a heads-up to `{who}`, a `slack-state.csv`
that already records the current channel message so only the heads-up is
due; the run compares the plan with `expected/slack.json` and the state
rows that would be written.

## 15. Future extensions

- Month-based periods with day-of-month anchors.
- A `Members` tab mapping ids to names and emails, shared by the Slack and
  GCal extensions in place of the `| id |` rows.
- Exact-time Slack delivery: a one-off trigger per handover installed by the
  nightly run, or Slack's scheduled posts (`chat.scheduleMessage`, up to 120
  days ahead) reconciled like calendar events, which would let `when` carry a
  time of day (`-1d@09:00`).
- Interactive Slack (`/oncall` commands, App Home, swap requests) needs Slack
  to reach the schedule: a small external service in Socket Mode running the
  core in Node against a Sheets API storage adapter, reusing the Slack plan.
- PagerDuty export following the GCal shape.
- Concurrency guard via read-compute-reread-compare if runs ever collide with
  editing.
- A terminator `shift` row with nobody at `horizonEnd`, if a visible end of
  the schedule turns out to be wanted.
