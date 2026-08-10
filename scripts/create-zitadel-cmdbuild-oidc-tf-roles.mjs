import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const username = 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const roles = [
  ['admin', 'Admin', projectName],
  ['editor', 'Editor', projectName],
  ['reader', 'Reader', projectName]
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1800);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}?id=roles`, { waitUntil: 'domcontentloaded' });
  await page.getByText('New', { exact: true }).click();
  for (let index = 0; index < roles.length; index += 1) {
    if (index > 0) await page.getByRole('button', { name: 'Add additional role' }).click();
    const [key, displayName, group] = roles[index];
    const offset = index * 3;
    await page.locator(`#cnsl-input-${offset}`).fill(key, { force: true });
    await page.locator(`#cnsl-input-${offset + 1}`).fill(displayName, { force: true });
    await page.locator(`#cnsl-input-${offset + 2}`).fill(group, { force: true });
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText();
  console.log(JSON.stringify({
    url: page.url(),
    created_roles_present: Object.fromEntries(roles.map(([key]) => [key, body.includes(key)])),
    text: body.slice(0, 1800)
  }, null, 2));
} finally { await browser.close(); }
