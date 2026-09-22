# Installing Rotalator

Two parts: prepare the spreadsheet, then deploy the script into it, either
with `clasp` or by pasting the bundle into the Apps Script editor.

## 1. Spreadsheet template

1. Create a Google Spreadsheet. In **File > Settings** check the time zone:
   every datetime in the sheet is interpreted in it.
2. Rename the first tab to the rotation name, for example `primary`. One tab
   per rotation; the tab name is the rotation name.
3. Put the header in row 1, exactly these eight cells in columns A to H:

   ```
   pin | start | type | who | arg | end | duration | note
   ```

4. Select columns B (`start`) and F (`end`) and set **Format > Number > Plain
   text** before entering any dates. Otherwise Sheets converts typed values
   into date cells. The script still reads date cells, but plain text is what
   it writes and what keeps the tab readable.
5. Row 2: a `set` row with at least `period`. Date it at the intended start
   of the first shift, so it becomes the grid anchor and the first shift
   starts there. Row 3: a `team` row with the roster, same `start`.
6. Add a `Holidays` tab with the header `date | note` in row 1. Column A holds
   one date per row as `YYYY-MM-DD` text or a real date cell; column B is a
   note. Holidays only matter when a rotation sets `skip_holidays=true`.
7. Optional: freeze row 1 (**View > Freeze > 1 row**) and add a checkbox to
   the `pin` column (**Insert > Checkbox**). An unticked checkbox counts as
   empty.

Minimal ledger as CSV (paste the header row and two data rows into the tab,
or import the file with **File > Import**, choosing "Detect automatically"
as separator and keeping text as text):

```
pin,start,type,who,arg,end,duration,note
,2026-06-01T09:00,set,,"period=1w, horizon=12w",,,
,2026-06-01T09:00,team,,"alice, bob, carol, dave",,,
```

Weekly shifts from Monday 2026-06-01 09:00, twelve weeks ahead, four members
round robin. Add `skip_weekends=true` or other keys from the README settings
table to the `set` row as needed.

Entering existing history: add one `shift` row per past shift with `start`
and `who`. A shift longer than one period needs `duration` or `end`,
otherwise only the first period is credited. Do not add a `snapshot` row; the
script writes it.

## 2. Build

```
./build.sh
```

This concatenates `src/*.js` into `dist/Code.js` and copies
`src/appsscript.json` to `dist/`. The manifest is:

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

## 3. Deployment with clasp

`clasp` is Google's command line tool for Apps Script. It is an external tool,
not a project dependency. Install it with `npm install -g @google/clasp` and
enable the Apps Script API once at https://script.google.com/home/usersettings.

```
clasp login
./build.sh
cd dist
```

Bind a new script project to the spreadsheet. The spreadsheet id is the long
segment of its URL between `/d/` and `/edit`.

```
clasp create --type sheets --parentId <spreadsheetId>
```

Or, if the spreadsheet already has a script project (**Extensions > Apps
Script**, then **Project Settings > Script ID**), attach to it. `clone`
downloads the project's current files into `dist/`; run `build.sh` again so
`Code.js` and `appsscript.json` are the built ones, and delete any other
downloaded file.

```
clasp clone <scriptId>
cd .. && ./build.sh && cd dist
```

Push the bundle. `-f` accepts the manifest change without a prompt.

```
clasp push -f
```

`.clasp.json` stays in `dist/` between builds because `build.sh` only rewrites
`Code.js` and `appsscript.json`. `dist/` is not committed.

Then in the spreadsheet: reload, run **Rotalator > Dry run**, authorise when
asked (see Troubleshooting), check the `<rotation>.preview` tab, and continue
with step 5.

## 4. Manual deployment

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

## 5. First run and nightly trigger

1. **Rotalator > Dry run** writes `<rotation>.preview` tabs and `Status` and
   leaves the ledgers untouched. Check the preview.
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

## 6. Troubleshooting

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

**A `start` cell shows as `6/1/2026 9:00:00` and right-aligns.** Sheets
converted the text into a date cell. The script reads it correctly and writes
text back, setting the ledger range to plain text format on every write. To
stop it happening, set the columns to plain text before typing (step 1.4).

**Error row `first row must be a set row with period`.** The earliest row by
`start` must be a `set` row containing `period=`. Typical causes: a shift or
team row dated earlier than the `set` row, a mistyped year in the `set` row,
or `period` missing from its `arg`.

**Error rows appear above some rows.** Each describes the row directly below
it. Fix the row and run again; error rows are removed on every read. While any
ledger has an error, no tab is regenerated and the snapshot does not move.

**Toast says `holidays row N: bad date`.** Cell A of that row in `Holidays`
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
