# Installing Rotalator

Three parts: take the built script, deploy it into a Google Spreadsheet, then
let the **Rotalator** menu set the spreadsheet up. Hand-made templates are in
the appendix for people who prefer to type everything themselves.

## 1. The bundle

`dist/Code.js` and `dist/appsscript.json` are committed and ready to deploy.
They are produced by `./build.sh`, which concatenates `src/*.js` and copies
`src/appsscript.json`; run it only after changing `src/` (the tests check
that `dist/` matches `src/`). Optional extensions are separate bundles,
`dist/<Name>.js` built from `src/ext/<Name>/`; the core works without them,
and an extension is installed by adding its file next to `Code.js` (sections
2 and 3). The manifest is:

```json
{
  "timeZone": "Etc/UTC",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

The scopes are listed explicitly so that one authorisation covers the
spreadsheet, the menu, the nightly trigger, the calendars of the GCal
extension and the outbound requests of the Slack extension, whether or not
`GCal.js` or `Slack.js` is installed yet. When the scopes of an
already deployed project change, the script asks for authorisation again on
the next menu action, and a trigger fails until someone has granted it: run
`Setup` once after such an update.

All datetimes, the run instant and the trigger hour use the spreadsheet's
time zone (**File > Settings**). The manifest `timeZone` is the script's own
zone: Apps Script uses it for log timestamps and the editor, and the Google
Calendar extension converts all-day event dates in it (the calendar API works
with the script zone for those), so the export is correct whether or not the
two zones match. Setting it to the spreadsheet's zone (for example
`America/New_York`) keeps the logs readable. Editing `dist/appsscript.json`
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

`clasp push` uploads every file in `dist/`, extension bundles included, so
the Google Calendar extension (`GCal.js`) and the Slack extension
(`Slack.js`) are installed by default. To leave
an extension out, list its file in a `.claspignore` in `dist/` (one
`<Name>.js` per line) before pushing; to add one later, remove the line and
push again. After the first push with `GCal.js`, run **Set Up Spreadsheet**
so the `#GCal` tab and the `CALENDAR` help section appear, and share every
calendar you will export to (section 4a); with `Slack.js`, the same command
creates `#Slack` and the `SLACK` help section (section 4b).

`dist/.clasp.json` is ignored by git and stays in place between builds
because `build.sh` only rewrites the bundles and the manifest.

Reload the spreadsheet and continue with section 4. If no **Rotalator** menu
appears, open **Extensions > Apps Script**, select `Setup` (the first
function in the toolbar dropdown) and click **Run** once to authorise the
script, then reload.

## 3. Manual deployment

1. Open the spreadsheet, **Extensions > Apps Script**. A script project bound
   to the spreadsheet opens.
2. In **Project Settings** (gear icon) tick **Show "appsscript.json" manifest
   file in editor** and set the time zone to match the spreadsheet.
3. Back in the editor, replace the content of `Code.gs` with `dist/Code.js`
   and the content of `appsscript.json` with `dist/appsscript.json`, with
   `timeZone` set to the spreadsheet's zone. Save.
   Optional: for each extension you want, add a script file (**+ > Script**)
   named after the bundle, `<Name>.gs`, and paste `dist/<Name>.js` into it.
   For the Google Calendar export that is `GCal.gs` with `dist/GCal.js`,
   for Slack `Slack.gs` with `dist/Slack.js`. The core finds the extension
   by its functions; leaving the file out leaves the extension out.
4. In the function dropdown of the toolbar select `Setup` (the first function
   in the list) and click **Run** once. It installs the menu and triggers the
   authorisation prompt; grant the permissions (spreadsheet access and
   trigger management).
5. Reload the spreadsheet. A **Rotalator** menu appears next to **Help**.

## 4. Set up the spreadsheet from the menu

1. **Rotalator > Set Up Spreadsheet**. Authorise when asked (see
   Troubleshooting). The command is idempotent and never rewrites existing
   data. It:
   - creates the missing system tabs `#Holidays`, `#Global`, `#Status` and
     `#All shifts`; `#Holidays` gets a sample `New Year` row for the previous
     year and `#Global` its help rows and a `set` row of defaults;
   - creates a first rotation tab `Rotation 1 Primary` from the template when
     the spreadsheet has no rotation yet;
   - lets each installed extension create its own tabs (`#GCal` for the
     calendar extension, `#Slack` for the Slack extension);
   - rewrites the `#Help` tab (plain text: columns, row types, settings,
     intervals, relations, menu) and keeps it as the last tab;
   - on every rotation, `#Holidays`, `#Global` and `#All shifts` tab: Roboto
     Mono font, plain text format on the whole ledger columns (`A:G`), which
     should carry over to rows added later (to be confirmed on a live
     spreadsheet, see the appendix), bold grey frozen header, column widths,
     a note on each header cell explaining the column, spare empty columns
     beyond the last one removed;
   - on rotation tabs and `#Global`: conditional row colours by `type`
     (errors red, `set` and `score` blue, roster changes teal, `snapshot`
     green, comment rows yellow, `attract`, `repel` and `repel!` green,
     `detach` grey).
     The tab's existing conditional format rules are replaced;
   - colours the `#` tabs: blue for tabs the script writes, grey for
     `#Holidays` and `#Global`, which you edit.
   Tabs without the ledger header that already have content are left alone.
2. Open `Rotation 1 Primary` (or rename it: the tab name is the rotation
   name). The first rows are help comments listing what each row type takes
   in `what`; they stay at the top and can be deleted. Below them a `set` row
   without `start` lists every setting at its default; it applies from the
   beginning. Adjust `period`, `horizon`, `skip_weekends` and the rest as
   needed. The `team` row, also without `start`, has sample names: replace
   them with your members. The dated `set anchor` row below them is where
   the first shift starts, the most recent Monday 00:00, so shifts change at
   midnight; change its `start` if the team hands over at another time or
   day. Rows with an empty `type` are comments: put notes anywhere in the
   ledger, the script keeps them in place.
3. More rotations: add a tab, name it, and choose **Rotalator > Set Up Tab**
   with the tab active. It only fills empty tabs. On `#Holidays` it writes
   the header and the sample row, on `#Global` the header, help rows and a
   `set` row of defaults; on tabs the script writes it does nothing.
   Settings shared by every rotation can go into a `set` row in `#Global`
   instead of each tab (MANUAL.md, "Global defaults and relations between
   rotations"); a rotation's own `set` row still
   wins for the keys it names. A rotation that takes everything from
   `#Global` starts with an empty `set` row dated at its first shift; avoid a
   bare `anchor` there, which would pin the anchor locally.
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

## 4a. Google Calendar extension

With `GCal.js` installed, **Set Up Spreadsheet** creates the `#GCal` tab
(`preset | setting | value`) right after `#Global`, with a cheat sheet of
the settings and a first preset `preset-1` to fill in, and the **Rotalator**
menu gains the re-export and clean items. Then:

1. Create a calendar per preset, or pick existing ones, and note their ids
   (**Settings and sharing > Integrate calendar > Calendar ID**; a personal
   calendar's id is its address).
2. Share each calendar with **Make changes to events** with every account
   that runs Rotalator: the users who click **Run** and the account that
   installed the nightly trigger (menu actions run as the clicking user, the
   trigger as its installer). A calendar the running account cannot write
   is reported in `#Status` as not found and skipped.
3. Replace `FILL IN WITH CALENDAR ID` in `preset-1` with the calendar id,
   add a preset per further calendar (MANUAL.md, "Google Calendar export"),
   and
   add `cal=<preset names>` to a `set` row of each rotation to export, or to
   `#Global`.
4. **Run - preview** shows the counts in the `Calendar` block of `#Status`
   without touching the calendars; **Run** exports.

The first calendar action asks for the calendar permission if the manifest
scopes were not granted yet (section 1).

## 4b. Slack extension

With `Slack.js` installed, **Set Up Spreadsheet** creates the `#Slack` tab
(`preset | setting | value`) right after `#GCal` (or `#Global`), with a
cheat sheet of the settings and two presets to fill in, `team` (a channel
message and the `@oncall` group) and `heads-up` (a reminder to the person
three days before), and the **Rotalator** menu gains the Slack items. The
script only calls Slack; Slack never calls the script, so no URL has to be
exposed. Then:

1. Create the Slack app at https://api.slack.com/apps with **Create New App
   > From a manifest**, pick the workspace and paste this manifest (YAML):

   ```yaml
   display_information:
     name: Rotalator
     description: On-call handover messages and user groups from the Rotalator spreadsheet
   features:
     bot_user:
       display_name: Rotalator
       always_online: false
   oauth_config:
     scopes:
       bot:
         - chat:write
         - chat:write.public
         - users:read
         - users:read.email
         - channels:read
         - groups:read
         - usergroups:read
         - usergroups:write
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

   `chat:write` posts to channels the bot is in and to people,
   `chat:write.public` to public channels without joining, `users:read` and
   `users:read.email` look members up by email, `channels:read` and
   `groups:read` resolve `#channel` names, `usergroups:read` and
   `usergroups:write` read and set the user groups.
2. **Install to Workspace** and copy the **Bot User OAuth Token**
   (`xoxb-…`). A corporate workspace may require an admin to approve the
   app, and a separate admin setting to let apps edit user groups.
3. In the spreadsheet choose **Rotalator > Set Slack token…** and paste the
   token. It goes into a script property shared by every user of the script
   and the triggers; it is never written to a cell. **Check Slack
   connection** shows the workspace and the bot name. The first Slack action
   asks for the external request permission if the manifest scopes were not
   granted yet (section 1).
4. Invite the bot to every private channel it should post to (`/invite
   @Rotalator`); public channels need no invitation with
   `chat:write.public`. A channel named by `#name` must be visible to the
   bot to be found; a channel id (`C…`, from the channel's details) always
   works. Create the user group (`@oncall`) in Slack if it does not exist;
   the bot only changes its members.
5. Replace `#FILL-IN-WITH-CHANNEL` in `team` with the channel, add
   `slack=<preset names>` to a `set` row of each rotation or to `#Global`,
   and **Run**; or select a preset row in `#Slack` and choose **Send test
   message: selected preset** to see the rendered text in Slack first.
6. Optional: **Install hourly Slack trigger** delivers within the hour of a
   handover instead of at the nightly run. It belongs to the account that
   installed it, like the nightly trigger.

Enterprise Grid: a user group synced from the identity provider cannot be
changed through the API. Use a workspace group Rotalator owns.

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

1. **Rotalator > Run - preview** writes `#Preview <rotation>` tabs
   (created right after each rotation tab on the first preview, formatted
   like the rotation tabs), `#Status` and `#All shifts`, and leaves the
   ledgers and `#Global` untouched. Check the preview and
   the `tabs` block at the top of `#Status`, which lists the rotations found
   and the tabs ignored.
2. **Rotalator > Run** writes the ledgers: the `snapshot` row and the
   generated shifts appear. **Run for current rotation** and **Run for
   current rotation - preview** do the same for the active tab only; the
   other rotations are read but left as they are.
3. **Rotalator > Install nightly trigger** schedules Run every day between
   02:00 and 03:00 in the spreadsheet time zone. Installing again replaces the
   existing trigger. **Remove trigger** deletes it. Triggers belong to the
   account that installed them and are listed in the Apps Script editor under
   **Triggers**.

Each run shows a toast at the bottom right with the number of rotations
written or the number of errors and the first message. Trigger runs have no
toast; their output is in **Executions** in the Apps Script editor.

## 7. Troubleshooting

**No Rotalator menu after reload.** Open the script editor, select `Setup`,
click **Run**, accept the prompts, reload the spreadsheet.

**"Google hasn't verified this app" during authorisation.** Expected for a
script you deployed yourself. Click **Advanced**, then **Go to <project name>
(unsafe)**, then **Allow**. The scopes requested are spreadsheet access and
trigger management.

**"Authorization is required" when installing the trigger.** Accept the
prompt and choose the menu item again.

**A run ends with "finished with N error(s)".** Look for red `error` rows:
directly above the offending row in the rotation tab or `#Global`, above the
`set` row carrying `cal` or `slack` when a preset is unknown, above a
preset's `id` row in `#GCal` when its calendar cannot be opened (not shared
with the running account, or a placeholder id such as `FILL IN WITH CALENDAR
ID`), above a preset's `to` or `group` row in `#Slack` when a destination
does not resolve, a post fails or a group cannot be updated. `#Status` lists
them all with the row numbers; fix the cause and run again, the rows
disappear.

**Slack errors `not_in_channel`, `channel_not_found`, `no Slack token`,
`invalid_auth`.** Invite the bot to the channel or grant `chat:write.public`;
check the channel name or use its id; set the token with **Set Slack
token…** (it is per script, not per user); a revoked or rotated token needs
setting again. `member "x" has no Slack id` means a member id that is not
an email: add a row `x | id | U…` to `#Slack` with the person's Slack id
(profile > three dots > Copy member ID).

**Times are off by some hours, or the script writes a different time than
you typed.** Date cells are converted using the spreadsheet's time zone in
**File > Settings**; check it is the zone the team means, and make sure the
`start` and `end` columns are plain text so no conversion happens at all.
**Set Up Spreadsheet** applies plain text to the whole ledger columns.

**A `start` cell shows as `6/1/2026 9:00:00` and right-aligns.** Sheets
converted the text into a date cell. The script reads it correctly and writes
text back, setting the ledger range to plain text format on every write. Run
**Set Up Spreadsheet** once so the whole columns are plain text before
typing.

**Set Up Tab says the tab is not empty.** It never overwrites content. Clear
the tab or add a new one.

**Run for current rotation says the tab is not a rotation tab.** The active
tab must have the ledger header and a name without `#`. Switch to the
rotation tab and run again.

**My conditional formatting disappeared.** Set Up Spreadsheet and Set Up Tab
replace the conditional format rules of rotation tabs and `#Global` with the
script's set. Keep custom rules on other tabs.

**Fill Shifts Grid says a row has content but no start.** An undated row has
a `type` other than `shift`. Date it, clear its `type` to make it a comment,
or clear the row, then run again.

**Error `no period in force`, `no anchor` or `row before the anchor`.** The
grid must be complete before the first dated row: a `period=` in some `set`
row (in the tab, undated or dated, or in `#Global`) and an anchor from a
dated `set` row (`anchor`, or the row that sets `period`). Typical causes: a
shift or team row dated earlier than the `set anchor` row, a mistyped year
in that row, or `period` missing from every `set` row and from `#Global`.

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

Everything **Set Up Spreadsheet** and **Set Up Tab** do can be typed by hand.

1. Rename a tab to the rotation name. Tab names starting with `#` are reserved
   for the script's tabs and for disabled rotations.
2. Put the header in row 1, exactly these seven cells in columns A to G:

   ```
   pin | start | type | what | end | duration | note
   ```

3. Select columns A to G and set **Format > Number > Plain text** before
   entering any dates, so Sheets does not convert typed values into date
   cells. Whether rows added later inherit the column format the way the
   script's **Set Up Spreadsheet** relies on is to be confirmed on a live
   spreadsheet; if a new
   row shows a converted date, reapply plain text to the column.
4. Row 2: a `set` row with at least `period`, dated at the intended start of
   the first shift so it becomes the grid anchor. Row 3: a `team` row with
   the roster, same `start`. Or, like the templates, leave `start` empty on
   the `set` and `team` rows so they apply from the beginning and add a third
   row `set anchor` dated at the first shift.
5. Add a `#Holidays` tab with the header `date | note` in row 1, and
   optionally a `#Global` tab with the same seven-cell header as a ledger
   (MANUAL.md, "Global defaults and relations between rotations").
6. Optional: freeze row 1 (**View > Freeze > 1 row**) and add a checkbox to
   the `pin` column (**Insert > Checkbox**). An unticked checkbox counts as
   empty.

Minimal ledger as CSV (paste the header row and two data rows into the tab,
or import the file with **File > Import**, choosing "Detect automatically"
as separator and keeping text as text):

```
pin,start,type,what,end,duration,note
,2026-06-01,set,"period=1w, horizon=12w, precredit=1ts, autopin=a:2sl",,,
,2026-06-01,team,"alice, bob, carol, dave",,,
```

Weekly shifts from Monday 2026-06-01 at midnight on the plain calendar grid,
twelve weeks ahead, four members round robin. Midnight is the default
hand-over time of the templates and is written as the bare date; write
`2026-06-01T09:00` instead for a 09:00 hand-over. Add
`skip_weekends=true`, `grid=counted` or other keys from the settings table
of MANUAL.md to the `set` row as needed.
