import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
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
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('[data-e2e="app-card"]').filter({ hasText: `${projectName}-cmdbuild` }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.waitForTimeout(200);
  console.log(JSON.stringify({
    url: page.url(),
    labels: await page.locator('label').evaluateAll((elements) => elements.map((element) => ({ text: element.textContent?.trim(), for: element.htmlFor })).filter((item) => item.text)),
    buttons: await page.locator('button').evaluateAll((elements) => elements.map((element) => element.textContent?.trim()).filter(Boolean)),
    menuItems: await page.locator('[role="menuitem"]').evaluateAll((elements) => elements.map((element) => element.textContent?.trim()).filter(Boolean)),
    secretRelated: await page.locator('*').evaluateAll((elements) => elements
      .filter((element) => element.children.length === 0 && /secret/i.test(element.textContent ?? ''))
      .map((element) => ({ tag: element.tagName, parentTag: element.parentElement?.tagName, className: element.className }))),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((element) => ({ id: element.id, type: element.type, checked: element.checked })))
  }));
} finally {
  await browser.close();
}
