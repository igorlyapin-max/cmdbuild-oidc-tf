import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const role = process.argv[2] ?? 'reader';
if (!['admin', 'editor', 'reader'].includes(role)) {
  throw new Error('usage: inspect-zitadel-user-security.mjs [admin|editor|reader]');
}

const userId = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_user_id`, 'utf8').trim();
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/actions', { waitUntil: 'domcontentloaded' });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (new URL(page.url()).pathname.startsWith('/ui/v2/login/') && await page.locator('input[name="loginName"]').count()) {
      const loginName = page.locator('input[name="loginName"]');
      await loginName.click();
      await loginName.pressSequentially(adminUsername, { delay: 10 });
      await loginName.press('Tab');
      await page.getByRole('button', { name: 'Continue' }).waitFor({ state: 'visible' });
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Continue' }).click();
      const password = page.locator('input[name="password"]');
      await password.waitFor({ state: 'visible' });
      await password.fill(adminPassword);
      await password.press('Tab');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL((url) => url.pathname.startsWith('/ui/console/'), { timeout: 20_000 });
      await page.goto(`http://192.168.202.35:8084/ui/console/users/${userId}`, { waitUntil: 'domcontentloaded' });
      break;
    }
    await page.waitForTimeout(250);
  }
  await page.goto(`http://192.168.202.35:8084/ui/console/users/${userId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Password and Security' }).click();
  await page.locator('button[card-actions]').first().click();
  await page.waitForTimeout(200);
  console.log(JSON.stringify({
    role,
    menuItems: await page.locator('[role="menuitem"]').allTextContents(),
    buttons: await page.locator('.cdk-overlay-pane button').allTextContents(),
    text: (await page.locator('body').innerText()).slice(-1200),
  }));
} finally {
  await browser.close();
}
