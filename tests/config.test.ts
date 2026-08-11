import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBffConfig } from '../src/config.js';

const bffEnvironment: Record<string, string> = {
  BFF_PORT: '18086',
  BFF_CLIENT_ID: 'test-bff-client',
  BFF_REDIRECT_URI: 'http://127.0.0.1:18086/oauth/callback',
  OIDC_ISSUER: 'http://127.0.0.1:8084',
  OIDC_JWKS_URI: 'http://127.0.0.1:8084/oauth/v2/keys',
  CMDBUILD_RESOURCE_PROJECT_ID: '123456789',
  CMDBUILD_RESOURCE_AUDIENCE: '123456789',
  CMDBUILD_BASE_URL: 'http://127.0.0.1:18090',
  MCP_GATEWAY_URL: 'http://127.0.0.1:18100/mcp',
  LOG_SINK_URL: 'http://127.0.0.1:18101/v1/logs',
  LOG_SINK_HMAC_KEY_FILE: 'package.json',
  DEPLOYMENT_PROFILE: 'poc-http',
  GROUP_CLAIM_NAME: 'cmdbuild_oidc_tf_groups',
  GROUP_ADMIN: 'admin',
  GROUP_EDITOR: 'editor',
  GROUP_READER: 'reader',
  CMDBUILD_DEMO_CLASS: 'Building',
  CMDBUILD_WRITABLE_ATTRIBUTES: 'Description,Notes',
  ALLOWED_HOSTS: '127.0.0.1,localhost'
};

function withBffEnvironment(run: () => void): void {
  const snapshot = Object.fromEntries(Object.keys({ ...bffEnvironment, BFF_POC_WRITE_ENABLED: '', CMDBUILD_DEMO_CARD_ID: '' }).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, bffEnvironment);
    delete process.env.BFF_POC_WRITE_ENABLED;
    delete process.env.CMDBUILD_DEMO_CARD_ID;
    run();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('BFF POC write is disabled unless explicitly enabled', () => {
  withBffEnvironment(() => {
    const config = loadBffConfig();
    assert.equal(config.pocWriteEnabled, false);
    assert.equal(config.resourceAudience, '123456789');
    assert.equal(config.maxPendingLogins, 1000);
    assert.equal(config.demoCardId, undefined);
    assert.deepEqual([...config.writableAttributes], ['Description', 'Notes']);
  });
});

test('BFF requires a dedicated CMDBuild resource audience', () => {
  withBffEnvironment(() => {
    process.env.CMDBUILD_RESOURCE_AUDIENCE = 'different-resource';
    assert.throws(() => loadBffConfig(), /CMDBUILD_RESOURCE_AUDIENCE must equal/);
  });
});

test('BFF POC write accepts only a boolean configuration value', () => {
  withBffEnvironment(() => {
    process.env.BFF_POC_WRITE_ENABLED = 'enabled';
    assert.throws(() => loadBffConfig(), /BFF_POC_WRITE_ENABLED must be true or false/);
  });
});

test('BFF rejects a deployment profile that could be mistaken for production', () => {
  withBffEnvironment(() => {
    process.env.DEPLOYMENT_PROFILE = 'production';
    assert.throws(() => loadBffConfig(), /DEPLOYMENT_PROFILE must be poc-http/);
  });
});

test('BFF requires the signed log sink key to be readable and configured', () => {
  withBffEnvironment(() => {
    process.env.LOG_SINK_HMAC_KEY_FILE = 'missing-log-sink-key';
    assert.throws(() => loadBffConfig(), /LOG_SINK_HMAC_KEY_FILE must reference/);
  });
});
