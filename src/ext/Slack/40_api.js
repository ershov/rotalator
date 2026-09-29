// Slack extension: the Web API over UrlFetchApp and id resolution (DESIGN 14.4). Needs UrlFetchApp,
// PropertiesService and Utilities; the tests provide mocks.
var SLACK_API_URL = 'https://slack.com/api/';
var SLACK_TOKEN_PROPERTY = 'rotalator.slack.token';
var SLACK_TOKEN_HINT = 'set the bot token with Set Slack token';
var SLACK_ERROR_HINTS = {
  not_in_channel: 'invite the bot to the channel or grant chat:write.public',
  not_authed: SLACK_TOKEN_HINT,
  invalid_auth: SLACK_TOKEN_HINT,
  token_revoked: SLACK_TOKEN_HINT,
  account_inactive: SLACK_TOKEN_HINT,
  missing_scope: 'add the scope to the Slack app and reinstall it',
};

function slackToken() {
  return PropertiesService.getScriptProperties().getProperty(SLACK_TOKEN_PROPERTY);
}

// Slack accepts form-encoded parameters on every method (JSON only on some); unset parameters are left out.
function slackFormEncode(params) {
  return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); }).join('&');
}

function slackApiError(method, error) {
  return new Error(method + ': ' + error + (SLACK_ERROR_HINTS[error] ? '; ' + SLACK_ERROR_HINTS[error] : ''));
}

// One Web API call: POST to https://slack.com/api/<method> with the bot token; the parsed body when Slack says
// ok, else throws "<method>: <error>" with a hint for the common ones. On HTTP 429 sleeps Retry-After seconds
// once and retries; a second refusal fails like any other error.
function slackApi(method, params) {
  var token = slackToken();
  if (!token) throw slackApiError(method, 'no Slack token; ' + SLACK_TOKEN_HINT);
  var request = {
    method: 'post', contentType: 'application/x-www-form-urlencoded', headers: { Authorization: 'Bearer ' + token },
    payload: slackFormEncode(params || {}), muteHttpExceptions: true,
  };
  var response = UrlFetchApp.fetch(SLACK_API_URL + method, request);
  if (response.getResponseCode() === 429) {
    var headers = response.getHeaders() || {};
    Utilities.sleep(1000 * (Number(headers['Retry-After'] || headers['retry-after']) || 1));
    response = UrlFetchApp.fetch(SLACK_API_URL + method, request);
  }
  var body = null;
  try { body = JSON.parse(response.getContentText()); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') throw slackApiError(method, 'HTTP ' + response.getResponseCode());
  if (!body.ok) throw slackApiError(method, body.error || 'unknown error');
  return body;
}

// #name to id for every channel the bot can list, all pages.
function slackChannelIds() {
  var out = {};
  var cursor = '';
  do {
    var page = slackApi('conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 1000, cursor: cursor || undefined });
    (page.channels || []).forEach(function (c) { out['#' + c.name] = c.id; });
    cursor = (page.response_metadata || {}).next_cursor || '';
  } while (cursor);
  return out;
}

// @handle to id for every user group.
function slackGroupIds() {
  var out = {};
  (slackApi('usergroups.list', {}).usergroups || []).forEach(function (g) { out['@' + g.handle] = g.id; });
  return out;
}

// Why a text did not resolve; an email that Slack does not know fails in the API call itself.
function slackUnresolvedMessage(text) {
  if (slackIsChannelName(text)) return 'channel "' + text + '" not found; use its id, or invite the bot when it is private';
  if (text.charAt(0) === '@') return 'user group "' + text + '" not found';
  return 'member "' + text + '" has no Slack id; add a row "' + text + ' | id | U..."';
}

// Id resolution with the id rows of #Slack as the cache. resolve(text) gives the Slack id of a destination,
// member or group, or null when it is unknown: bare ids as they are, #name through conversations.list,
// an email through users.lookupByEmail, @handle through usergroups.list (the listings fetched once), a bare
// member id from the cache only. Each new resolution becomes an id row, listed by rows() in lookup order.
// API failures throw.
function slackResolver(ids) {
  var cache = {};
  Object.keys(ids || {}).forEach(function (name) { cache[name] = ids[name]; });
  var rows = [];
  var listed = {};
  var lookup = function (name, fetch) {
    if (cache[name]) return cache[name];
    var id = fetch();
    if (id) { cache[name] = id; rows.push([name, SLACK_ID_TYPE, id]); }
    return id || null;
  };
  var fromList = function (kind, list) {
    return function (name) { listed[kind] = listed[kind] || list(); return listed[kind][name]; };
  };
  var channel = fromList('channels', slackChannelIds);
  var group = fromList('groups', slackGroupIds);
  return {
    resolve: function (text) {
      if (slackIsUserId(text) || slackIsChannelId(text) || slackIsGroupId(text)) return text;
      if (slackIsChannelName(text)) return lookup(text, function () { return channel(text); });
      if (slackIsEmail(text)) return lookup(text, function () { return slackApi('users.lookupByEmail', { email: text }).user.id; });
      if (text.charAt(0) === '@') return lookup(text, function () { return group(text); });
      return cache[text] || null;
    },
    rows: function () { return rows; },
  };
}
