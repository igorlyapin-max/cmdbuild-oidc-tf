import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  const loginName = page.locator('input[name="loginName"]');
  if (await loginName.isVisible().catch(() => false)) {
    await loginName.click();
    await loginName.pressSequentially('openwebui-admin@openwebui.192.168.202.35');
    await loginName.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    const password = page.locator('input[name="password"]');
    await password.fill(readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim());
    await password.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(1_500);
  }
  await page.goto('http://192.168.202.35:8084/ui/console/actions', { waitUntil: 'domcontentloaded' });
  await page.getByText('Add trigger', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('mat-select').nth(1).click();
  await page.getByText('Complement Token', { exact: true }).last().click();
  await page.getByText('Add trigger', { exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-select').first().click();
  await page.waitForTimeout(300);
  console.log(JSON.stringify({
    url: page.url(),
    buttons: await page.getByRole('button').allTextContents(),
    selects: await page.locator('select,[role="combobox"]').evaluateAll((elements) => elements.map((element) => ({
      tag: element.tagName,
      text: element.textContent?.trim(),
      value: (element).value
    }))),
    text: (await page.locator('body').innerText()).slice(-3_000)
  }));
} finally {
  await browser.close();
}
