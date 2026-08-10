import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizationHeader, groupsFromClaim, roleFor } from '../src/identity.js';
import type { GatewayConfig } from '../src/config.js';

const config = {
  groups: { admin: 'admin', editor: 'editor', reader: 'reader' }
} as GatewayConfig;

test('extracts only explicit string group claims', () => {
  assert.deepEqual(groupsFromClaim(['reader', 'editor', 'reader']), ['reader', 'editor']);
  assert.deepEqual(groupsFromClaim('reader editor'), ['reader', 'editor']);
  assert.deepEqual(groupsFromClaim({ reader: true }), []);
});

test('extracts ZITADEL project role assertion keys', () => {
  assert.deepEqual(groupsFromClaim({ admin: 'grant-1', reader: 'grant-2' }), ['admin', 'reader']);
  assert.deepEqual(groupsFromClaim({ reader: { 'org-1': 'example.test' } }), ['reader']);
});

test('admin takes precedence and unknown groups receive no role', () => {
  assert.equal(roleFor(['reader', 'admin'], config), 'admin');
  assert.equal(roleFor(['editor'], config), 'editor');
  assert.equal(roleFor(['other'], config), undefined);
});

test('requires a syntactically valid bearer header', () => {
  assert.equal(authorizationHeader({ authorization: 'Bearer opaque' }), 'opaque');
  assert.throws(() => authorizationHeader({ authorization: 'Basic opaque' }));
  assert.throws(() => authorizationHeader({}));
});
