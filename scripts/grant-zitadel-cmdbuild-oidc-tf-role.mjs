import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const [userId, role] = process.argv.slice(2);
if (!userId || !['admin', 'editor', 'reader'].includes(role)) {
  throw new Error('usage: grant-zitadel-cmdbuild-oidc-tf-role.mjs <user-id> <admin|editor|reader>');
}

const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1500);
  await page.goto(`http://192.168.202.35:8084/ui/console/users/${userId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Role Assignments' }).click();
  await page.getByText('New', { exact: true }).click();
  await page.locator('#cnsl-input-5').fill(projectName);
  await page.getByText(projectName, { exact: true }).last().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const roleRow = page.locator('tr').filter({ hasText: role });
  await roleRow.locator('input[type="checkbox"]').check({ force: true });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(700);
  const text = await page.locator('body').innerText();
  console.log(JSON.stringify({
    userId,
    role,
    granted: text.includes(role),
    url: page.url(),
  }));
} finally {
  await browser.close();
}
