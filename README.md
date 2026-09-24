# Rotalator

Rotalator keeps an on-call rotation topped up in a shared Google Spreadsheet.
Each rotation is a tab with a time-sorted ledger of shifts and events. People
edit the ledger to express team changes, vacations, swaps and settings; the
script runs nightly or from a menu, replays the history, and rewrites the
future so that on-call load stays fair.

- Fairness is measured in fractional days over the whole history.
- The schedule is generated up to a horizon (default 90 days).
- Runs are deterministic and idempotent: the same spreadsheet gives the same
  result, and a second run changes nothing.
- No UI beyond the spreadsheet. No runtime dependencies.

Rotalator stays a periodic, idempotent script that edits a spreadsheet: no
app, no UI beyond the spreadsheet and its menu. Pragmatic spreadsheet
conventions (a column, a row type, a tab name prefix) are preferred over new
components, and nothing is added as a dependency without the owner's
approval.

Setup and deployment are in [INSTALL.md](INSTALL.md). The design is in
[DESIGN.md](DESIGN.md).

## Tabs

| Tab | Who writes it | Purpose |
|---|---|---|
| `<rotation>` | users and script | One per rotation. The tab name is the rotation name. |
| `#Holidays` | users | Column A date `YYYY-MM-DD`, column B note. Shared by all rotations. |
| `#Status` | script | Recognised tabs, scores, last and next shifts, exclusions, warnings. Rewritten on every run. |
| `#All shifts` | script | Every shift of every rotation in one table. Rewritten on every run. |
| `#Preview <rotation>`, `#Preview Global` | script | Output of a dry run. |
| `#Global` | users and script | Spreadsheet-wide `set` defaults and relations between rotations, see below. The script adds `error` rows. |

A tab whose name starts with `#` is a system tab and never a rotation. Any
other tab is a rotation when its first row is exactly the header below;
anything else is ignored and listed under `ignored` in `#Status`. To disable a
rotation, rename its tab to `#<rotation>`: it is neither read nor written,
links naming it get an `error` row in `#Global`, and renaming it back later
resumes like a run after a pause.

## Ledger columns

```
pin | start | type | what | end | duration | note
```

| Column | Meaning |
|---|---|
| `pin` | Any non-empty value (`x`, or a ticked checkbox). Pinned rows are never modified or deleted by the script. |
| `start` | `YYYY-MM-DDTHH:MM` in the spreadsheet time zone. Mandatory. A space instead of `T`, a date without time (`00:00`) and real date cells are accepted on read; the script always writes the canonical form. |
| `type` | Row type, see below. Case-insensitive. |
| `what` | The row's payload: a member, a list of items, settings or a message, depending on `type`. |
| `end` | `YYYY-MM-DDTHH:MM`. Optional. Cannot be combined with `duration`. |
| `duration` | Integer plus unit, chained from large to small: `1w`, `3d`, `12h`, `1d12h`, `90m`. Optional. |
| `note` | Free text. Kept on user rows, written by the script on generated rows. |

Every list in `what` uses one grammar: items separated by `,` or `;`, each
item `name`, `name=value`, `name+=n` or `name-=n`. Member ids are any text
without `,` `;` `=` `+`, matched verbatim. Nobody is an empty `what` on a
`shift`, `-` or `none`. Rows are kept sorted by `start`; rows with equal
`start` sort as comment, `error`, `set`, `snapshot`, `team`, `join`, `leave`,
`score`, `exclude`, `include`, `shift`, so state changes apply before the
shift that starts at the same instant.

## Row types

| type | what | end/duration | written by | meaning |
|---|---|---|---|---|
| `shift` | one member, or nobody | optional | users, script | The member is on call from `start`. |
| `team` | `name`, `name=baseline`, `name=number`, `name+=n`, `name-=n` | | users | Sets the full roster. Diffed against the current roster. |
| `join` | `name`, `name=baseline`, `name=number`; one or more | | users | Members join. |
| `leave` | `name`; one or more | | users | Members leave; scores discarded. |
| `exclude` | `name`; one or more | optional | users | Members are not eligible from `start` until `end`, `duration`, or an `include`. Scores kept. |
| `include` | `name`; one or more | | users | Ends active exclusions. |
| `score` | same forms as `team` | | users | Manual score corrections for the members mentioned. |
| `set` | `key`, `key=value` | | users | Settings from `start` onward. |
| `snapshot` | `name=score` | | script | Replay boundary and score cache. One per rotation. |
| `error` | message | | script | Diagnostic. Removed on every read. |
| (empty) | free text | | users | Comment. Ignored by the script, kept in place. |

Example rows, one per item form:

| pin | start | type | what | end | duration | note |
|---|---|---|---|---|---|---|
| | `2026-06-01T09:00` | `set` | `period=1w, horizon=12w` | | | |
| | `2026-06-01T09:00` | `team` | `alice, bob, carol=median, dave=12, erin+=2` | | | |
| | `2026-06-01T09:00` | `shift` | `alice` | | | |
| `x` | `2026-06-09T09:00` | `shift` | `dave` | | `1d` | covering for bob |
| | `2026-06-29T09:00` | `shift` | `-` | | | nobody on call |
| | `2026-09-14T09:00` | `join` | `frank=min, gina` | | | |
| | `2026-07-13T09:00` | `leave` | `bob` | | | |
| | `2026-09-21T00:00` | `exclude` | `bob, carol` | | `3w` | offsite |
| | `2026-09-28T00:00` | `include` | `bob` | | | back early |
| | `2026-06-01T09:00` | `score` | `alice=10, bob+=2, carol-=1, dave=mean` | | | pre-history |
| | `2026-10-05T09:00` | `set` | `anchor, tolerance` | | | re-anchor, tolerance back to 0 |
| | `2026-09-07T09:00` | `snapshot` | `alice=28, bob=28, carol=21` | | | |
| | `2026-09-15T09:00` | `error` | `unknown type "vacation"` | | | |
| | `2026-06-15T09:00` | | `carol swapped with bob this week` | | | |
| | | | `todo: add the new hire in July` | | | |

The examples above use a 09:00 shift start to show that any time of day works;
the templates and `init` default to Monday 00:00.

Details per type:

- **shift.** `what` is one member id, or nobody (`-`, `none` or empty). The
  scored interval runs from `start` to the explicit `end`, otherwise to the
  earlier of the next shift's `start` and the next grid boundary after
  `start`. Unpinned shifts after the snapshot belong to the script and are
  regenerated on every run.

  A shift without `end` or `duration` ends at the earlier of the next shift's
  start and the next grid boundary, so it counts as at most one period. When
  you enter history by hand, give every shift that spans several periods a
  `duration` or an `end`; otherwise only its first period is credited.
- **team.** `alice, bob, carol=median, dave=12, erin+=2`. Members absent from
  the list leave, new members join with the given baseline or the `baseline`
  setting, `name=number` sets a score, `name=median|mean|min|max` sets an
  existing member to that aggregate, `name+=n` and `name-=n` adjust one. The
  list order becomes the roster order used by the `order` tiebreak.
- **join.** One or more members: `frank=min, gina`. The value is `median`,
  `mean`, `min`, `max` or a number, default the `baseline` setting. Baselines
  are computed from the projected scores of the roster at that instant,
  including excluded members; joiners are added one by one. Joining a current
  member is an error.
- **leave.** One or more members. A later `join` starts fresh with a baseline.
- **exclude / include.** One or more members; `end` or `duration` apply to
  all of them. Without `end`, `duration` or a later `include` the exclusion is
  open-ended. The members still count for baselines.
- **score.** `alice=10, bob+=2, carol-=1, dave=mean`. Same forms as `team`,
  but only the members mentioned change and they must be on the roster; a
  bare name does nothing. Use it for history that is not in the ledger.
- **set.** `key=value` items, or a bare `key` to apply the key's default
  (`anchor` takes the row's `start`). Always replayed from the top of the
  ledger, even when older than the snapshot. A `set` that changes `period` or
  `anchor` realigns the grid from its `start`.
- **snapshot.** Written by the script at the start of the current shift, with
  the roster and scores as of that instant. Rows before it are not replayed
  (except `set` rows and intervals that extend past it). Delete it to force a
  full replay from the top.
- **error.** See Errors below.
- **comment.** Any row with an empty `type` and something in another cell.
  Never validated, replayed or regenerated. A dated comment sorts at its
  instant, first among the rows there. An undated comment stays directly
  above the next dated row below it, at that row's instant: a note above a
  generated shift stays above the shift at that instant run after run, even
  though the shift itself is regenerated. Undated comments with nothing dated
  below them stay at the end of the ledger. A `start` that does not parse
  counts as undated and is reported as a warning in `#Status`. Comments work
  in `#Global` too.

## Settings

Keys of the `set` row's `what`, as `key=value` items or bare keys. A bare key
applies the default in this table; `anchor` is always bare and takes the row's
`start`; `period` always needs a value. Booleans accept `true`, `false`,
`yes`, `no`, `1`, `0`.

`set` rows also work in `#Global`, where they are defaults for every rotation
from their `start` on. A rotation's own value wins for the keys it has set; a
bare key in the rotation hands the key back to the global value. Even
`period` and `anchor` may be global, so a rotation can start with an empty
`set` row (the only row type whose `what` may be empty). Do not write a bare
`anchor` there unless you mean it: it pins the anchor in the rotation, and a
later global period change then re-anchors the other rotations but not this
one. The `#Status` settings block shows where each value comes from:
`rotation`, `global` or `default`. A malformed global `set` row stops the run
like any ledger error.

| key | default | meaning |
|---|---|---|
| `period` | required | Regular shift length, `Nd` or `Nw` (`w` is `7d`). |
| `anchor` | `start` of the `set` row | A grid instant. Shifts start and end at `anchor + k * period`. Also the earliest instant the schedule can begin. Write a bare `anchor` in a `set` row dated at the new grid instant to realign the grid. |
| `grid` | `calendar` | `calendar`: shifts change every `period` of wall-clock time. `counted`: every `period` of counted days, the days not skipped by `skip_weekends` and `skip_holidays`; with `skip_weekends=true` a daily shift starting on Friday runs until Monday, and `1w` means seven counted days and drifts across weekdays. An anchor inside a skipped day counts as the boundary between the surrounding counted days. |
| `horizon` | `90d` | Generate shifts up to the first grid boundary at or after `snapshot + horizon`. |
| `skip_weekends` | `false` | Saturdays and Sundays credit zero days. |
| `skip_holidays` | `false` | Dates in `#Holidays` credit zero days. |
| `tolerance` | `0` | Days. Members within `tolerance` of the lowest projected score are candidates. |
| `min_distance` | `0` | Regular shifts (grid steps) of rest required on both sides of a slot. Relaxed one step at a time when nobody is eligible. |
| `tiebreak` | `order` | `order`: walk the roster cyclically after the previous assignee. `shuffle`: deterministic hash of seed, rotation, slot start and member. |
| `seed` | `0` | Integer mixed into the shuffle hash. |
| `baseline` | `median` | Default score for joiners: `median`, `mean`, `min`, `max`. |
| `precredit` | `auto` | Number of regular shifts after the snapshot within which pinned shifts are credited before slots are assigned. `auto` is the roster size. `0` disables. |

The first row of a rotation must be a `set` row with at least `period`,
followed by a `team` row. Dating the `set` row at the intended first shift
start makes it the anchor.

## How a run works

1. Read every ledger tab and `#Holidays`, drop `error` rows, validate.
2. Move the snapshot to the start of the shift that contains `now`, or to the
   grid boundary at or before `now`. The snapshot never moves backwards.
3. Delete unpinned shifts after the snapshot. Keep everything else.
4. Replay from the snapshot: apply `team`, `join`, `leave`, `score`,
   `exclude`, `include` rows in time order, credit kept shifts, and fill every
   uncovered span up to the horizon with the member who has the lowest
   projected score among the eligible ones.
5. Write each ledger back sorted, with the new snapshot and generated shifts.
   Rewrite `#Status` and `#All shifts`.

Scores are days on call, honouring `skip_weekends` and `skip_holidays`.
A week is 7 days, or 5 with `skip_weekends`. Partial shifts credit fractions.

## Setting up

The **Rotalator** menu has three tools that prepare the spreadsheet; none of
them opens a dialog and none rewrites existing data.

- **Set Up Spreadsheet** creates the missing system tabs, a first rotation
  `On-Call` from the template when there is none, and formats every rotation
  and system tab: monospace font, plain text on the ledger columns, bold grey
  frozen header with a note on each header cell, column widths, spare columns
  removed, tab colours on `#` tabs (blue for tabs the script writes, grey for
  `#Holidays` and `#Global`). Rotation tabs and `#Global` get conditional row
  colours by `type` (errors red, settings blue, roster changes teal, snapshot
  green, comment rows yellow, links green, unlinks grey); the tab's existing
  conditional rules are replaced. A new `#Global` gets its header and a
  comment row explaining the tab. It is idempotent.
- **Set Up Tab** fills the active tab from its name: an empty rotation tab
  gets the header, a `set` row with every setting at its default (bare
  `anchor`, dated the most recent Monday 00:00) and a sample `team` row; an
  empty `#Holidays` or `#Global` tab gets its header. Non-empty tabs are
  refused.
- **Fill Shifts Grid** fills the `start` of the selected rows of a rotation
  tab so they sit on the grid: empty rows above the first dated row are
  placed on the boundaries before it, empty rows below the last dated row on
  the boundaries after it, and gaps between dated shifts are filled. A dated
  row with only a `start` becomes a `shift`; `what`, `end` and `duration` are
  never written. Undated rows must be blank, `type` = `shift` only, or
  comments, which travel with the next dated row. Use it to lay out history
  before typing the names.

## Running

- **Run** regenerates every rotation and rewrites `#Status` and
  `#All shifts`. This is what the nightly trigger runs.
- **Run - dry run** writes `#Preview <rotation>` tabs instead of the ledgers,
  plus the status tabs.
- **Run for current rotation** and its dry run variant do the same for the
  active tab only; the other rotations are read but not written. The dry run
  writes that rotation's preview, `#Preview Global` when a `#Global` tab
  exists, and the status tabs. The active tab must be a rotation tab.
- **Install nightly trigger** schedules Run daily; **Remove trigger**
  deletes it.

INSTALL.md has the step by step.

## Everyday tasks

**Update the team.** Add a `team` row dated when the change takes effect with
the complete new list, or a `join` or `leave` row for one person. The future
is regenerated from that instant.

**Amend a future shift.** Edit the generated row's `what`, put anything in
`pin`, and run. Pins inside the next `precredit` shifts are credited up front,
so the volunteer's regular turn is skipped. Unpinned edits to future shifts
are lost on the next run.

**Swap two shifts.** Exchange the `what` of both rows and pin both.

**Vacation.** Add `exclude` with the member (or several) in `what`, `start`
and `duration` or `end`. Add `include` to end it early. Scores are unaffected.

**Partial substitution.** Add a pinned `shift` for the substitute with `start`
and `duration` inside the running shift. The original shift is credited up to
the substitute's start, and the remainder of the period is filled by a short
generated shift.

**Change settings.** Add a `set` row dated when the change applies. Editing an
old `set` row rescores history from that point.

**Correct history.** Add a `score` row, or edit rows before the snapshot and
delete the `snapshot` row to replay everything from the top.

**Pause a rotation.** Rename its tab to `#<rotation>`. It is skipped until
renamed back.

**Preview.** Use `Rotalator > Run - dry run` or `Run for current rotation
- dry run`. They write `#Preview <rotation>` tabs, `#Status` and `#All
shifts` and leave the ledgers untouched. A missing
preview tab is created right after its rotation tab.

## #Status and #All shifts tabs

`#Status` starts with the run instant and mode (`run` or `dry run`), then a
`tabs` block: the rotations found, the rotations regenerated in this run, the
number of holidays and link rows read, and the tabs ignored (a disabled
`#<rotation>` appears there). For each rotation it shows `rotation`,
`snapshot`, `horizon`, `current` (who is on call now and until when) and
`next` (who follows and from when), then a member table with one line per
member: an `x` in `current` for the member on call, score at the snapshot,
projected score at the horizon end, last shift (latest start at or before the
snapshot), next shift (first start after it), and exclusions active at the
snapshot with their end or `open`. A `settings`
block lists every setting with its value in effect at the run instant,
including defaults for keys never set; when a later `set` row exists, a `note`
row names its start, since the values change from there. A warnings table
appears when `min_distance` was relaxed or a slot was unassignable. After a
validation error the tab lists the errors instead of rotations.

`#All shifts` is one table of every shift of every rotation, sorted by start:
pin (the ledger's own pin text; a ticked checkbox shows as `x`), start, end,
rotation, who, note. The end is the scored end of the shift. A divider row
marked `now` separates past shifts from future ones, and each rotation's
current shift is highlighted. Both tabs are rewritten by every run, including
dry runs.

## Global defaults and links between rotations

The optional `#Global` tab has the same header row as a ledger and holds
three kinds of rows: `set` rows with spreadsheet-wide defaults (see Settings),
comments, and the `link` and `unlink` rows below, which relate rotations over
time.

| type | what | end/duration | effect |
|---|---|---|---|
| link | `distinct: primary, secondary` | optional | Nobody holds overlapping shifts in both rotations. |
| link | `joined: alerts, tickets` | optional | The same person is preferred for overlapping shifts. |
| unlink | same as the link | | Ends the link from `start`. |

```
pin,start,type,what,end,duration,note
,2026-06-01T09:00,link,"distinct: primary, secondary",,,one person on call
,2026-12-01T09:00,unlink,"distinct: primary, secondary",,,
```

Rotations named earlier in a link are decided first when shifts start at the
same instant. `distinct` is hard: when it leaves nobody, the slot gets an
empty `shift` and an `error` row like any unassignable slot. `joined` only
prefers someone who is already within `tolerance` of the lowest score;
otherwise the usual selection applies. Rotations may use different periods;
overlaps are compared on the actual intervals.

A link row that names a rotation without a tab (or a disabled `#` tab), has a
malformed `what`, or an `unlink` without an active link gets an `error` row
above it in `#Global` and is ignored. Unlike ledger errors and malformed
global `set` rows, this does not stop the run. `#Global` is written back
sorted; a dry run writes `#Preview Global`.

## What the script never touches

- Pinned rows.
- Rows at or before the snapshot, apart from re-sorting and writing `start`,
  `end` and `type` in canonical form.
- The current shift (the shift row starting at the snapshot instant).
- The content of user rows: `team`, `join`, `leave`, `exclude`, `include`,
  `score`, `set`. They are re-sorted and canonicalised like any other row.
- The header row, tabs that are not ledgers, `#` tabs other than its own, and
  columns beyond `note`.
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
- Only the seven ledger columns are managed. Extra columns do not follow rows
  when the ledger is re-sorted.

## Command line

The core also runs in Node without a spreadsheet, using a directory of CSV
files. Files map to tabs: one `<rotation>.csv` per ledger with the header row,
`holidays.csv` for `#Holidays` (`date,note`), optional `global.csv` for
`#Global`, `status.json` for the `#Status` and `#All shifts` data, and
`now.txt` with the run instant. A file named `#<anything>.csv` is never a
rotation, like a `#` tab, and other `.csv` files without the ledger header are
ignored.

```
bin/rotalator run DIR [--now YYYY-MM-DDTHH:MM] [--rotation NAME]...
                      [--write] [--status]
bin/rotalator init DIR --rotation NAME [--start YYYY-MM-DDTHH:MM]
                                       [--history-from YYYY-MM-DD]
bin/rotalator help
```

`run` regenerates the ledgers in `DIR`. Without `--write` they are printed as
CSV and nothing is changed. `--status` appends the `#Status` and `#All shifts`
tables as plain text. `--rotation NAME`, repeatable, regenerates only the named
rotations: the others are read so that links still see their shifts, but they
are neither printed nor written, and the `tabs` block of the status shows
which rotations were regenerated. An unknown name stops the run with nothing
written. Errors go to stderr and set exit code 1.

`init` creates `NAME.csv` from the rotation template, plus `holidays.csv` and
`now.txt` when they are missing. `--start` dates the `set` and `team` rows
(default: the most recent Monday 00:00 before `now`). `--history-from` adds
empty `shift` rows on the grid from that date up to the start; the `set` and
`team` rows are then dated at the first of those boundaries so the ledger
validates. Fill in the names, then `run`.

See `test/fixtures/` for worked scenarios, each with a README explaining the
expected result.
