import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const username = process.env.ZITADEL_ADMIN_USERNAME ?? 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync(
  process.env.ZITADEL_ADMIN_PASSWORD_FILE ?? '/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password',
  'utf8'
).trim();
if (!password) throw new Error('ZITADEL admin password file is empty');

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  const loginName = page.locator('input[name="loginName"]');
  await loginName.click();
  await loginName.pressSequentially(username);
  await loginName.press('Tab');
  await page.getByRole('button', { name: 'Continue' }).click();
  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.waitFor({ state: 'visible', timeout: 10_000 });
  await passwordInput.fill(password);
  await passwordInput.press('Tab');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(2500);
  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    navigation: await page.locator('a').evaluateAll(elements => elements.map(link => link.textContent?.trim()).filter(Boolean).slice(0, 40)),
    text: (await page.locator('body').innerText()).slice(0, 2500)
  }, null, 2));
} finally {
  await browser.close();
}
