import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const role = process.argv[2] ?? 'reader';
if (!['reader', 'editor', 'unassigned'].includes(role)) {
  throw new Error('usage: e2e-openwebui-native-mcp-oauth.mjs [reader|editor|unassigned]');
}

const openWebUiUrl = 'http://192.168.202.35:8083';
const serverId = 'cmdbuild-oidc-tf-native-mcp';
const username = `cmdbuild-oidc-tf-${role}`;
const password = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_password`, 'utf8').trim();

async function openWebUiTools(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'openwebui_session_token_missing' };
    const response = await fetch('/api/v1/tools/', { headers: { authorization: `Bearer ${token}` } });
    const tools = await response.json();
    const tool = Array.isArray(tools) ? tools.find((item) => item.id === 'server:mcp:cmdbuild-oidc-tf-native-mcp') : undefined;
    return { status: response.status, visible: Boolean(tool), authenticated: tool?.authenticated === true };
  });
}

async function login(page) {
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
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(25_000);
  await login(page);
  const before = await openWebUiTools(page);
  if (role === 'unassigned') {
    if (before.status !== 200 || before.visible) throw new Error('native_mcp_tool_visible_to_unassigned_user');
    console.log(JSON.stringify({ role, tool_visible: false, access: 'denied' }));
  } else {
    if (before.status !== 200 || !before.visible) throw new Error('native_mcp_tool_not_visible_to_role');

    await page.goto(`${openWebUiUrl}/oauth/clients/mcp:${serverId}/authorize`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);
    const loginName = page.locator('input[name="loginName"]:visible');
    if (await loginName.count()) {
      await loginName.pressSequentially(username);
      await page.getByRole('button', { name: 'Continue' }).click();
      const passwordInput = page.locator('input[name="password"]:visible');
      await passwordInput.waitFor({ state: 'visible' });
      await passwordInput.fill(password);
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await page.waitForURL((url) => url.origin === openWebUiUrl && !url.pathname.startsWith('/oauth/clients/'), { timeout: 25_000 });
    const after = await openWebUiTools(page);
    if (after.status !== 200 || !after.visible || !after.authenticated) throw new Error('native_mcp_oauth_session_not_established');
    console.log(JSON.stringify({ role, tool_visible: true, authenticated_before: before.authenticated, authenticated_after: after.authenticated }));
  }
} finally {
  await browser.close();
}
