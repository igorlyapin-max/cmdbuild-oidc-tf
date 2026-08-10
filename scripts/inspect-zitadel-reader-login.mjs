import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto('http://192.168.202.35:18086/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially('cmdbuild-oidc-tf-reader');
  await page.waitForTimeout(500);
  console.log(JSON.stringify({
    url: page.url(),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((input) => ({ name: input.name, type: input.type, value: input.value }))),
    continueDisabled: await page.getByRole('button', { name: 'Continue' }).isDisabled(),
    text: (await page.locator('body').innerText()).slice(0, 1000),
  }));
} finally {
  await browser.close();
}
