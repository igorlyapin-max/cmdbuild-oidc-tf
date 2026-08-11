import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const openWebUiUrl = 'http://192.168.202.35:8083';
const gatewayUrl = 'http://192.168.202.35:8085/mcp';
const oidcIssuer = 'http://192.168.202.35:8084/';
const serverId = 'cmdbuild-oidc-tf-native-mcp';
const clientId = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_native_mcp_client_id', 'utf8').trim();
const resourceProjectId = readState('resource_project_id');
const resourceAudienceScope = `urn:zitadel:iam:org:project:id:${resourceProjectId}:aud`;
const callbackUri = `${openWebUiUrl}/oauth/clients/mcp:${serverId}/callback`;
const adminUsername = 'cmdbuild-oidc-tf-admin';
const adminPassword = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_admin_password', 'utf8').trim();

function encryptedClientInfo() {
  const clientInfo = {
    redirect_uris: [callbackUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: `openid profile email offline_access ${resourceAudienceScope}`,
    client_name: 'cmdbuild-oidc-tf native MCP',
    client_id: clientId,
    client_secret: null,
    client_id_issued_at: null,
    client_secret_expires_at: null,
    issuer: `${oidcIssuer}.well-known/openid-configuration`,
    server_metadata: {
      issuer: oidcIssuer,
      authorization_endpoint: `${oidcIssuer}oauth/v2/authorize`,
      token_endpoint: `${oidcIssuer}oauth/v2/token`,
      registration_endpoint: null,
      scopes_supported: ['openid', 'profile', 'email', 'phone', 'address', 'offline_access', resourceAudienceScope],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
    },
  };
  const command = [
    'export OAUTH_CLIENT_ID="$(cat /run/secrets/openwebui_oidc_client_id)";',
    'export OAUTH_CLIENT_SECRET="$(cat /run/secrets/openwebui_oidc_client_secret)";',
    'export WEBUI_SECRET_KEY="$(cat /run/secrets/openwebui_webui_secret_key)";',
    'python -c "import json, sys; from open_webui.utils.oauth import encrypt_data; print(encrypt_data(json.load(sys.stdin)))"',
  ].join(' ');
  const stdout = execFileSync('docker', ['exec', '-i', 'openwebui', 'sh', '-lc', command], {
    input: JSON.stringify(clientInfo),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const encrypted = stdout.trim().split(/\r?\n/).at(-1);
  if (!encrypted) throw new Error('openwebui_oauth_metadata_encryption_failed');
  return encrypted;
}

function clearStaleOauthSessions() {
  const provider = `mcp:${serverId}`;
  const command = [
    'export OAUTH_CLIENT_ID="$(cat /run/secrets/openwebui_oidc_client_id)";',
    'export OAUTH_CLIENT_SECRET="$(cat /run/secrets/openwebui_oidc_client_secret)";',
    'export WEBUI_SECRET_KEY="$(cat /run/secrets/openwebui_webui_secret_key)";',
    `python -c "from open_webui.models.oauth_sessions import OAuthSessions; OAuthSessions.delete_sessions_by_provider('${provider}')"`,
  ].join(' ');
  execFileSync('docker', ['exec', '-i', 'openwebui', 'sh', '-lc', command], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function signIn(page) {
  await page.goto(`${openWebUiUrl}/auth?redirect=%2F`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Continue with SSO/i }).click();
  await page.waitForTimeout(1_500);
  const loginName = page.locator('input[name="loginName"]:visible');
  if (await loginName.count()) {
    await loginName.pressSequentially(adminUsername);
    await page.getByRole('button', { name: 'Continue' }).click();
    const password = page.locator('input[name="password"]:visible');
    await password.waitFor({ state: 'visible' });
    await password.fill(adminPassword);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL((url) => url.origin === openWebUiUrl && !url.pathname.startsWith('/auth'), { timeout: 25_000 });
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  await signIn(page);
  const encrypted = encryptedClientInfo();
  const outcome = await page.evaluate(async ({ encrypted, gatewayUrl, serverId, resourceProjectId }) => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('openwebui_session_token_missing');
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const [groupsResponse, serversResponse] = await Promise.all([
      fetch('/api/v1/groups/', { headers }),
      fetch('/api/v1/configs/tool_servers', { headers }),
    ]);
    if (!groupsResponse.ok || !serversResponse.ok) throw new Error('openwebui_configuration_read_failed');
    const groups = await groupsResponse.json();
    const current = await serversResponse.json();
    const groupIds = Object.fromEntries(groups
      .filter((group) => group?.name === 'reader' || group?.name === 'editor')
      .map((group) => [group.name, group.id]));
    if (!groupIds.reader || !groupIds.editor) throw new Error('openwebui_poc_groups_missing');
    const connections = Array.isArray(current.TOOL_SERVER_CONNECTIONS) ? current.TOOL_SERVER_CONNECTIONS : [];
    const existingIndex = connections.findIndex((connection) => connection?.info?.id === serverId);
    if (existingIndex >= 0 && (connections[existingIndex].type !== 'mcp' || connections[existingIndex].auth_type !== 'oauth_2.1')) {
      throw new Error('native_mcp_server_id_conflict');
    }
    const connection = {
      url: gatewayUrl,
      path: '',
      type: 'mcp',
      auth_type: 'oauth_2.1',
      headers: null,
      key: null,
      config: {
        enable: true,
        function_name_filter_list: 'cmdbuild_whoami,cmdbuild_read_demo_cards,cmdbuild_update_demo_card',
        access_grants: [
          { principal_type: 'group', principal_id: groupIds.reader, permission: 'read' },
          { principal_type: 'group', principal_id: groupIds.editor, permission: 'read' },
        ],
      },
      info: {
        id: serverId,
        name: 'CMDBuild OIDC TF native MCP',
        description: 'POC-only user-token forwarding to the isolated CMDBuild card.',
        oauth_client_info: encrypted,
      },
    };
    const nextConnections = existingIndex >= 0
      ? connections.map((item, index) => index === existingIndex ? connection : item)
      : [...connections, connection];
    const response = await fetch('/api/v1/configs/tool_servers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ TOOL_SERVER_CONNECTIONS: nextConnections }),
    });
    if (!response.ok) throw new Error(`openwebui_native_mcp_configure_failed:${response.status}`);
    return { status: existingIndex >= 0 ? 'reconciled' : 'configured', group_count: 2, resource_project_id_hash: resourceProjectId.slice(-8) };
  }, { encrypted, gatewayUrl, serverId, resourceProjectId });
  clearStaleOauthSessions();
  console.log(JSON.stringify({ ...outcome, stale_oauth_sessions_cleared: true }));
} finally {
  await browser.close();
}
