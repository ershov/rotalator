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

## 2. Concepts

| Term | Meaning |
|---|---|
| rotation | One on-call role, one ledger tab. |
| ledger | Time-sorted rows of a rotation: shifts and events. |
| member | A person, identified by the verbatim string used in the sheet. |
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
| `Holidays` | users | Column A: date `YYYY-MM-DD`, column B: note. Applies to all rotations. |
| `Links` | users | Stage 4. Relations between rotations over time. |
| `Status` | script | Stage 3. Scores and warnings. Fully rewritten each run. |
| `<rotation>.preview` | script | Dry run output. |

Any tab whose name starts with `.` or that is not a ledger by header is
ignored. A ledger is recognised by its header row.

### 3.2 Ledger columns

```
pin | start | type | who | arg | end | duration | note
```

- `pin`: any non-empty value. Pinned rows are never modified or deleted.
- `start`: `YYYY-MM-DDTHH:MM`, spreadsheet time zone, plain text. Mandatory.
- `type`: row type, see 3.4.
- `who`: exactly one member id, or empty. Used only by `shift`, `join`,
  `leave`, `exclude`, `include`.
- `arg`: free-form argument for types that take a list or expression.
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
- Lists: items separated by `,` or `;`, whitespace trimmed. `:` is not a
  separator because times contain it.
- Assignments inside lists: `name=value`, `name+=number`, `name-=number`.
- Member ids: any text without `,` `;` `=` `+`. Matched verbatim.
- Nobody: empty `who`, `-` or `none`.
- Scores are written with two decimals.

### 3.4 Row types

| type | who | arg | end/duration | owner |
|---|---|---|---|---|
| shift | member or nobody | | optional | users or script |
| team | | roster list | | users |
| join | member | optional baseline | | users |
| leave | member | | | users |
| exclude | member | | optional, open-ended if absent | users |
| include | member | | | users |
| score | | adjustments list | | users |
| set | | `key=value` list | | users |
| snapshot | | roster with scores | | script |
| error | | message | | script |

**shift.** Assigns `who` from `start`. Its scored interval ends at the explicit
`end`, else at the earlier of the next `shift` row's start and the next grid
boundary strictly after `start`. The grid rule gives the final row of the
ledger a definite extent without a terminator row or an explicit `end`, and
keeps a stale ledger's last shift from being credited for the gap before the
next run. Its claim (see 5.4) ends at the explicit `end`, else at the next grid
boundary strictly after `start`. Unpinned shifts starting after the snapshot
belong to the script and are regenerated every run. Any user edit to a future
shift must be pinned or it is lost.

**team.** Sets the full roster. `alice, bob, carol=median, dave=12, erin+=2`.
The list is diffed against the current roster: absent members leave, new
members join with the given baseline or the `baseline` setting, `+=`/`-=`
adjust existing scores, `=number` sets a score. The list order becomes the
roster order used by the `order` tiebreak.

**join.** One member joins. `arg` is `median`, `mean`, `min`, `max` or a number;
default is the `baseline` setting. Baselines are computed from the projected
scores of the roster at that instant, including excluded members. Joining an
existing member is an error.

**leave.** Member removed, score discarded. A later join starts fresh with a
baseline.

**exclude / include.** The member is ineligible from `start` until `end`,
`duration`, or a later `include` row. Score is kept and the member still counts
for baselines.

**score.** `alice=10, bob+=2, carol-=1`. Manual corrections, e.g. for history
older than the snapshot.

**set.** Changes settings from `start` onward. Keys in 3.5. `set` rows are
always replayed from the top of the ledger even when older than the snapshot,
so the settings history stays in one visible place. When `period` changes and
`anchor` is not given, `anchor` defaults to the row's own `start`. A `set` row
that changes `period` or `anchor` cuts claims and slots at its `start`; the
grid realigns from there.

**snapshot.** One per rotation, written by the script. Its instant is the
start of the current shift, see 5.2. `arg` is the roster in order with scores
as of that instant: `alice=12.50, bob=11.00`. The snapshot is the single
boundary in the ledger: rows before it are ignored on replay, except `set`
rows and `shift` or `exclude` intervals that extend past it, which are clipped
to start at the snapshot; the shift starting at the same instant is the
current shift and is kept; unpinned shifts after it are regenerated. The
script never moves the snapshot backwards. Deleting the snapshot forces a full
replay from the top, which is the intended reset mechanism. Rows older than the
snapshot other than `set` rows may be cut to an archive tab by hand at any
time.

**error.** Written by the script, `arg` is the message. Every `error` row is
removed on read, so they are purely diagnostic and never accumulate. See 6.

### 3.5 Settings (`set` keys)

| key | default | meaning |
|---|---|---|
| period | required | `Nd` or `Nw`. |
| anchor | start of the `set` row | A grid instant. Also the earliest instant the schedule can begin. |
| horizon | 90d | Generate slots up to the first grid boundary at or after `snapshot + horizon`. |
| skip_weekends | false | Saturdays and Sundays credit zero units. |
| skip_holidays | false | Dates in `Holidays` credit zero units. |
| tolerance | 0 | Days. Candidates are members within `tolerance` of the lowest projected score. |
| min_distance | 0 | Regular shifts of rest required on both sides of a slot. |
| tiebreak | order | `order` or `shuffle`. |
| seed | 0 | Integer mixed into the shuffle hash. |
| baseline | median | Default for joiners: `median`, `mean`, `min`, `max`. |
| precredit | auto | Regular shifts after the snapshot within which pinned shifts are pre-credited. `auto` means the roster size. `0` disables. |

The first row of a new rotation must be a `set` row with at least `period`,
followed by a `team` row. Dating the `set` row at the intended first shift
start makes it the anchor.

### 3.6 Same-instant ordering

Rows with equal `start` sort as: `error`, `set`, `snapshot`, `team`, `join`,
`leave`, `score`, `exclude`, `include`, `shift`. State changes at an instant
therefore apply before the shift starting at it. Sorting is stable, so user
order is kept otherwise.

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

## 5. Algorithm

One run processes all rotations together. Input: the ledgers, `Holidays`,
`Links`, and `now`. Output: new ledgers, status data, and a list of errors.
`now` is consumed by step 5.2 only. Everything from 5.3 on depends on the
ledger alone, so `regenerate(ledgers, holidays, links)` is a pure function of
the sheet content and can be tested without a clock.

### 5.1 Read and validate

Parse every ledger row. Drop `error` rows. Collect validation errors with row
references: unknown type, bad datetime, bad duration, both `end` and
`duration` set, `who` missing or multi-valued where required, `arg` missing
where required, unknown setting key, `join` of a current member, `leave` or
`exclude` of an unknown member, first row not a `set` with `period`. If any
error exists in any tab, no regeneration happens in this run; see 6.

### 5.2 Advance the snapshot

For each rotation compute the new snapshot instant `S`:

1. If a shift row contains `now` (latest shift with `start <= now`, extent
   covering `now`), `S` is its start.
2. Otherwise `S` is the grid boundary at or before `now`, in the grid
   effective at `now`.
3. `S` is raised to the `anchor` if that is later, so a rotation whose first
   `set` row is dated next Monday starts next Monday.
4. `S` is raised to the start of the first `team` or `join` row if that is
   later, so no slot is generated before there is a roster.
5. `S` is never earlier than the existing snapshot.

The snapshot row is placed at `S`. Its scores are filled in by the sweep in
5.5, which records roster and scores when it passes `S`. If the script has not
run for a while, the span between the last shift and `S` stays empty and is
ignored; the current period is generated from its grid boundary, partly in the
past.

### 5.3 Prune and sort

Delete unpinned `shift` rows with `start > S`. Everything else is kept: rows
before `S`, the current shift at `S`, pinned shifts, and all user rows dated
after `S`. Stable sort by `start` and the 3.6 type order.

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

Pinned shifts with `start` in `(S, S + precredit * period)` whose assignee is
on the roster are credited when the sweep reaches `S`, after the state rows at
`S` and after the snapshot is recorded, and skipped when the sweep reaches
them. Doing it at `S` lets a fresh ledger's `team` row dated `S` and
`precredit = auto` work. This lets someone who volunteered for a shift inside
the next cycle skip a turn before it. Pins further out are credited when
reached, and the greedy compensates afterwards.

### 5.6 Sweep

Walk all items of all rotations in `start` order, ties broken by rotation
order (Links order, else tab order) and by 3.6. Replay begins at each
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
   theirs, kept or already generated, overlapping `[a - D, b + D)` where
   `D = min_distance * period`.
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

### 5.9 Properties

- Deterministic: no clock in regeneration, no randomness, hash-based shuffle.
- Idempotent: generated rows are deleted and recreated from the same state.
  Running twice with the same `now`, or any `now` inside the same current
  shift, yields the same sheet.
- Settings changes apply from their `set` row forward. Editing a `set` row in
  the past rescores history, which is intended.
- Pinned rows, rows before the snapshot, and the current shift are never
  touched. The current shift is editable; changing its assignee reshapes the
  future.

## 6. Errors and warnings

The script writes diagnostics into the sheet as `error` rows. They are removed
on the next read, so fixing the cause and rerunning clears them.

- Validation errors: the run writes every tab back with its rows unchanged,
  with an `error` row for each offending row using the same `start`, so it
  sorts directly above the row it describes. Rotation-level errors use the
  `start` of the first row. No prune, no regeneration, no snapshot move in any
  tab.
- Unassignable slot: a `shift` with nobody plus an `error` row at the slot
  start. The empty shift keeps the interval rules intact.
- Relaxation used: text in the generated shift's `note`, and in `Status` from
  stage 3.
- Dangling link to a missing rotation tab: `error` row in `Links`, link ignored.

## 7. Multiple rotations and Links (stage 4)

Rotations are tabs and can appear or disappear at any time. Relations between
them live in the `Links` tab, a timeline with the same column layout as a
ledger:

```
pin | start | type | who | arg | end | duration | note
```

- `link`: `arg` is `distinct: primary, secondary` or `joined: alerts, tickets`.
  Active from `start` until `end`, `duration`, or a matching `unlink` row.
- `unlink`: same `arg`, ends the relation.

`distinct` removes from a slot's candidates any member holding an overlapping
shift in a linked rotation that was decided earlier in the sweep. Rotations
listed earlier in the link are decided first at equal starts. `joined` prefers
the member holding an overlapping shift in a linked rotation if they are inside
the tolerance band, otherwise normal selection applies. `distinct` is hard and
is never relaxed. Stage 1 already sweeps all rotations in one merged time
order, so stage 4 adds only the `Links` reader and two candidate filters. A
synthetic all-rotations view tab can be added with `Status`.

## 8. Code layout

```
build.sh              bundle src/ into dist/Code.js and copy the manifest
test.sh               node --test test/
src/
  00_util.js          naive datetime, durations, lists, FNV-1a, CSV
  10_model.js         row parsing, validation, serialization
  20_calendar.js      grid, claims, units
  30_state.js         roster, scores, exclusions, settings replay
  40_scheduler.js     prune, claims, pre-credit, sweep, selection
  50_status.js        status data (stage 3)
  60_links.js         Links reader and filters (stage 4)
  90_gas.js           Apps Script entry points and Sheets adapter
  appsscript.json     V8 runtime, time zone
node/
  load.js             evaluates src/*.js except 90_gas.js into one vm context
  storage.js          in-memory and CSV directory adapters
  cli.js              node node/cli.js --dir DIR --now ISO [--write]
test/
  *.test.js           unit tests
  fixtures/<case>/    golden scenarios
dist/                 build output, not committed
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
readLinks()     -> rows[]
writeLedger(rotation, rows)
writeStatus(data)
```

`90_gas.js` implements it on `SpreadsheetApp`, `node/storage.js` on memory and
CSV files. The runner in each adapter obtains `now`, converts it to the
spreadsheet time zone, calls `advance` and then `regenerate`, and writes.

Apps Script menu: `Run now`, `Dry run` (writes `<rotation>.preview` tabs),
`Install nightly trigger`, `Remove trigger`.

## 9. Testing

- Unit tests: datetime parsing and formatting, durations, list grammar, units
  with skipped days, grid and claims, selection with each tiebreak, relaxation.
- Golden scenarios: a fixture directory holds `now.txt`, `holidays.csv`,
  optional `links.csv`, one `<rotation>.csv` per ledger, and
  `expected/<rotation>.csv`. The test runs the core and compares. A second run
  on the output must reproduce it exactly.
- Scenarios: fresh sheet bootstrap; steady state; pin a future shift; swap two
  assignees; vacation exclusion; join with each baseline; leave and rejoin;
  team row diff; partial substitution with fill shift; stale run resumes at
  the current grid boundary; tolerance and min_distance interplay; shuffle
  determinism across runs; period change via `set`; validation errors produce
  error rows and no other change; unassignable slot; snapshot deletion
  triggers full replay.

## 10. Deployment

Two paths, both in INSTALL.md.

- `clasp`: `build.sh` then `clasp push` from `dist/`. `clasp` is an external
  tool, not a project dependency.
- Manual: create an Apps Script project bound to the spreadsheet, paste
  `dist/Code.js` and `appsscript.json`, run `onOpen` once to authorise, use the
  menu to install the nightly trigger.

INSTALL.md also provides the spreadsheet template: header row, `start`, `end`
columns formatted as plain text, initial `set` and `team` rows, `Holidays` tab.

## 11. Stages

1. Core, memory and CSV adapters, CLI, tests, DESIGN.md.
2. Apps Script adapter, menu, trigger, README.md, INSTALL.md.
3. `Status` tab and all-rotations view.
4. `Links` tab with `distinct` and `joined`.

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

## 13. Future extensions

- Month-based periods with day-of-month anchors.
- A `Members` tab mapping ids to names and emails for notifications.
- Calendar or PagerDuty export from the ledger.
- Concurrency guard via read-compute-reread-compare if runs ever collide with
  editing.
- A terminator `shift` row with nobody at `horizonEnd`, if a visible end of
  the schedule turns out to be wanted.
