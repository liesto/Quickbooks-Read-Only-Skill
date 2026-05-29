// qbo-classify.js
'use strict';

// Pure classification of a QBO API call. No I/O.
//
// QBO is unusual: almost every operation is an HTTP POST. Reads are POST .../query,
// creates are POST .../<entity> (no Id in body), edits are POST .../<entity> with an
// Id + SyncToken, deletes/voids use ?operation=delete / ?operation=void, and /batch can
// carry mixed operations. So we classify by method + URL path + operation param + body
// shape, NOT by HTTP method alone. Anything not confidently a READ is treated as a write.
const DESTRUCTIVE = new Set(['DELETE', 'VOID', 'MERGE', 'BATCH']);

function parseBody(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  try { return JSON.parse(body); } catch { return null; }
}

function classifyCall({ method = 'GET', urlPath = '', body = null } = {}) {
  const m = String(method).toUpperCase();
  const [path, query = ''] = String(urlPath).split('?');
  const params = new URLSearchParams(query);
  const operation = (params.get('operation') || '').toLowerCase();
  const entity = path.replace(/^\/+/, '').split('/')[0].toLowerCase() || '';

  const parsed = parseBody(body);
  const inner = parsed && typeof parsed === 'object'
    ? ((parsed.Id !== undefined || parsed.SyncToken !== undefined)
        ? parsed
        : Object.values(parsed).find(
            v => v && typeof v === 'object' && ('Id' in v || 'SyncToken' in v)) || parsed)
    : null;
  const id = inner && inner.Id !== undefined ? String(inner.Id) : null;
  const syncToken = inner && inner.SyncToken !== undefined ? String(inner.SyncToken) : null;

  let type;
  if (m === 'GET') type = 'READ';
  else if (entity === 'query') type = 'READ';
  else if (entity === 'batch') type = 'BATCH';
  else if (operation === 'delete') type = 'DELETE';
  else if (operation === 'void') type = 'VOID';
  else if (operation === 'merge') type = 'MERGE';
  else if (id && syncToken) type = 'EDIT';
  else type = 'CREATE';

  return {
    type,
    entity,
    id,
    syncToken,
    operation: operation || null,
    isWrite: type !== 'READ',
    isDestructive: DESTRUCTIVE.has(type),
  };
}

module.exports = { classifyCall, DESTRUCTIVE };
