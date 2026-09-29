// Optional extensions (DESIGN 8, Extensions). An extension is a separate bundle dist/<Name>.js built from
// src/ext/<Name>/*.js; it defines global functions <prefix>_<hook> where the prefix is the lower-case name.
// The core never registers anything: hooks are probed with typeof when they are called, so an extension that
// is not installed is simply skipped and file load order never matters.
var EXTENSIONS = ['GCal', 'Slack'];
var EXTENSION_HOOKS = ['menu', 'setup', 'setupTab', 'help', 'readInputs', 'afterRun', 'status'];

function extensionPrefix(name) {
  return name.toLowerCase();
}

function extensionHookName(name, hook) {
  return extensionPrefix(name) + '_' + hook;
}

// The hook function of one extension, or null. globalThis is the shared script scope in Apps Script and in
// the Node loader alike.
function extensionHook(name, hook) {
  var fn = globalThis[extensionHookName(name, hook)];
  return typeof fn === 'function' ? fn : null;
}

// [{ name, prefix, fn }] for every extension defining the hook, in EXTENSIONS order.
function extensionHooks(hook) {
  var out = [];
  EXTENSIONS.forEach(function (name) {
    var fn = extensionHook(name, hook);
    if (fn) out.push({ name: name, prefix: extensionPrefix(name), fn: fn });
  });
  return out;
}

// An extension counts as installed when any of its hooks is defined.
function extensionInstalled(name) {
  return EXTENSION_HOOKS.some(function (hook) { return extensionHook(name, hook) !== null; });
}

function extensionErrorMessage(h, e) {
  return h.name + ' extension: ' + (e && e.message ? e.message : String(e));
}

// Status error entry for a failed hook: shows in the errors block like a ledger error.
function extensionError(h, e) {
  return { rotation: h.name, rowIndex: null, start: null, message: extensionErrorMessage(h, e) };
}

function logExtensionError(h, e) {
  if (typeof console !== 'undefined') console.log(extensionErrorMessage(h, e));
}

// Calls <prefix>_<hook> of every listed extension with args, in order; returns [{ name, prefix, value }] for
// the calls that returned. An exception in a hook never reaches the core: onError(h, error) is called (a
// console line by default) and that extension is skipped.
function callExtensionHooks(hook, args, onError) {
  var out = [];
  extensionHooks(hook).forEach(function (h) {
    try {
      out.push({ name: h.name, prefix: h.prefix, value: h.fn.apply(null, args) });
    } catch (e) {
      (onError || logExtensionError)(h, e);
    }
  });
  return out;
}
