import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeNotionFailure,
  describeStartupFailure,
  maskToken,
  tokenSource,
  type NotionContext,
} from './boot.ts';

const CTX: NotionContext = {
  token: 'ntn_abcdefghijklmnop',
  source: '.env',
  registryDatabaseId: '2f0b1c2d3e4f5061728394a5b6c7d8e9',
};

/** Shape of a `@notionhq/client` API error, as far as the mapping cares. */
const notionError = (code: string, message: string) => Object.assign(new Error(message), { code });

test('an invalid token names the token, its origin, and the integrations page', () => {
  const failure = describeNotionFailure(notionError('unauthorized', 'API token is invalid.'), CTX);

  assert.match(failure.message, /NOTION_TOKEN/);
  assert.match(failure.message, /ntn_abcd…/);
  assert.match(failure.hint, /\.env in this repo/);
  assert.match(failure.hint, /notion\.so\/profile\/integrations/);
});

test('an invalid token blames the shell when the shell is what set it', () => {
  const failure = describeNotionFailure(notionError('unauthorized', 'API token is invalid.'), {
    ...CTX,
    source: 'shell',
  });

  assert.match(failure.hint, /shell environment/);
  assert.match(failure.hint, /wins over \.env/);
});

test('an unshared registry is reported as sharing, not as a bad token', () => {
  for (const code of ['object_not_found', 'restricted_resource']) {
    const failure = describeNotionFailure(notionError(code, 'Could not find database.'), CTX);

    assert.match(failure.message, new RegExp(CTX.registryDatabaseId));
    assert.match(failure.hint, /Connections/);
    assert.doesNotMatch(failure.hint, /profile\/integrations/);
  }
});

test('transient failures do not send anyone to the Notion UI', () => {
  const limited = describeNotionFailure(notionError('rate_limited', 'Rate limited.'), CTX);
  assert.match(limited.hint, /Nothing is misconfigured/);

  const offline = describeNotionFailure(
    notionError('notionhq_client_request_error', 'fetch failed'),
    CTX,
  );
  assert.match(offline.message, /fetch failed/);
  assert.match(offline.hint, /network/);
});

test('an unrecognised failure still carries its message and a next step', () => {
  const failure = describeNotionFailure(new Error('socket hang up'), CTX);

  assert.match(failure.message, /socket hang up/);
  assert.match(failure.hint, /npm run preflight/);
});

test('a taken port is named as a taken port, with the port in it', () => {
  const failure = describeStartupFailure(
    Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }),
    4201,
  );

  assert.match(failure.message, /4201 is already in use/);
  assert.match(failure.hint, /PORT=4300/);
});

test('other startup failures fall back to the error text', () => {
  const failure = describeStartupFailure(new Error('SQLITE_CANTOPEN'), 4201);
  assert.match(failure.message, /SQLITE_CANTOPEN/);
});

test('token source distinguishes an exported value from .env', () => {
  assert.equal(tokenSource('ntn_shell', 'ntn_shell'), 'shell');
  assert.equal(tokenSource(undefined, 'ntn_fromfile'), '.env');
  assert.equal(tokenSource(undefined, undefined), 'unset');
});

test('masking never prints a whole token', () => {
  assert.equal(maskToken('ntn_abcdefghijklmnop'), 'ntn_abcd…');
  assert.equal(maskToken('short'), '…');
});
