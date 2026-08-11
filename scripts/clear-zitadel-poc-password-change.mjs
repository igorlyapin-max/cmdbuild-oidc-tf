import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const roles = process.argv.slice(2);
const targetRoles = roles.length === 0 ? ['reader', 'editor'] : roles;
const supportedRoles = ['admin', 'reader', 'editor', 'unassigned', 'unmapped'];
if (!targetRoles.every((role) => supportedRoles.includes(role))) {
  throw new Error(`usage: clear-zitadel-poc-password-change.mjs [${supportedRoles.join('] [')}]`);
}

const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

async function loginAsAdmin() {
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1_800);
  return page;
}

try {
  const page = await loginAsAdmin();
  let authorization;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/zitadel.management.v1.ManagementService/ListUserChanges') {
      authorization = request.headers().authorization;
    }
  });
  const results = [];
  for (const role of targetRoles) {
    const userId = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_user_id`, 'utf8').trim();
    const password = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_password`, 'utf8').trim();
    await page.goto(`http://192.168.202.35:8084/ui/console/users/${userId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    if (!authorization) throw new Error('zitadel_console_management_authorization_missing');
    const status = await page.evaluate(async ({ authorization, password, userId }) => {
      const response = await fetch(`/management/v1/users/${userId}/password`, {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password, noChangeRequired: true }),
      });
      return response.status;
    }, { authorization, password, userId });
    if (status !== 200) throw new Error(`zitadel_set_human_password_failed:${role}:${status}`);
    results.push({ role, status });
  }
  console.log(JSON.stringify({ status: 'ok', results }));
} finally {
  await browser.close();
}
