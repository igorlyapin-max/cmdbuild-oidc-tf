import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const username = process.env.ZITADEL_ADMIN_USERNAME ?? 'openwebui-admin';
const passwordFile = process.env.ZITADEL_ADMIN_PASSWORD_FILE
  ?? '/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password';

// Read only to prove that the existing secret file is non-empty; do not log it.
if (!readFileSync(passwordFile, 'utf8').trim()) throw new Error('ZITADEL admin password file is empty');

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  const loginName = page.locator('input[name="loginName"]');
  await loginName.waitFor({ state: 'visible', timeout: 5000 });
  await loginName.click();
  await loginName.pressSequentially(username);
  await loginName.press('Tab');
  await page.waitForTimeout(500);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  const enabled = await continueButton.isEnabled();
  if (enabled) await continueButton.click({ timeout: 5000 });
  await page.waitForTimeout(800);
  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    login_name_value: await loginName.inputValue(),
    inputs: await page.locator('input').evaluateAll(elements => elements.map(input => ({ type: input.type, name: input.getAttribute('name'), autocomplete: input.getAttribute('autocomplete') }))),
    continue_enabled: enabled,
    buttons: await page.locator('button').evaluateAll(elements => elements.map(button => button.textContent?.trim()).filter(Boolean).slice(0, 20)),
    text: (await page.locator('body').innerText()).slice(0, 1500)
  }, null, 2));
} finally {
  await browser.close();
}
