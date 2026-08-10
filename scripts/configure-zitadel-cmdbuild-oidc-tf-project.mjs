import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
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
  await page.waitForTimeout(1400);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  const roleAssertion = page.getByLabel('Return user roles during authentication');
  const onlyAuthorized = page.getByLabel('Only authorized users can authenticate');
  if (!(await roleAssertion.isChecked())) await roleAssertion.check({ force: true });
  if (!(await onlyAuthorized.isChecked())) await onlyAuthorized.check({ force: true });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(600);
  console.log(JSON.stringify({
    projectId,
    roleAssertion: await roleAssertion.isChecked(),
    onlyAuthorized: await onlyAuthorized.isChecked(),
    url: page.url(),
  }));
} finally {
  await browser.close();
}
