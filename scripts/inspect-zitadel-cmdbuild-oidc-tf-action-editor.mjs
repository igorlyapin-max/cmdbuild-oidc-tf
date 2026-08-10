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
  await page.goto('http://192.168.202.35:8084/ui/console/actions', { waitUntil: 'domcontentloaded' });
  await page.getByText('cmdbuild_oidc_tf_flat_groups', { exact: true }).click();
  await page.waitForTimeout(400);
  console.log(JSON.stringify({
    url: page.url(),
    buttons: await page.getByRole('button').allTextContents(),
    codeMirrors: await page.locator('.CodeMirror').evaluateAll((elements) => elements.map((element) => ({
      className: element.className,
      text: element.textContent?.slice(0, 160),
      html: element.outerHTML.slice(0, 1_200)
    }))),
    inputs: await page.locator('input,textarea').evaluateAll((elements) => elements.map((element) => ({
      tag: element.tagName,
      id: element.id,
      name: element.name,
      type: element.type,
      visible: Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    }))),
    text: (await page.locator('body').innerText()).slice(-2_000)
  }));
} finally {
  await browser.close();
}
