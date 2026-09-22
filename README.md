# Rotalator

Rotalator keeps an on-call rotation topped up in a shared Google Spreadsheet.
Each rotation is a tab with a time-sorted ledger of shifts and events. People
edit the ledger to express team changes, vacations, swaps and settings; the
script runs nightly or from a menu, replays the history, and rewrites the
future so that on-call load stays fair.

- Fairness is measured in fractional days over the whole history.
- The schedule is generated up to a horizon (default 90 days).
- Runs are deterministic and idempotent: the same sheet gives the same result,
  and a second run changes nothing.
- No UI beyond the spreadsheet. No runtime dependencies.

Setup and deployment are in [INSTALL.md](INSTALL.md). The design is in
[DESIGN.md](DESIGN.md).

## Tabs

| Tab | Who writes it | Purpose |
|---|---|---|
| `<rotation>` | users and script | One per rotation. The tab name is the rotation name. |
| `Holidays` | users | Column A date `YYYY-MM-DD`, column B note. Shared by all rotations. |
| `Status` | script | Scores, last and next shifts, exclusions, warnings. Rewritten on every run. |
| `Shifts` | script | Every shift of every rotation in one table. Rewritten on every run. |
| `<rotation>.preview` | script | Output of a dry run. |
| `Links` | users | Reserved for relations between rotations (not yet implemented). |

A tab is a ledger when its first row is exactly the header below. Tabs whose
name starts with `.` and tabs without the header are ignored.

## Ledger columns

```
pin | start | type | who | arg | end | duration | note
```

| Column | Meaning |
|---|---|
| `pin` | Any non-empty value (`x`, or a ticked checkbox). Pinned rows are never modified or deleted by the script. |
| `start` | `YYYY-MM-DDTHH:MM` in the spreadsheet time zone. Mandatory. A space instead of `T`, a date without time (`00:00`) and real date cells are accepted on read; the script always writes the canonical form. |
| `type` | Row type, see below. Case-insensitive. |
| `who` | Exactly one member id, or empty. Used by `shift`, `join`, `leave`, `exclude`, `include`. |
| `arg` | Argument for types that take a list or expression. |
| `end` | `YYYY-MM-DDTHH:MM`. Optional. Cannot be combined with `duration`. |
| `duration` | Integer plus unit, chained from large to small: `1w`, `3d`, `12h`, `1d12h`, `90m`. Optional. |
| `note` | Free text. Kept on user rows, written by the script on generated rows. |

Member ids are any text without `,` `;` `=` `+`, matched verbatim. Lists are
separated by `,` or `;`. Nobody is an empty `who`, `-` or `none`. Rows are kept
sorted by `start`; rows with equal `start` sort as `error`, `set`, `snapshot`,
`team`, `join`, `leave`, `score`, `exclude`, `include`, `shift`, so state
changes apply before the shift that starts at the same instant.

## Row types

| type | who | arg | end/duration | written by | meaning |
|---|---|---|---|---|---|
| `shift` | member or nobody | | optional | users, script | `who` is on call from `start`. |
| `team` | | roster list | | users | Sets the full roster. Diffed against the current roster. |
| `join` | member | baseline, optional | | users | One member joins. |
| `leave` | member | | | users | Member leaves; score discarded. |
| `exclude` | member | | optional | users | Member is not eligible from `start` until `end`, `duration`, or an `include`. Score kept. |
| `include` | member | | | users | Ends an active exclusion. |
| `score` | | adjustments list | | users | Manual score corrections. |
| `set` | | `key=value` list | | users | Settings from `start` onward. |
| `snapshot` | | roster with scores | | script | Replay boundary and score cache. One per rotation. |
| `error` | | message | | script | Diagnostic. Removed on every read. |

Example rows, one per type:

| pin | start | type | who | arg | end | duration | note |
|---|---|---|---|---|---|---|---|
| | `2026-06-01T09:00` | `set` | | `period=1w, horizon=12w` | | | |
| | `2026-06-01T09:00` | `team` | | `alice, bob, carol=median, dave=12, erin+=2` | | | |
| | `2026-06-01T09:00` | `shift` | `alice` | | | | |
| `x` | `2026-06-09T09:00` | `shift` | `dave` | | | `1d` | covering for bob |
| | `2026-09-14T09:00` | `join` | `frank` | `min` | | | |
| | `2026-07-13T09:00` | `leave` | `bob` | | | | |
| | `2026-09-21T00:00` | `exclude` | `bob` | | | `3w` | vacation |
| | `2026-09-28T00:00` | `include` | `bob` | | | | back early |
| | `2026-06-01T09:00` | `score` | | `alice=10, bob+=2, carol-=1` | | | pre-history |
| | `2026-09-07T09:00` | `snapshot` | | `alice=28.00, bob=28.00, carol=21.00` | | | |
| | `2026-09-15T09:00` | `error` | | `unknown type "vacation"` | | | |

Details per type:

- **shift.** The scored interval runs from `start` to the explicit `end`,
  otherwise to the earlier of the next shift's `start` and the next grid
  boundary after `start`. A shift without `end` or `duration` therefore counts
  as at most one period. Unpinned shifts after the snapshot belong to the
  script and are regenerated on every run.
- **team.** `alice, bob, carol=median, dave=12, erin+=2`. Members absent from
  the list leave, new members join with the given baseline or the `baseline`
  setting, `name=number` sets a score, `name+=n` and `name-=n` adjust one. The
  list order becomes the roster order used by the `order` tiebreak.
- **join.** `arg` is `median`, `mean`, `min`, `max` or a number, default the
  `baseline` setting. Baselines are computed from the projected scores of the
  roster at that instant, including excluded members. Joining a current member
  is an error.
- **leave.** A later `join` starts fresh with a baseline.
- **exclude / include.** Without `end`, `duration` or a later `include` the
  exclusion is open-ended. The member still counts for baselines.
- **score.** `alice=10, bob+=2, carol-=1`. Use it for history that is not in
  the ledger.
- **set.** Always replayed from the top of the ledger, even when older than
  the snapshot. A `set` that changes `period` or `anchor` realigns the grid
  from its `start`.
- **snapshot.** Written by the script at the start of the current shift, with
  the roster and scores as of that instant. Rows before it are not replayed
  (except `set` rows and intervals that extend past it). Delete it to force a
  full replay from the top.
- **error.** See Errors below.

## Settings

Keys of the `set` row's `arg`, as `key=value` items. Booleans accept `true`,
`false`, `yes`, `no`, `1`, `0`.

| key | default | meaning |
|---|---|---|
| `period` | required | Regular shift length, `Nd` or `Nw`. |
| `anchor` | `start` of the `set` row | A grid instant. Shifts start and end at `anchor + k * period`. Also the earliest instant the schedule can begin. |
| `horizon` | `90d` | Generate shifts up to the first grid boundary at or after `snapshot + horizon`. |
| `skip_weekends` | `false` | Saturdays and Sundays credit zero days. |
| `skip_holidays` | `false` | Dates in `Holidays` credit zero days. |
| `tolerance` | `0` | Days. Members within `tolerance` of the lowest projected score are candidates. |
| `min_distance` | `0` | Regular shifts of rest required on both sides of a slot. Relaxed one step at a time when nobody is eligible. |
| `tiebreak` | `order` | `order`: walk the roster cyclically after the previous assignee. `shuffle`: deterministic hash of seed, rotation, slot start and member. |
| `seed` | `0` | Integer mixed into the shuffle hash. |
| `baseline` | `median` | Default score for joiners: `median`, `mean`, `min`, `max`. |
| `precredit` | `auto` | Number of regular shifts after the snapshot within which pinned shifts are credited before slots are assigned. `auto` is the roster size. `0` disables. |

The first row of a rotation must be a `set` row with at least `period`,
followed by a `team` row. Dating the `set` row at the intended first shift
start makes it the anchor.

## How a run works

1. Read every ledger tab and `Holidays`, drop `error` rows, validate.
2. Move the snapshot to the start of the shift that contains `now`, or to the
   grid boundary at or before `now`. The snapshot never moves backwards.
3. Delete unpinned shifts after the snapshot. Keep everything else.
4. Replay from the snapshot: apply `team`, `join`, `leave`, `score`,
   `exclude`, `include` rows in time order, credit kept shifts, and fill every
   uncovered span up to the horizon with the member who has the lowest
   projected score among the eligible ones.
5. Write each ledger back sorted, with the new snapshot and generated shifts.
   Rewrite `Status` and `Shifts`.

Scores are days on call, honouring `skip_weekends` and `skip_holidays`.
A week is 7 days, or 5 with `skip_weekends`. Partial shifts credit fractions.

## Everyday tasks

**Update the team.** Add a `team` row dated when the change takes effect with
the complete new list, or a `join` or `leave` row for one person. The future
is regenerated from that instant.

**Amend a future shift.** Edit the generated row's `who`, put anything in
`pin`, and run. Pins inside the next `precredit` shifts are credited up front,
so the volunteer's regular turn is skipped. Unpinned edits to future shifts
are lost on the next run.

**Swap two shifts.** Exchange the `who` of both rows and pin both.

**Vacation.** Add `exclude` with `who`, `start` and `duration` or `end`. Add
`include` to end it early. Scores are unaffected.

**Partial substitution.** Add a pinned `shift` for the substitute with `start`
and `duration` inside the running shift. The original shift is credited up to
the substitute's start, and the remainder of the period is filled by a short
generated shift.

**Change settings.** Add a `set` row dated when the change applies. Editing an
old `set` row rescores history from that point.

**Correct history.** Add a `score` row, or edit rows before the snapshot and
delete the `snapshot` row to replay everything from the top.

**Preview.** Use `Rotalator > Dry run`. It writes `<rotation>.preview` tabs,
`Status` and `Shifts` and leaves the ledgers untouched.

## Status and Shifts tabs

`Status` starts with the run instant and mode (`run` or `dry run`). For each
rotation it shows the snapshot instant and the horizon end, then one line per
member: score at the snapshot, projected score at the horizon end, last shift
(latest start at or before the snapshot), next shift (first start after it),
and exclusions active at the snapshot with their end or `open`. A warnings
table follows with relaxed `min_distance` and unassignable slots. After a
validation error the tab lists the errors instead of rotations.

`Shifts` is one table of every shift of every rotation, sorted by start:
start, end, rotation, who, pinned, note. The end is the scored end of the
shift. Both tabs are rewritten by every run, including dry runs.

## What the script never touches

- Pinned rows.
- Rows at or before the snapshot, apart from re-sorting and writing `start`,
  `end` and `type` in canonical form.
- The current shift (the shift row starting at the snapshot instant).
- The content of user rows: `team`, `join`, `leave`, `exclude`, `include`,
  `score`, `set`. They are re-sorted and canonicalised like any other row.
- The header row, tabs that are not ledgers, and columns beyond `note`.
- Cell formatting is not preserved when sorting moves a row. Values are.

## Errors

Problems are written into the ledger as `error` rows with the same `start` as
the offending row, so they sort directly above it. While any ledger has a
validation error, no tab is regenerated and no snapshot moves. Error rows are
removed on every read, so fixing the cause and running again clears them. In
Sheets a run also shows a toast with the error count and the first message; the
CLI prints them to stderr.

An unassignable slot (everyone excluded) produces a `shift` with nobody plus an
`error` row at the slot start. A relaxed `min_distance` is recorded in the
generated shift's `note`.

## Limitations

- Hand-entered history shifts longer than one period need `duration` or
  `end`; otherwise only the first period is credited.
- No concurrency protection. Edits to unpinned future shifts made while the
  nightly run is in progress may be overwritten.
- Edits to rows older than the snapshot have no effect until the snapshot is
  deleted. Use `score` rows for corrections.
- Period in months is not supported.
- Members are identified by the verbatim string. Renaming means editing
  history or adding a `score` row.
- Only the eight ledger columns are managed. Extra columns do not follow rows
  when the ledger is re-sorted.
- `Links` between rotations are planned, not implemented.

## Local dry runs

The core also runs in Node without a spreadsheet, using a directory of CSV
files: one `<rotation>.csv` per ledger with the header row, `holidays.csv`
(`date,note`), optional `links.csv`, and `now.txt` with the run instant.

```
node node/cli.js --dir DIR [--now YYYY-MM-DDTHH:MM] [--write] [--status]
```

Without `--write` the regenerated ledgers are printed as CSV and nothing is
changed. `--status` appends the Status and Shifts tables as plain text. Errors
go to stderr and set exit code 1. See `test/fixtures/` for worked scenarios,
each with a README explaining the expected result.
