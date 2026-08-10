import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  const loginName = page.locator('input[name="loginName"]:visible');
  if (await loginName.count()) {
    await loginName.click();
    await loginName.pressSequentially('openwebui-admin@openwebui.192.168.202.35');
    await loginName.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    const password = page.locator('input[name="password"]:visible');
    await password.fill(readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim());
    await password.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(1_500);
  }
  await page.goto('http://192.168.202.35:8084/ui/console/projects/381721272255512578', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-e2e="app-card"]').filter({ hasText: 'OpenWebUI' }).click();
  await page.getByRole('button', { name: 'Token Settings' }).click();
  const rolesInIdToken = page.getByLabel('User roles inside ID Token');
  if (!(await rolesInIdToken.isChecked())) {
    await rolesInIdToken.check({ force: true });
    await page.getByRole('button', { name: 'Save' }).click();
  }
  console.log(JSON.stringify({ application: 'OpenWebUI', user_roles_inside_id_token: await rolesInIdToken.isChecked() }));
} finally {
  await browser.close();
}
