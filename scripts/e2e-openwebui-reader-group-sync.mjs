import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const openWebUiUrl = 'http://192.168.202.35:8083';
const bffUrl = 'http://192.168.202.35:18086';
const username = 'cmdbuild-oidc-tf-reader';
const password = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_reader_password', 'utf8').trim();

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  // Establish the browser SSO session through the direct BFF first. This avoids
  // coupling the OpenWebUI group-sync assertion to the Login v2 form animation.
  await page.goto(`${bffUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(`${bffUrl}/`, { timeout: 25_000 });

  await page.goto(`${openWebUiUrl}/auth?redirect=%2F`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Continue with SSO/i }).click();
  const openWebUiLoginName = page.locator('input[name="loginName"]:visible');
  if (await openWebUiLoginName.count()) {
    await openWebUiLoginName.pressSequentially(username);
    await page.getByRole('button', { name: 'Continue' }).click();
    const openWebUiPassword = page.locator('input[name="password"]:visible');
    await openWebUiPassword.waitFor({ state: 'visible' });
    await openWebUiPassword.fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL((url) => url.origin === openWebUiUrl && !url.pathname.startsWith('/auth'), { timeout: 25_000 });

  const identity = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'openwebui_session_token_missing' };
    const headers = { authorization: `Bearer ${token}` };
    const [userResponse, groupsResponse] = await Promise.all([
      fetch('/api/v1/auths/', { headers }),
      fetch('/api/v1/users/groups', { headers })
    ]);
    const user = await userResponse.json();
    const groups = await groupsResponse.json();
    return {
      user_status: userResponse.status,
      groups_status: groupsResponse.status,
      role: typeof user.role === 'string' ? user.role : 'missing',
      groups: Array.isArray(groups)
        ? groups.map((group) => typeof group.name === 'string' ? group.name : 'unnamed').sort()
        : []
    };
  });

  if (identity.error || identity.user_status !== 200 || identity.groups_status !== 200 || identity.role !== 'user' || !identity.groups.includes('reader')) {
    throw new Error(`openwebui_reader_group_sync_failed:${JSON.stringify(identity)}`);
  }
  console.log(JSON.stringify({ login: 'ok', ...identity }));
} finally {
  await browser.close();
}
