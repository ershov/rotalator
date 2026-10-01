# Rotalator manual

How to use Rotalator day to day: the tabs and rows of the spreadsheet, the
settings, the menu, everyday tasks, the extensions and the command line.
Setup and deployment are in [INSTALL.md](INSTALL.md), the specification in
[DESIGN.md](DESIGN.md), the project overview in [README.md](README.md).

## Contents

- [Tabs](#tabs)
- [Ledger columns](#ledger-columns)
- [Row types](#row-types)
- [Settings](#settings)
  - [Intervals](#intervals)
- [How a run works](#how-a-run-works)
- [Setting up](#setting-up)
- [Running](#running)
- [Everyday tasks](#everyday-tasks)
- [#Status and #All shifts tabs](#status-and-all-shifts-tabs)
- [Global defaults, relations](#global-defaults-and-relations-between-rotations)
- [What the script never touches](#what-the-script-never-touches)
- [Errors](#errors)
- [Limitations](#limitations)
- [Google Calendar export](#google-calendar-export)
- [Slack messages and user groups](#slack-messages-and-user-groups)
- [Command line](#command-line)

## Tabs

| Tab | Who writes it | Purpose |
|---|---|---|
| `<rotation>` | users and script | One per rotation. The tab name is the rotation name. |
| `#Holidays` | users | Column A date `YYYY-MM-DD` (a date starting with `#` is commented out), column B note. Shared by all rotations. |
| `#Status` | script | Recognised tabs, scores, last and next shifts, exclusions, warnings. Rewritten on every run. |
| `#All shifts` | script | Every shift of every rotation in one table. Rewritten on every run. |
| `#Help` | script | Plain-text help on columns, rows, settings, intervals, relations and the menu. Rewritten by Set Up Spreadsheet and kept as the last tab. |
| `#Preview <rotation>` | script | Output of a preview: the ledger a run would write, formatted like the rotation tab. |
| `#Global` | users and script | Spreadsheet-wide `set` defaults and relations between rotations, see below. The script adds `error` rows. |
| `#GCal` | users | Calendar presets for the Google Calendar extension. Reserved: the core leaves it alone. |
| `#Slack`, `#Slack state` | users and script | Slack presets and cached ids, and what the Slack extension has posted. Reserved: the core leaves them alone. |

A tab whose name starts with `#` is a system tab and never a rotation. Any
other tab is a rotation when its first row is exactly the header below;
anything else is ignored and listed under `ignored` in `#Status`. To disable a
rotation, rename its tab to `#<rotation>`: it is neither read nor written,
relation rows naming it get an `error` row, and renaming it back later
resumes like a run after a pause.

## Ledger columns

```
pin | start | type | what | end | duration | note
```

| Column | Meaning |
|---|---|
| `pin` | Any non-empty value (`x`, or a ticked checkbox). Pinned rows are never modified or deleted by the script. The script writes its own marker `a` into empty pin cells of shifts that have started (see `autopin`). |
| `start` | `YYYY-MM-DD` for midnight, `YYYY-MM-DDTHH:MM` otherwise, in the spreadsheet time zone. Mandatory. A space instead of `T`, an explicit `T00:00` and real date cells are accepted on read; the script always writes the canonical form. |
| `type` | Row type, see below. Case-insensitive. |
| `what` | The row's payload: a member, a list of items, settings or a message, depending on `type`. |
| `end` | Same format as `start`. Optional. Cannot be combined with `duration`. |
| `duration` | An interval (see Intervals below): `1w`, `3d`, `12h`, `1d12h`, `0.5d`, `2sl`, `1ts`. Optional. |
| `note` | Free text. Yours: the script never writes into it, and generated shifts have an empty note. |

Every list in `what` uses one grammar: items separated by `,` or `;`, each
item `name`, `name=value`, `name+=n` or `name-=n`. Member ids are any text
without `,` `;` `=` `+`, matched verbatim. Nobody is an empty `what` on a
`shift`, `-` or `none`. Rows are kept sorted by `start`; rows with equal
`start` sort as comment, `error`, `set`, `snapshot`, `team`, `score`, `join`,
`leave`, `exclude`, `include`, `shift`, so state changes apply before the
shift that starts at the same instant and a `score` right after the `team`
row it corrects.

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
| (empty) or `#...` | free text | | users | Comment. Ignored by the script, kept in place; `#shift` comments a shift out. |

A `set`, `team`, `repel`, `repel!`, `attract` or `attract!` row without a
`start` takes the date of the nearest dated row above it: type `team` with
the new roster
right under the current shift and it applies from that shift on; the script
fills the `start` in on the next run. Several such rows may follow one
another and keep their order. Do not type one at the very bottom of the tab:
it would take the date of the last generated shift, months ahead. With no
dated row above it, the row is an epoch row: it applies from the beginning
of the timeline and sorts before every dated row, takes no `end` or
`duration`, and no bare `anchor`: the grid is anchored by a dated `set
anchor` row (in the rotation or in `#Global`), and no dated row may come
before it. The templates start every rotation this way: an epoch `set` with
the defaults, an epoch `team`, then `set anchor` dated at the first shift.

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
| | `2026-09-21` | `exclude` | `bob, carol` | | `3w` | offsite |
| | `2026-09-28` | `include` | `bob` | | | back early |
| | `2026-06-01T09:00` | `score` | `alice=10, bob+=2, carol-=1, dave=mean` | | | pre-history |
| | `2026-10-05T09:00` | `set` | `anchor, tolerance` | | | re-anchor, tolerance back to 0 |
| | `2026-09-07T09:00` | `snapshot` | `alice=28, bob=28, carol=21` | | | |
| | `2026-09-15T09:00` | `error` | `unknown type "vacation"` | | | |
| | `2026-06-15T09:00` | | `carol swapped with bob this week` | | | |
| | | | `todo: add the new hire in July` | | | |

The examples above use a 09:00 shift start to show that any time of day works;
the templates and `init` default to Monday midnight, written as the bare date
(`2026-06-01`).

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
- **comment.** Any row with an empty `type` and something in another cell,
  or with a `type` starting with `#`: `#shift` or `#team` comments the row
  out the way `#` disables a tab, keeps it as typed, and removing the `#`
  restores it. Commenting out a row has exactly the effect of deleting it:
  for a past `shift` that means nothing before the stored snapshot (see
  [Limitations](#limitations)) and a regenerated span after it. A comment is
  never validated, replayed or regenerated. A dated comment sorts at its
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
| `horizon` | `20w` | Interval. Generate shifts up to the first grid boundary at or after the snapshot plus `horizon`. |
| `skip_weekends` | `true` | Saturdays and Sundays credit zero days. |
| `skip_holidays` | `true` | Dates in `#Holidays` credit zero days. |
| `tolerance` | `0.5sl` | Members within `tolerance` of the lowest projected score are candidates. A plain number is days of score; `1sl` is what one regular shift earns at that point (honouring skipped days), `1ts` one full cycle, clock units are nominal days. |
| `min_distance` | `0.5ts` | Interval of rest required on both sides of a slot: `2sl` is two regular shifts, `3d` three days. Relaxed one shift length at a time when nobody is eligible. A plain number other than `0` is an error. |
| `tiebreak` | `order` | `order`: walk the roster cyclically after the previous assignee. `shuffle`: deterministic hash of seed, rotation, slot start and member. |
| `seed` | `0` | Integer mixed into the shuffle hash. |
| `baseline` | `median` | Default score for joiners: `median`, `mean`, `min`, `max`. |
| `precredit` | `1ts` | Interval after the snapshot within which pinned shifts are credited before slots are assigned; `1ts` is one full cycle of the current roster. `0` disables. |
| `autopin` | `a:2sl` | After each run, every shift starting up to `now + autopin` whose pin cell is empty gets the marker `a`: `0` pins the shifts that have started, `2w` also the next two weeks, `-2w` leaves the last two weeks unpinned, `1sl` and `0.5ts` are grid units, `false` pins nothing. `a:2w` (anything before the last colon) sets the marker. Existing pins are kept. |
| `cal` | empty | Space-separated names of calendar presets from the `#GCal` tab (`cal=team backup`; names are letters, digits, `-` and `_`). The Google Calendar extension exports the rotation's shifts to those calendars; without the extension the setting is accepted and `#Status` warns `calendar extension not installed`. |
| `slack` | empty | Space-separated names of Slack presets from the `#Slack` tab (`slack=team heads-up`), same grammar as `cal`. The Slack extension posts the messages and keeps the user groups; without the extension the setting is accepted and `#Status` warns `slack extension not installed`. |

### Intervals

`duration`, `horizon`, `min_distance`, `precredit` and a suffixed `tolerance`
take an interval: an amount and a unit. Clock units are `w`, `d`, `h`, `m`; a
single token may be fractional (`1.5w`, `0.5d`) and integer tokens chain from
large to small (`1d12h`). Two grid units stand alone: `sl` is one shift
length, the `period` in force at that point, and `ts` is the team size times
the shift length, one full cycle of the roster as it is at that point
(`0.5ts`, `2sl`). `0` is the zero interval; clock intervals must come to
whole minutes. From a grid instant `1sl` reaches the next boundary; from any
other instant it is one period along the grid timeline. With `grid=counted`,
intervals count counted days, so `2d` is two working days, and with
`skip_weekends` the default `horizon=20w` is 20 counted weeks, about 28
calendar weeks.
`period` itself takes clock units only.

A rotation needs a `period` in a `set` row and an anchor from a dated `set`
row (a bare `anchor`, or the row that sets `period`) before its first dated
row, plus a `team` row; the templates use an undated `set` and `team` row
followed by `set anchor` dated at the first shift. Without them the run stops
with `no period in force`, `no anchor` or `row before the anchor`.

## How a run works

1. Read every ledger tab and `#Holidays`, drop `error` rows, validate.
2. Move the snapshot to the start of the shift that contains `now`, or to the
   grid boundary at or before `now`. The snapshot never moves backwards.
3. Delete unpinned shifts after the previous run's snapshot, past ones
   included. Keep everything else: pinned shifts, comments, your rows. On the
   first run of a rotation, which has no snapshot yet, shifts you typed as
   history (unpinned, before `now`) are kept and pinned; gaps between them
   are filled.
4. Replay from that snapshot: apply `team`, `join`, `leave`, `score`,
   `exclude`, `include` rows in time order, credit kept shifts, and fill every
   uncovered span from the snapshot up to the horizon, past gaps included,
   with the member who has the lowest projected score among the eligible
   ones. A pinned `shift` row with an empty `what` is a gap you want kept.
5. Write each ledger back sorted, with the new snapshot and generated shifts.
   Rewrite `#Status` and `#All shifts`.

Scores are days on call, honouring `skip_weekends` and `skip_holidays`.
A week is 7 days, or 5 with `skip_weekends`. Partial shifts credit fractions.

## Setting up

The **Rotalator** menu has three tools that prepare the spreadsheet; none of
them opens a dialog and none rewrites existing data. Before the menu exists,
run the `Setup` function once from the Apps Script editor: it is the first
function in the list, installs the menu and asks for authorisation (see
INSTALL.md).

- **Set Up Spreadsheet** creates the missing system tabs, a first rotation
  `Rotation 1 Primary` from the template when there is none, and formats
  every rotation and system tab: monospace font, plain text on the ledger
  columns, bold grey frozen header with a note on each header cell, column
  widths, spare columns removed, tab colours on `#` tabs (blue for tabs the
  script writes, grey for `#Holidays` and `#Global`). Rotation tabs and
  `#Global` get conditional row colours by `type` (errors red, settings blue,
  roster changes teal, snapshot green, comment rows yellow, `attract` and
  `repel` green, `detach` grey); the tab's existing conditional rules are
  replaced. New `#Holidays` and `#Global` tabs get their templates, `#Global`
  is kept directly before `#Holidays`, the `#Help` tab is rewritten and moved
  to the end, and unused columns beyond each tab's content are removed. It is
  idempotent.
- **Set Up Tab** fills the active tab from its name. An empty rotation tab
  gets the header, help rows (comments listing what each row type takes in
  `what`, kept at the top of the tab), a `set` row with every setting at its
  default except `anchor` and a sample `team` row, both without `start` so
  they apply from the beginning, then a `set anchor` row dated the most
  recent Monday 00:00 where the first shift starts. An empty `#Global` gets
  the header, its own help rows and an undated `set` row of the same
  defaults; an empty `#Holidays` gets the header and a sample `New Year` row
  for the previous year. Non-empty tabs are refused.
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
- **Run - preview** writes `#Preview <rotation>` tabs instead of the
  ledgers, plus the status tabs; `#Global` is read but not written.
- **Run for current rotation** and its preview variant do the same for the
  active tab only; the other rotations are read but not written. The preview
  writes that rotation's preview tab and the status tabs. The active tab must
  be a rotation tab.
- **Abort run** asks the run in progress to stop: its calendar export or
  clean stops within a few seconds, at the next event, and says so in
  `#Status` and in a toast; with no run in progress it only says so. The
  ledgers are written before any export starts, so they are never left half
  done.
- **Install nightly trigger** schedules Run daily; **Remove trigger**
  deletes it.
- Installed extensions append their own items below these; the Google
  Calendar extension adds its re-export and clean items, the Slack extension
  its token, connection check, test message and hourly trigger items (see
  below).

One run at a time: every run, preview, re-export and clean, the nightly
trigger, the Slack connection check, test message and hourly trigger,
**Fill Shifts Grid** and **Set Up Spreadsheet** take a script lock. The
token items and the trigger installers take none.
If another run holds it, the action waits five seconds, then gives up with
the toast `another Rotalator run is in progress` and changes nothing. A run
also has a time budget of five minutes: a long calendar export stops between
events when it is reached and the next run continues where it left off, so
the Apps Script six-minute limit never interrupts a write. Progress shows as
toasts: how many events go to how many calendars, then during each calendar
loop `exporting <calendar>: X / Y events done, N s` at most every ten seconds
(re-exports and cleans say so), then the counts per calendar; the `Calendar`
block of `#Status` shows the elapsed seconds and, when a run stopped early,
why.

INSTALL.md has the step by step.

## Everyday tasks

**Update the team.** Add a `team` row dated when the change takes effect with
the complete new list, or a `join` or `leave` row for one person. The future
is regenerated from that instant.

**Amend a future shift.** Edit the generated row's `what`, put anything in
`pin`, and run. Pins inside the next `precredit` shifts are credited up front,
so the volunteer's regular turn is skipped. Unpinned edits to shifts are lost
on the next run, whether the shift is future, current or past: every unpinned
shift from the previous snapshot on is regenerated.

**Keep the near future stable.** Set `autopin=2w` (or `1ts` for one full
cycle) and every run pins the shifts up to two weeks ahead, so team or
settings changes only reshape the schedule beyond that window and people can
rely on what they see. Unpinning a shift inside the window by hand is undone
on the next run; lower `autopin` (or set it to `false`) to let near-future
shifts float again. The default `a:2sl` pins the shifts that have started
and the next two regular shifts; `a:0` pins only the shifts that have
started. With `autopin=false` the shifts between the previous run's snapshot
and now may be regenerated when unpinned; rows before that snapshot never
move. Regeneration is deterministic and looks only at rows at or before each
shift, so an unpinned past shift changes only when something before or at it
changed (a roster row, an exclusion, a setting, or a pin within
`min_distance` or the pre-credit window after it), never merely because it
was regenerated. Autopin never pins a shift with nobody, so an unassignable
slot keeps its `error` row until you fix the roster or pin the empty row
yourself as a wanted gap.

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

**Preview.** Use `Rotalator > Run - preview` or `Run for current rotation
- preview`. They write `#Preview <rotation>` tabs, `#Status` and `#All
shifts` and leave the ledgers and `#Global` untouched. A missing preview tab
is created right after its rotation tab; it looks like the rotation tab,
same header, widths and row colours.

## #Status and #All shifts tabs

`#Status` starts with the run instant and mode (`run` or `preview`), then a
`Tabs` block: the rotations found, the rotations regenerated in this run, the
number of holidays and `#Global` rows read, and the tabs ignored (a disabled
`#<rotation>` appears there). With several rotations and at least one
relation in force now, a `Relations` matrix follows: one row and one column
per rotation, `+` where the row's rotation attracts the column's (`+!` for
`attract!`), `-` where
it repels it; a mutual relation marks both cells, a one-sided one only the
row of the rotation whose tab holds it. Then one block per rotation, laid
out side by side: on the left `rotation`, `snapshot`, `horizon`, `current`
(who is on call now and until when) and `next` (who follows and from when);
in the middle a member table with one line per member: an `x` in `current`
for the member on call, score at the snapshot, projected score at the horizon
end, last shift (latest start at or before the snapshot), next shift (first
start after it), and exclusions active at the snapshot with their end or
`open`; on the right a `settings` table with every setting, its value in
effect at the run instant and its source (`rotation`, `global` or
`default`); when a later `set` row exists, a `note` row names its start,
since the values change from there. A warnings table appears when
`min_distance` or a `repel` was relaxed, a slot was unassignable or a
rotation uses `cal` or `slack` without its extension. After a validation error
the tab lists the errors instead of rotations. An installed extension may
append its own block at the end.

`#All shifts` is a grid with one column per rotation and one row per instant
at which any rotation changes hands: the cell holds who starts then, `-` for
a shift with nobody, and stays empty for rotations that do not change at that
instant. A `--now--` row separates past from future, and the cell of each
rotation's current shift is highlighted. A red cell is a shift that breaks a
relation in force at its start: the same person on both sides of a `repel`
or `repel!` (the rest window of `repel!` is not checked), or different
people on the two sides of an `attract` although either could have taken the
other's shift; hover the cell for the relation and the other rotation. A
relaxation, a pin or a hand edit are the usual causes; a vacation never
paints. Columns are sized to their content, at least 120px wide. Both tabs
are rewritten by every run, previews included.

## Global defaults and relations between rotations

The optional `#Global` tab has the same header row as a ledger and holds
three kinds of rows: `set` rows with spreadsheet-wide defaults (see Settings),
comments, and the relation rows below. Relation rows also go into rotation
tabs.

| type | what | end/duration | effect |
|---|---|---|---|
| repel | rotation names | optional | Nobody holds overlapping shifts in both rotations. |
| repel! | rotation names | optional | As `repel`, plus a rest: a member stays off one rotation for half the combined `min_distance` before and after their shift in the other. |
| attract | rotation names | optional | The same person is preferred for overlapping shifts, within `tolerance`. |
| attract! | rotation names | optional | As `attract`, and the tolerance band may widen up to one team round to follow the person on call in the other rotation. |
| detach | rotation names | optional | The rotations are no longer related. |

A relation row sets the state of every pair of rotations it names from its
`start`; the latest row wins per pair, and an `end` or `duration` returns the
pair to neutral at that instant. In `#Global` the row names all listed
rotations mutually:

```
pin,start,type,what,end,duration,note
,2026-06-01T09:00,repel,"primary, secondary",,,one person on call
,2026-12-01T09:00,detach,"primary, secondary",,,
```

In a rotation's own tab the row is one-sided: the tab reads the listed
rotations and adapts to their shifts, which are not affected. `repel primary`
in the `secondary` tab keeps `secondary` away from whoever holds `primary`
that week while `primary` schedules as if `secondary` did not exist. If both
tabs start the same relation on each other at the same instant, the pair is
mutual from then on, as if written in `#Global`.

When shifts start at the same instant, a rotation is decided after the
rotations it reads; otherwise, including for rotations related by a `#Global`
row, tab order decides who yields. Two tabs reading each other cannot be
ordered: both rows get an `error` row suggesting a `#Global` row and are
ignored.

`repel!` adds rest between the rotations: with `min_distance=1sl` in both, a
member who holds a week in one rotation is kept off the other for that week
and one week before and after it, since half of each rotation's rest applies
on each side (`(1sl + 1sl) / 2 = 1sl`). Each rotation's `min_distance` counts
in its own units, so a daily rotation with `2sl` and a weekly one with
`0.5ts` over four members give `(2d + 2w) / 2 = 8d`.

`repel` is soft: when it leaves nobody, the `repel!` rest window shrinks
first, one shift length per step, with the `#Status` warning `repel!
relaxed to <rest>`; then `min_distance` is relaxed; then the repel is dropped
with the warning `repel relaxed: <who> also on <rotation>`; only when even
that leaves nobody does the slot get an
empty `shift` and an `error` row. Overlapping shifts in both rotations stay
forbidden until the repel itself is dropped.
`attract` only prefers someone who is already within `tolerance` of the
lowest score; otherwise the usual selection applies, and two rotations drift
apart after an exclusion or a pin until the scores realign. `attract!`
follows the other rotation further: when nobody attracted is within
`tolerance`, the band widens to the person on call there, as long as their
score is at most one full team round (`1ts`) above the lowest plus
`tolerance`; `#Status` warns `tolerance widened to <n>sl for attract! with
<rotation>` at that shift. Exclusions, `min_distance` and repel are never
relaxed for it, and the member left behind stays lowest and catches up on
the next shifts the relation allows. Rotations may use
different periods; overlaps are compared on the actual intervals, but a
rotation only sees the shifts already decided when its slot comes up, so a
weekly rotation reading a daily one may still collide with the daily shifts
later in its week.

A relation row that names a rotation without a tab (or a disabled `#` tab),
names its own rotation or a rotation twice, or has a malformed `what` gets an
`error` row above it and is ignored. Unlike ledger errors and malformed
global `set` rows, this does not stop the run. `#Global` is written back
sorted; a preview leaves it alone.

## What the script never touches

- Pinned rows.
- Rows before the stored snapshot (the previous run's snapshot row), apart
  from re-sorting, writing `start`, `end` and `type` in canonical form, and
  the `autopin` marker in empty pin cells of shifts.
- Comments.
- The content of user rows: `team`, `join`, `leave`, `exclude`, `include`,
  `score`, `set`. They are re-sorted and canonicalised like any other row.
- The header row, tabs that are not ledgers, `#` tabs other than its own, and
  columns beyond `note`.
- Cell formatting is not preserved when sorting moves a row. Values are.

## Errors

Problems are written in place, as `error` rows next to what they describe:
in a ledger or `#Global` with the same `start` as the offending row, so they
sort directly above it; in `#GCal` directly above the offending row; a `cal`
value naming a preset that does not exist gets its row above the `set` row
that carries it; a calendar the script cannot open gets its row above the
preset's `id` in `#GCal`. While any ledger has a validation error, no tab is
regenerated and no snapshot moves. Error rows are removed on every read, so
fixing the cause and running again clears them. `#Status` lists every error
and warning as well, error rows in red and warning rows in orange, and every
run ends its toast with `finished with N error(s) and M warning(s)` or
`finished, no errors`. Every error and warning is also logged, one line each
(`error: ...`, `warning: <rotation> <start>: ...`): in the Apps Script
executions log for menu and trigger runs, on stderr for the CLI. The few
messages with
no row to attach to (a missing calendar extension, a comment whose date does
not parse, an extension that failed, an aborted export) appear in `#Status`
only.

An unassignable slot (everyone excluded) produces a `shift` with nobody plus an
`error` row at the slot start. A relaxed `min_distance` or repel is a
`#Status` warning naming the rotation and the shift start; the `note` cells
are yours and the script never writes into them.

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

## Google Calendar export

The Google Calendar extension is a second script file, `GCal.js`, installed
next to the core (INSTALL.md). With it, every rotation whose `cal` setting
names presets gets its shifts exported to the calendars those presets
describe, one event per shift and preset, after each successful run. Presets
live in the `#GCal` tab:

```
preset   | setting   | value
team     |           | Shared team calendar
         | id        | team@group.calendar.google.com
         | color     | pale blue
         | invite    | false
         | reminders | 1d, 1h
personal |           | Timed events for the person on call
         | id        | oncall@example.com
         | title     | On call: {who} ({start:%a %e %b} to {end:%a %e %b})
         | allday    | false
```

A row with a name in the first column starts a preset (the third column is
a note); a `#` in front of the name comments the whole block out, a `#` in
front of a setting that row only. The rows below a preset set `id`
(required), `title` and `body` templates, `allday` (`auto`: all-day when
the shift starts and ends at
midnight), `color` (`default` for the calendar's own colour, a Calendar
colour name, its number 1 to 11, or `#RRGGBB` for the nearest of the eleven
event colours), `free` (default true: the time shows as free), `invite`
(default true: the assignee is invited when their member id is an email
address) and `reminders` (intervals before the start, `1d, 30m`; empty, the
default, leaves the calendar's own default notifications in place).
Templates take `{who}`, `{rotation}`, `{note}`, `{pin}`, `{start}` and
`{end}`, the instants optionally with a strftime format (`%Y %m %d %e %H %M
%a %A %b %B %j %u`). Unknown placeholders stay as written and are reported.
Mistakes in `#GCal` are reported like ledger errors: every run writes an
`error` row directly above the offending row (and lists it in `#Status`);
the script removes its error rows on the next run, so fixing the row clears
them.

Then `set cal=team personal` in the rotation (or in `#Global` for every
rotation). Each run exports the shifts from the stored snapshot to the
horizon end: new shifts are created, changed ones updated (only the fields
that differ, no new invitations), events of shifts that no longer exist
deleted; events the script did not create are never touched, and shifts with
nobody get no event. A preview computes the counts without touching the
calendars. The `#Status` tab gets a `Calendar` block with the counts per
rotation and preset (`create`, `update`, `delete`, `unchanged`, `skipped`)
and any calendar errors, which never stop the ledger run. Without the
extension the `cal` setting is accepted and `#Status` warns that the
calendar extension is not installed.

Setting it up:

1. Install `GCal.js` next to the core and authorise the calendar access
   (INSTALL.md). **Set Up Spreadsheet** then creates the `#GCal` tab right
   after `#Global` with a cheat sheet of the settings and a first preset,
   `preset-1`, whose `id` reads `FILL IN WITH CALENDAR ID`; `#Help` gains a
   `CALENDAR` section. **Set Up Tab** on an empty `#GCal` writes the same
   template.
2. Create or pick the calendars and share each one with write access with
   every account that runs Rotalator: the people who click **Run** and the
   account that installed the nightly trigger.
3. Fill in the id of `preset-1` (rename it if you like), add a preset per
   further calendar, and put `cal=<presets>` in a `set` row of each rotation
   to export, or in `#Global`.

Menu items of the extension, below the core ones:

- **Re-export calendar** and **Re-export calendar: current rotation** export
  every shift from the first one, repairing a calendar that was cleaned or
  edited by hand. They run the scheduler without writing the ledgers, so run
  first if the ledger changed.
- **Clean calendar: current rotation** deletes the events Rotalator created
  for the active tab's rotation in its presets' calendars.
- **Clean calendar: selected preset** deletes every Rotalator event in the
  calendar of the preset on the selected row of `#GCal` (a setting row counts
  for the preset above it), within a year back and three years ahead.

Events carry the tag `rotalator=<rotation>|<start>`; that is how the script
finds them again, and events without it are never touched. Two presets of one
rotation must point at different calendars.

## Slack messages and user groups

The Slack extension is a second script file, `Slack.js`, installed next to
the core. With it, every rotation whose `slack` setting names presets gets a
message per shift to the channels and people those presets describe, and
Slack user groups such as `@oncall` follow the people on call. Presets live
in the `#Slack` tab with the grammar of `#GCal`, `#` prefixes included: a
`#` in front of a preset name comments the block out, in front of a setting
that row, and in front of the name of an `id` row that cached id:

```
preset   | setting | value
team     |         | Channel handover message and the @oncall group
         | to      | #oncall-team
         | group   | @oncall
heads-up |         | Reminder to the person three days before
         | to      | {who}
         | when    | -3d
         | text    | Reminder: you are on call for {rotation} from {start:%a %e %b} to {end:%a %e %b}
```

`to` lists destinations: a channel by id (`C…`) or name (`#oncall-team`), a
person by email or Slack id (`U…`), or `{who}`, `{prev}`, `{next}` for the
assignee of the shift, of the previous one and of the next one. `when` moves
the message relative to the shift start (`0` at the handover, `-3d` three
days before, `2h` after); `text` is the message template, taking `{who}`,
`{prev}`, `{next}`, `{rotation}`, `{start}`, `{end}`, `{note}`, `{pin}` and
`{group}`; `group` names a user group the people on call in every rotation
using the preset should form. A preset needs `to` or `group`. Rows `<member>
| id | U…` cache resolved Slack ids and may be typed by hand for a member
whose id is not an email. Mistakes are reported like in `#GCal`, with `error`
rows above the offending rows.

Then `set slack=team heads-up` in the rotation (or in `#Global`). Each run
finds, per rotation and preset, the shift whose window `[start + when, end +
when)` contains the run instant and posts its message once per destination:
`#Slack state` remembers what was sent, so a shift is announced once and again
only when it is reassigned; deleting a state row re-sends. Groups are set to
the assignees on call across their rotations; a group nobody is on call for
is left alone with a warning. The `#Status` tab gets a `Slack` block with
the counts per rotation and preset (`due`, `posted`, `skipped`, `failed`),
the groups with their members, and any Slack errors, which never stop the
ledger run. Without the extension the `slack` setting is accepted and
`#Status` warns that the slack extension is not installed.

Setting up:

1. Install `Slack.js` next to the core, create the Slack app from the
   manifest in INSTALL.md and install it to the workspace.
2. **Set Up Spreadsheet** creates `#Slack` right after `#GCal` (or
   `#Global`) with a cheat sheet of the settings and the two presets above,
   `team` with `to` reading `#FILL-IN-WITH-CHANNEL`; `#Help` gains a `SLACK`
   section. **Set Up Tab** on an empty `#Slack` writes the same template.
3. **Set Slack token…** stores the bot token (`xoxb-…`) in a script
   property, never in a cell; **Check Slack connection** shows the workspace
   and the bot name. Invite the bot to private channels it should post to.
4. Replace the channel placeholder, put `slack=<presets>` in a `set` row of
   each rotation or in `#Global`, and **Run**. **Send test message: selected
   preset** posts the preset on the selected row of `#Slack` for the shift
   in force, prefixed `[test]`, without recording it, so a template can be
   checked at once.

Menu items of the extension, below the calendar ones: **Set Slack token…**,
**Remove Slack token**, **Check Slack connection**, **Send test message:
selected preset**, **Install hourly Slack trigger** and **Remove hourly
Slack trigger**. The nightly run delivers messages between 02:00 and 03:00
after the fact; the hourly trigger runs a tick that reads the ledgers
without rewriting them and posts what is due, so a message with `when=0`
goes out within the hour of the handover. The core's **Remove trigger**
leaves the Slack trigger alone. The `#Slack state` tab is written by the
script when it posts; delete a row there to announce that shift again.

## Command line

The core also runs in Node without a spreadsheet, using a directory of CSV
files. Files map to tabs: one `<rotation>.csv` per ledger with the header row,
`holidays.csv` for `#Holidays` (`date,note`), optional `global.csv` for
`#Global`, optional `gcal.csv` for `#GCal` (its presence loads the Google
Calendar extension, so `run` reports preset errors like the spreadsheet does,
without touching any calendar), optional `slack.csv` and `slack-state.csv` for
`#Slack` and `#Slack state` (the Slack extension, loaded the same way;
`rotalator slack DIR` prints the messages due, the group members and the
state rows a post would write), `status.json` for the `#Status` and `#All
shifts` data, and `now.txt` with the run instant. A file named
`#<anything>.csv` is never a rotation, like a `#` tab, and other `.csv` files
without the ledger header are ignored.

```
bin/rotalator run DIR [--now YYYY-MM-DDTHH:MM] [--rotation NAME]...
                      [--write] [--status]
bin/rotalator init DIR --rotation NAME [--start YYYY-MM-DDTHH:MM]
                                       [--history-from YYYY-MM-DD]
bin/rotalator help
```

`run` regenerates the ledgers in `DIR`. Without `--write` they are printed as
CSV and nothing is changed. `--status` appends the `#Status` and `#All shifts`
tables as plain text, the former with each rotation's key/value rows, member
table and settings table stacked vertically instead of the spreadsheet's
side-by-side blocks. `--rotation NAME`, repeatable, regenerates only the named
rotations: the others are read so that relations still see their shifts, but
they are neither printed nor written, and the `tabs` block of the status shows
which rotations were regenerated. An unknown name stops the run with nothing
written. Errors and warnings go to stderr, one line each, whether or not
`--status` is given; errors set exit code 1.

`export` runs the scheduler without writing and prints the Google Calendar
export plan of the rotations with a `cal` setting, from `gcal.csv`: the
window, the count of shifts and skipped nobody shifts per rotation, one line
per event and preset, then the preset errors. `--repair` plans every shift
from the first one. No calendar is touched in Node.

`init` creates `NAME.csv` (default `Rotation 1 Primary`) from the rotation
template, plus `holidays.csv` (with the sample `New Year` row) and `now.txt`
when they are missing. `--start` dates the `set` and `team` rows
(default: the most recent Monday 00:00 before `now`). `--history-from` adds
empty `shift` rows on the grid from that date up to the start; the `set` and
`team` rows are then dated at the first of those boundaries so the ledger
validates. Fill in the names, then `run`.

See `test/fixtures/` for worked scenarios, each with a README explaining the
expected result.
