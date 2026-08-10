import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const projectId = '385505066485809155';
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
  await page.waitForTimeout(500);
  console.log(JSON.stringify({
    url: page.url(),
    labels: await page.locator('label').evaluateAll((elements) => elements.map((label) => ({ text: label.textContent?.trim(), for: label.htmlFor })).filter((label) => label.text)),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((input) => ({ id: input.id, type: input.type, checked: input.checked }))),
    buttons: await page.locator('button').evaluateAll((elements) => elements.map((button) => button.textContent?.trim()).filter(Boolean)),
    text: (await page.locator('body').innerText()).slice(0, 3500),
  }, null, 2));
} finally {
  await browser.close();
}
