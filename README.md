# Rotalator

Rotalator keeps an on-call rotation topped up in a shared Google Spreadsheet.
Each rotation is a tab with a time-sorted ledger of shifts and events. People
edit the ledger to express team changes, vacations, swaps and settings; the
script runs nightly or from a menu, replays the history, and rewrites the
future so that on-call load stays fair.

[![Rotalator demo](https://img.youtube.com/vi/ksqgg9XLvBM/maxresdefault.jpg)](https://youtu.be/ksqgg9XLvBM)

## Why

- **Fully self-contained, no dependencies.** One Apps Script project bound
  to the spreadsheet; zero runtime and dev dependencies; nothing to install
  or host, no package manager; the tests run on plain `node --test`.
- Fairness is measured in fractional days over the whole history, not per
  cycle: whoever is behind gets the next shift.
- Runs are deterministic and idempotent: the same spreadsheet gives the same
  result, and a second run changes nothing.
- Pins and swaps are edits to rows: pin a shift and the future reshapes
  around it; the near future is pinned automatically so it stays stable.
- Team changes, joins and leaves, vacations and substitutions are dated rows
  in the same timeline as the shifts.
- Several rotations in one spreadsheet, with relations between them: keep
  one person off two rotations at once, or prefer the one already on call.
- Errors are reported in place, as rows next to what they describe, and
  summarised in a status tab.
- Previews write to separate tabs; the ledgers do not change until you run.
- No UI beyond the spreadsheet and its menu.

## Example

A rotation tab after a run (from a test fixture). The `set` row carries the
settings, the `team` row the roster, bob pinned 21 September with an `x` and
a note, an `a` marks a shift the script pinned itself, and the script
generated the rest around it:

```
pin | start            | type     | what                           | note
    | 2026-06-01T09:00 | set      | period=1w, horizon=6w, ...     |
    | 2026-06-01T09:00 | team     | alice, bob, carol, dave        |
    | 2026-09-07T09:00 | snapshot | alice=28, bob=28, carol=21, .. |
a   | 2026-09-07T09:00 | shift    | carol                          |
    | 2026-09-14T09:00 | shift    | dave                           |
x   | 2026-09-21T09:00 | shift    | bob                            | volunteered
    | 2026-09-28T09:00 | shift    | carol                          |
    | 2026-10-05T09:00 | shift    | dave                           |
```

Bob's pinned week is credited before the open slots are decided, so carol
and dave, who are behind, take the weeks around it.

## Extensions

The core is complete on its own; optional features ship as a second script
file installed next to it.

**Google Calendar export.** Each rotation names calendar presets in its
`cal` setting, and every shift becomes an event on those calendars: created,
updated or deleted as the schedule changes, all-day or timed, with
reminders and invitations if you want them. See the manual's
[Google Calendar section](MANUAL.md#google-calendar-export).

**Slack messages and user groups.** The `slack` setting names Slack presets:
a handover message per shift to channels and people, and user groups such
as `@oncall` that follow whoever is on call. See the manual's
[Slack section](MANUAL.md#slack-messages-and-user-groups).

## Quick start

1. Deploy `dist/Code.js` into a spreadsheet-bound Apps Script project, with
   `clasp` or by pasting ([INSTALL.md](INSTALL.md)).
2. **Rotalator > Set Up Spreadsheet** creates the tabs and a first rotation
   from the template; fill in the names.
3. **Run - preview** shows what a run would write; **Run** writes it;
   **Install nightly trigger** keeps it topped up.

The same core runs in Node on a directory of CSV files, one per tab:

```
bin/rotalator init DIR --rotation primary
bin/rotalator run DIR --write --status
```

## Principles

Rotalator stays a periodic, idempotent script that edits a spreadsheet: no
app, no UI beyond the spreadsheet and its menu. Pragmatic spreadsheet
conventions (a column, a row type, a tab name prefix) are preferred over new
components, and nothing is added as a dependency without the owner's
approval. The core is complete on its own; optional features such as the
Google Calendar export come as extensions, a second script file installed
next to the core that adds its own menu items, tabs and `#Status` block. The
core works without them and only carries what the ledger needs either way:
the `cal` and `slack` settings and the reserved `#GCal` and `#Slack` tabs.

## Documentation

- [MANUAL.md](MANUAL.md): using it, tab by tab and task by task.
- [INSTALL.md](INSTALL.md): setup, deployment, credentials, troubleshooting.
- [DESIGN.md](DESIGN.md): the specification the code follows.

## Limitations

- No concurrency protection: an edit made while the nightly run is in
  progress may be overwritten.
- Periods are days or weeks; months are not supported.

The full list is in [MANUAL.md, Limitations](MANUAL.md#limitations).
