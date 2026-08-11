import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const role = 'unassigned';
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
  await page.waitForTimeout(1_500);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}?id=roles`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const hasRole = (await page.locator('body').innerText()).split(/\s+/).includes(role);
  if (!hasRole) {
    await page.getByText('New', { exact: true }).click();
    await page.locator('#cnsl-input-0').fill(role, { force: true });
    await page.locator('#cnsl-input-1').fill('Unassigned POC', { force: true });
    await page.locator('#cnsl-input-2').fill(projectName, { force: true });
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(800);
  }
  const confirmed = (await page.locator('body').innerText()).split(/\s+/).includes(role);
  if (!confirmed) throw new Error('zitadel_unassigned_role_not_confirmed');
  console.log(JSON.stringify({ status: hasRole ? 'already_exists' : 'created', role, confirmed: true }));
} finally {
  await browser.close();
}
