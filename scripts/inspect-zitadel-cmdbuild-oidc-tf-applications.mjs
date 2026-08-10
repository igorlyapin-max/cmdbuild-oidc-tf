import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const bffAppName = `${projectName}-bff`;
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
  await page.waitForTimeout(700);
  await page.locator('[data-e2e="app-card"]').filter({ hasText: 'cmdbuild-oidc-tf-bff' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Token Settings' }).click();
  await page.waitForTimeout(300);
  await page.locator('#mat-select-4').click();
  await page.waitForTimeout(200);
  const text = await page.locator('body').innerText();
  console.log(JSON.stringify({
    applications: [bffAppName, `${projectName}-cmdbuild`].filter((name) => text.includes(name)),
    appNodes: await page.locator('*').evaluateAll((elements, appName) => elements
      .filter((element) => element.children.length === 0 && element.textContent?.trim() === appName)
      .map((element) => ({ tag: element.tagName, parent: element.parentElement?.outerHTML.slice(0, 1400) })), bffAppName),
    labels: await page.locator('label').evaluateAll((elements) => elements.map((label) => ({ text: label.textContent?.trim(), for: label.htmlFor })).filter((label) => label.text)),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((input) => ({ id: input.id, type: input.type, checked: input.checked }))),
    text: text.slice(0, 2600),
  }));
} finally {
  await browser.close();
}
