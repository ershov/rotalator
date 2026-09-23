# Installing Rotalator

Three parts: take the built script, deploy it into a Google Spreadsheet, then
let the **Rotalator** menu set the spreadsheet up. Hand-made templates are in
the appendix for people who prefer to type everything themselves.

## 1. The bundle

`dist/Code.js` and `dist/appsscript.json` are committed and ready to deploy.
They are produced by `./build.sh`, which concatenates `src/*.js` and copies
`src/appsscript.json`; run it only after changing `src/` (the tests check
that `dist/` matches `src/`). The manifest is:

```json
{
  "timeZone": "Etc/UTC",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

All datetimes, the run instant and the trigger hour use the spreadsheet's
time zone (**File > Settings**). The manifest `timeZone` only affects log
timestamps and the editor; setting it to the same zone (for example
`America/New_York`) keeps them consistent. Editing `dist/appsscript.json`
works for one push; `build.sh` overwrites it from `src/appsscript.json` each
time, so change `src/appsscript.json` for a lasting setting.

## 2. Deployment with clasp

`clasp` is Google's command line tool for Apps Script. It is an external tool,
not a project dependency. Install it with `npm install -g @google/clasp` and
enable the Apps Script API once at https://script.google.com/home/usersettings.

```
clasp login
cd dist
```

Create a spreadsheet (or open an existing one) and check its time zone in
**File > Settings**. Bind a new script project to it. The spreadsheet id is
the long segment of its URL between `/d/` and `/edit`.

```
clasp create --type sheets --parentId <spreadsheetId>
```

Or, if the spreadsheet already has a script project (**Extensions > Apps
Script**, then **Project Settings > Script ID**), attach to it. `clone`
downloads the project's current files into `dist/`; restore the committed
`Code.js` and `appsscript.json` afterwards and delete any other downloaded
file.

```
clasp clone <scriptId>
git checkout -- Code.js appsscript.json
```

Push the bundle. `-f` accepts the manifest change without a prompt.

```
clasp push -f
```

`dist/.clasp.json` is ignored by git and stays in place between builds
because `build.sh` only rewrites `Code.js` and `appsscript.json`.

Reload the spreadsheet and continue with section 4.

## 3. Manual deployment

1. Open the spreadsheet, **Extensions > Apps Script**. A script project bound
   to the spreadsheet opens.
2. In **Project Settings** (gear icon) tick **Show "appsscript.json" manifest
   file in editor** and set the time zone to match the spreadsheet.
3. Back in the editor, replace the content of `Code.gs` with `dist/Code.js`
   and the content of `appsscript.json` with `dist/appsscript.json`, time zone
   adjusted. Save.
4. In the function dropdown of the toolbar select `onOpen` and click **Run**.
   Grant the permissions (spreadsheet access and trigger management).
5. Reload the spreadsheet. A **Rotalator** menu appears next to **Help**.

## 4. Set up the spreadsheet from the menu

1. **Rotalator > Set up**. Authorise when asked (see Troubleshooting). The
   command is idempotent and never rewrites existing data. It:
   - creates the missing system tabs `#Holidays`, `#Links`, `#Status` and
     `#All shifts` with their headers;
   - creates a first rotation tab `On-Call` from the template when the
     spreadsheet has no rotation yet;
   - on every rotation, `#Holidays`, `#Links` and `#All shifts` tab: Roboto
     Mono font, plain text format on the whole ledger columns (`A:G`), which
     should carry over to rows added later (to be confirmed on a live sheet,
     see the appendix), bold frozen header, column widths, a note on each
     header cell explaining the column, spare empty columns beyond the last
     one removed;
   - colours the `#` tabs: one colour for tabs the script writes, another for
     `#Holidays` and `#Links`, which you edit.
   Tabs without the ledger header that already have content are left alone.
2. Open `On-Call` (or rename it: the tab name is the rotation name). Row 2 is
   a `set` row listing every setting at its default, dated the most recent
   Monday 00:00 with a bare `anchor`, so the first shift starts there and
   shifts change at midnight; change the time in `start` if the team hands
   over during the day. Adjust `period`, `horizon`, `skip_weekends` and the
   rest as needed. Row 3 is a `team` row with sample names: replace them with
   your members. Rows with an empty `type` are comments: put notes anywhere in
   the ledger, the script keeps them in place.
3. More rotations: add a tab, name it, and choose **Rotalator > Template**
   with the tab active. The template only fills empty tabs. On `#Holidays` or
   `#Links` it writes the header row; on tabs the script writes it does
   nothing.
4. Existing history, optional: type the past shifts as `shift` rows with
   `start` and the member in `what`, or let **Fill Shifts Grid** lay out the
   dates for you (section 5) and fill in the names. A shift row without `end`
   or `duration` ends at the earlier of the next shift's start and the next
   grid boundary after its `start`; history rows spanning several periods need
   a `duration` or an `end`, otherwise only their first period is credited. Do
   not add a `snapshot` row; the script writes it.
5. `#Holidays`: one date per row in column A as `YYYY-MM-DD` (text or a date
   cell), a note in column B. Holidays only matter when a rotation sets
   `skip_holidays=true`.

## 5. Fill Shifts Grid

**Rotalator > Fill Shifts Grid** fills the `start` column of a selection so
that every selected row sits on the rotation's grid. Select more than one row
of a rotation tab (any columns; the whole rows are used) and run it:

- Empty rows above the first dated row become empty `shift` rows at the grid
  boundaries before it (backfill). Empty rows below the last dated row become
  empty `shift` rows after the last shift's end (extension).
- Between dated rows, every uncovered grid boundary and every gap after a
  shift with an early `end` gets an empty `shift` row; the selection grows by
  the inserted rows. Dated rows are sorted; their other cells travel with them
  and a row with nothing but a `start` becomes a `shift`.
- Rows without `start` are empty grid positions when blank or `type` =
  `shift` only, or comments when `type` is empty and another cell has
  content; comments travel with the next dated row below them. An undated row
  with any other `type` stops the command with a toast naming it.
- `end` and `duration` are never written. The grid comes from the tab's `set`
  rows and `#Holidays`, so it follows `period`, `anchor`, `grid`, and the
  skip flags of a counted grid.

After the command the affected rows are selected. Fill in `what` by hand for
history rows; leave future rows to the script.

## 6. First run and nightly trigger

1. **Rotalator > Dry run** writes `#Preview <rotation>` tabs (created right
   after each rotation tab on the first dry run), `#Status` and `#All shifts`,
   and leaves the ledgers untouched. Check the preview and the `tabs` block at
   the top of `#Status`, which lists the rotations found and the tabs ignored.
2. **Rotalator > Run now** writes the ledgers: the `snapshot` row and the
   generated shifts appear.
3. **Rotalator > Install nightly trigger** schedules `run` every day between
   02:00 and 03:00 in the spreadsheet time zone. Installing again replaces the
   existing trigger. **Remove trigger** deletes it. Triggers belong to the
   account that installed them and are listed in the Apps Script editor under
   **Triggers**.

Each run shows a toast at the bottom right with the number of rotations
written or the number of errors and the first message. Trigger runs have no
toast; their output is in **Executions** in the Apps Script editor.

## 7. Troubleshooting

**No Rotalator menu after reload.** Open the script editor, select `onOpen`,
click **Run**, accept the prompts, reload the spreadsheet.

**"Google hasn't verified this app" during authorisation.** Expected for a
script you deployed yourself. Click **Advanced**, then **Go to <project name>
(unsafe)**, then **Allow**. The scopes requested are spreadsheet access and
trigger management.

**"Authorization is required" when installing the trigger.** Accept the
prompt and choose the menu item again.

**Times are off by some hours, or the script writes a different time than
you typed.** Date cells are converted using the spreadsheet's time zone in
**File > Settings**; check it is the zone the team means, and make sure the
`start` and `end` columns are plain text so no conversion happens at all.
**Set up** applies plain text to the whole ledger columns.

**A `start` cell shows as `6/1/2026 9:00:00` and right-aligns.** Sheets
converted the text into a date cell. The script reads it correctly and writes
text back, setting the ledger range to plain text format on every write. Run
**Set up** once so the whole columns are plain text before typing.

**Template says the tab is not empty.** The template never overwrites
content. Clear the tab or add a new one.

**Fill Shifts Grid says a row has content but no start.** An undated row has
a `type` other than `shift`. Date it, clear its `type` to make it a comment,
or clear the row, then run again.

**Error row `first row must be a set row with period`.** The earliest row by
`start` must be a `set` row containing `period=`. Typical causes: a shift or
team row dated earlier than the `set` row, a mistyped year in the `set` row,
or `period` missing from its `what`.

**A rotation tab is not picked up.** Its first row must be exactly the seven
header cells and its name must not start with `#`. The `tabs` block in
`#Status` lists what was recognised and what was ignored.

**Error rows appear above some rows.** Each describes the row directly below
it. Fix the row and run again; error rows are removed on every read. While any
ledger has an error, no tab is regenerated and the snapshot does not move.

**Toast says `holidays row N: bad date`.** Cell A of that row in `#Holidays`
is not `YYYY-MM-DD` or a date cell. Fix or clear it.

**A generated shift has nobody and an error row says `no eligible member`.**
Everyone on the roster is excluded for that slot. Add a member, shorten an
exclusion, or pin a shift by hand.

**A historical shift covering several weeks is credited as one.** Give it
`duration` or `end`. Without them a shift extends only to the next grid
boundary.

**Nightly run did not happen.** Check **Triggers** and **Executions** in the
Apps Script editor. The trigger runs under the account that installed it; if
that account lost access to the spreadsheet, reinstall from another account.

## Appendix: hand-made template

Everything **Set up** and **Template** do can be typed by hand.

1. Rename a tab to the rotation name. Tab names starting with `#` are reserved
   for the script's tabs and for disabled rotations.
2. Put the header in row 1, exactly these seven cells in columns A to G:

   ```
   pin | start | type | what | end | duration | note
   ```

3. Select columns A to G and set **Format > Number > Plain text** before
   entering any dates, so Sheets does not convert typed values into date
   cells. Whether rows added later inherit the column format the way the
   script's **Set up** relies on is to be confirmed on a live sheet; if a new
   row shows a converted date, reapply plain text to the column.
4. Row 2: a `set` row with at least `period`, dated at the intended start of
   the first shift so it becomes the grid anchor. Row 3: a `team` row with
   the roster, same `start`.
5. Add a `#Holidays` tab with the header `date | note` in row 1, and
   optionally a `#Links` tab with the same seven-cell header as a ledger (see
   the README for `link` rows).
6. Optional: freeze row 1 (**View > Freeze > 1 row**) and add a checkbox to
   the `pin` column (**Insert > Checkbox**). An unticked checkbox counts as
   empty.

Minimal ledger as CSV (paste the header row and two data rows into the tab,
or import the file with **File > Import**, choosing "Detect automatically"
as separator and keeping text as text):

```
pin,start,type,what,end,duration,note
,2026-06-01T00:00,set,"period=1w, horizon=12w, grid=calendar",,,
,2026-06-01T00:00,team,"alice, bob, carol, dave",,,
```

Weekly shifts from Monday 2026-06-01 00:00 on the plain calendar grid, twelve
weeks ahead, four members round robin. Midnight is the default hand-over time
of the templates; write `2026-06-01T09:00` instead for a 09:00 hand-over. Add
`skip_weekends=true`, `grid=counted` or other keys from the README settings
table to the `set` row as needed.
