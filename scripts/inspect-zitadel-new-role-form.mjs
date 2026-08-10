import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const projectId = '385505066485809155';
const username = 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
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
  await page.waitForTimeout(500);
  console.log(JSON.stringify({
    url: page.url(),
    inputs: await page.locator('input').evaluateAll(elements => elements.map(input => ({ id: input.id, type: input.type, name: input.getAttribute('name'), value: input.value }))),
    buttons: await page.locator('button').evaluateAll(elements => elements.map(button => button.textContent?.trim()).filter(Boolean).slice(0, 30)),
    text: (await page.locator('body').innerText()).slice(0, 2400)
  }, null, 2));
} finally { await browser.close(); }
