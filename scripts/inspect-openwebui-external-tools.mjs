import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const openWebUiUrl = 'http://192.168.202.35:8083';
const username = 'cmdbuild-oidc-tf-admin';
const password = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(`${openWebUiUrl}/auth?redirect=%2F`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Continue with SSO/i }).click();
  await page.waitForTimeout(1_500);
  const loginName = page.locator('input[name="loginName"]:visible');
  if (await loginName.count()) {
    await loginName.pressSequentially(username);
    await page.getByRole('button', { name: 'Continue' }).click();
    const passwordInput = page.locator('input[name="password"]:visible');
    await passwordInput.waitFor({ state: 'visible' });
    await passwordInput.fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL((url) => url.origin === openWebUiUrl && !url.pathname.startsWith('/auth'), { timeout: 25_000 });
  await page.waitForTimeout(2_000);
  const identity = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'openwebui_session_token_missing' };
    const response = await fetch('/api/v1/auths/', { headers: { authorization: `Bearer ${token}` } });
    const user = await response.json();
    return { status: response.status, role: user.role };
  });
  const nativeMcpProbe = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'openwebui_session_token_missing' };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const toolServers = await fetch('/api/v1/configs/tool_servers', { headers });
    const toolServersPayload = await toolServers.json();
    const verify = await fetch('/api/v1/configs/tool_servers/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'http://192.168.202.35:8085/mcp',
        path: '',
        type: 'mcp',
        auth_type: 'oauth_2.1',
        headers: null,
        key: null,
        config: { enable: true, function_name_filter_list: '', access_grants: [] },
        info: { id: 'cmdbuild-oidc-tf-poc-probe', name: 'CMDBuild OIDC TF POC probe' },
      }),
    });
    const verifyPayload = await verify.json().catch(() => ({}));
    return {
      toolServersStatus: toolServers.status,
      toolServers: Array.isArray(toolServersPayload.TOOL_SERVER_CONNECTIONS)
        ? toolServersPayload.TOOL_SERVER_CONNECTIONS.map((connection) => ({
          type: connection.type,
          url: connection.url,
          auth_type: connection.auth_type,
          id: connection.info?.id,
          name: connection.info?.name,
        }))
        : [],
      oauthVerifyStatus: verify.status,
      oauthMetadata: verifyPayload.oauth_server_metadata
        ? {
          issuer: verifyPayload.oauth_server_metadata.issuer,
          authorization_endpoint: verifyPayload.oauth_server_metadata.authorization_endpoint,
          token_endpoint: verifyPayload.oauth_server_metadata.token_endpoint,
          registration_endpoint: verifyPayload.oauth_server_metadata.registration_endpoint,
          scopes_supported: verifyPayload.oauth_server_metadata.scopes_supported,
        }
        : undefined,
      error: typeof verifyPayload.detail === 'string' ? verifyPayload.detail : undefined,
      validationErrors: Array.isArray(verifyPayload.detail)
        ? verifyPayload.detail.map((item) => ({ location: item.loc, type: item.type }))
        : undefined,
    };
  });
  const welcomeClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await welcomeClose.count()) await welcomeClose.click();
  await page.goto(`${openWebUiUrl}/admin/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_500);
  await page.getByRole('button', { name: 'External Tools' }).click();
  await page.waitForTimeout(600);
  console.log(JSON.stringify({
    identity,
    nativeMcpProbe,
    url: page.url(),
    links: await page.locator('a').evaluateAll((elements) => elements.map((link) => ({
      text: link.textContent?.trim(),
      href: link.getAttribute('href'),
    })).filter((link) => link.text || link.href)),
    buttons: await page.locator('button:visible').allTextContents(),
    inputs: await page.locator('input, textarea, select').evaluateAll((elements) => elements.map((element) => ({
      tag: element.tagName,
      type: element.getAttribute('type'),
      name: element.getAttribute('name'),
      id: element.id,
      placeholder: element.getAttribute('placeholder'),
      valueLength: 'value' in element && typeof element.value === 'string' ? element.value.length : undefined,
    }))),
    text: (await page.locator('body').innerText()).slice(0, 4000),
  }));
} finally {
  await browser.close();
}
