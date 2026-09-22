// Links tab (DESIGN 7): link and unlink rows relating rotations over time.

var LINK_KINDS = ['distinct', 'joined'];
var LINKS_NAME = 'Links';

// "distinct: a, b" -> { kind, rotations } or null.
function parseLinkArg(text) {
  var m = /^\s*([A-Za-z]+)\s*:(.*)$/.exec(text);
  if (!m) return null;
  var kind = m[1].toLowerCase();
  if (LINK_KINDS.indexOf(kind) < 0) return null;
  var rotations = splitList(m[2]);
  if (rotations.length < 2 || new Set(rotations).size !== rotations.length) return null;
  return { kind: kind, rotations: rotations };
}

function sameRotations(a, b) {
  return a.length === b.length && a.every(function (r) { return b.indexOf(r) >= 0; });
}

function validateLinkRow(row, rotationNames) {
  if (row.type !== 'link' && row.type !== 'unlink') return row.type === '' ? 'missing type' : 'unknown type "' + row.type + '"';
  if (row.start === null) return row.startText === '' ? 'missing start' : 'bad start "' + row.startText + '"';
  if (row.who !== '') return row.type + ' does not take who';
  if (row.arg === '') return row.type + ' requires arg';
  var parsed = parseLinkArg(row.arg);
  if (!parsed) return 'arg must be "distinct: a, b" or "joined: a, b"';
  for (var i = 0; i < parsed.rotations.length; i++) {
    if (rotationNames.indexOf(parsed.rotations[i]) < 0) return 'unknown rotation "' + parsed.rotations[i] + '"';
  }
  if (row.type === 'unlink' && (row.endText !== '' || row.durationText !== '')) return 'unlink does not take end or duration';
  if (row.endText !== '' && row.durationText !== '') return 'end and duration are mutually exclusive';
  if (row.endText !== '' && parseDateTime(row.endText) === null) return 'bad end "' + row.endText + '"';
  if (row.durationText !== '' && (row.duration === null || row.duration <= 0)) return 'bad duration "' + row.durationText + '"';
  if (row.end !== null && row.end <= row.start) return 'end must be after start';
  return null;
}

// rows: Links row objects. Returns { links: [{ kind, rotations, from, to }], errors, rows } where rows are the
// kept rows plus an error row above each rejected one. Rejected rows are ignored; unlink closes matching open links.
function parseLinks(rows, rotationNames) {
  var errors = [];
  var links = [];
  var kept = sortRows(rows.filter(function (r) { return r.type !== 'error'; }));
  kept.forEach(function (row) {
    var message = validateLinkRow(row, rotationNames);
    if (message === null) {
      var parsed = parseLinkArg(row.arg);
      if (row.type === 'link') {
        links.push({ kind: parsed.kind, rotations: parsed.rotations, from: row.start, to: row.end });
      } else {
        var open = links.filter(function (l) {
          return l.kind === parsed.kind && sameRotations(l.rotations, parsed.rotations) && l.from <= row.start && (l.to === null || l.to > row.start);
        });
        if (!open.length) message = 'unlink: no active ' + parsed.kind + ' link for ' + parsed.rotations.join(', ');
        open.forEach(function (l) { l.to = row.start; });
      }
    }
    if (message !== null) errors.push(rowError(row, message));
  });
  return { links: links, errors: errors, rows: sortRows(kept.concat(errors.map(errorRow))) };
}

// Sweep order at equal starts: rotations in link list order first, then the rest in tab order.
function linkedRotationOrder(links, rotationNames) {
  var ordered = [];
  var add = function (name) { if (ordered.indexOf(name) < 0) ordered.push(name); };
  links.forEach(function (l) { l.rotations.forEach(add); });
  rotationNames.forEach(add);
  return ordered;
}

function activeLinks(links, kind, rotation, t) {
  return links.filter(function (l) {
    return l.kind === kind && l.rotations.indexOf(rotation) >= 0 && l.from <= t && (l.to === null || l.to > t);
  });
}

// Members holding a decided shift overlapping [a, b) in rotations linked to rot by `kind` at instant a.
function linkedHolders(ctx, rot, kind, a, b) {
  var names = new Set();
  activeLinks(ctx.links, kind, rot.name, a).forEach(function (link) {
    link.rotations.forEach(function (other) {
      var target = ctx.byName[other];
      if (!target || target === rot) return;
      target.entries.forEach(function (e) {
        if (e.who !== null && e.start < b && e.end > a) names.add(e.who);
      });
    });
  });
  return names;
}
