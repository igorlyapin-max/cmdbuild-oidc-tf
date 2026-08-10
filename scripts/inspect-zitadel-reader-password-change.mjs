import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const password = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_reader_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:18086/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially('cmdbuild-oidc-tf-reader');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(3_500);
  console.log(JSON.stringify({
    url: page.url(),
    labels: await page.locator('label').evaluateAll((elements) => elements.map((label) => ({ text: label.textContent?.trim(), for: label.htmlFor })).filter((label) => label.text)),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((input) => ({ name: input.name, type: input.type }))),
    buttons: await page.locator('button').evaluateAll((elements) => elements.map((button) => button.textContent?.trim()).filter(Boolean)),
    text: (await page.locator('body').innerText()).slice(0, 2000),
  }));
} finally {
  await browser.close();
}
