'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exportDir, planText, main } = require('../node/cli.js');

// Own file: exportDir loads the GCal extension into the process, which the other CLI tests must not inherit.
test('export: plan text for the gcal fixture, repair, rotation filter, exit codes', () => {
  const dir = path.join(__dirname, 'fixtures', 'gcal');
  const { plan } = exportDir(dir, null, {});
  assert.equal(plan.events.length, 6);
  const text = planText(plan);
  assert.match(text, /^rotation  primary\npresets   team, personal\nwindow    2026-09-28 to 2026-10-26\nshifts    3\nskipped   1\n\nkey +preset +calendar +start +end +all day +title +guests +reminders\n/);
  assert.match(text, /primary\|2026-10-05 +personal +oncall@example.com +2026-10-05 +2026-10-12 +no +On call: dave@example.com \(Mon 5 Oct to Mon 12 Oct\) +dave@example.com\n/);
  assert.match(text, /primary\|2026-09-28 +team +team@group.calendar.google.com +2026-09-28 +2026-10-05 +yes +primary: carol +1440 60\n/);
  assert.ok(!text.includes('error'));
  assert.equal(exportDir(dir, null, { repair: true }).plan.events.length, 10);
  assert.deepEqual(exportDir(dir, null, { rotations: ['secondary'] }).plan.events, []);
  assert.equal(exportDir(dir, 'someday', {}).plan, null);
  const out = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(s); return true; };
  try {
    assert.equal(main(['export', dir, '--repair']), 0);
    assert.equal(main(['export', dir, '--bogus']), 1);
  } finally { process.stdout.write = write; }
  assert.match(out.join(''), /shifts    5\n/);
  assert.match(planText({ rotations: [], events: [], errors: [{ where: 'primary', message: 'unknown preset "x" in cal; add it to #GCal' }] }), /^error  where +message\n +primary +unknown preset/);
});
