import assert from 'node:assert/strict';
import test from 'node:test';
import { clearJwksCacheForTest, remoteJwks } from '../src/identity.js';

test('Remote JWKS is cached by URI', () => {
  clearJwksCacheForTest();
  const first = remoteJwks('http://127.0.0.1:8084/oauth/v2/keys');
  const second = remoteJwks('http://127.0.0.1:8084/oauth/v2/keys');
  const different = remoteJwks('http://127.0.0.1:8084/oauth/v2/other-keys');
  assert.equal(first, second);
  assert.notEqual(first, different);
});
