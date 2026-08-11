import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const appId = readState('native_mcp_app_id');
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_200);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1_400);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}/apps/${appId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Token Settings' }).click();
  await page.locator('#mat-select-4').click();
  await page.getByText('JWT', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);
  console.log(JSON.stringify({ app_id_hash: appId.slice(-8), tokenType: 'JWT' }));
} finally {
  await browser.close();
}
