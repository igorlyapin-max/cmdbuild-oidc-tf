import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const username = 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(12_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1800);
  await page.getByText('Users', { exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.getByText('New', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByLabel('Email Verified').check({ force: true });
  await page.getByLabel('Set Initial Password').check({ force: true });
  await page.waitForTimeout(300);
  console.log(JSON.stringify({
    url: page.url(),
    labels: await page.locator('label').evaluateAll(elements => elements.map(label => ({ text: label.textContent?.trim(), for: label.getAttribute('for') })).filter(label => label.text)),
    inputs: await page.locator('input').evaluateAll(elements => elements.map(input => ({ id: input.id, type: input.type, name: input.getAttribute('name'), autocomplete: input.getAttribute('autocomplete'), checked: input.checked }))),
    buttons: await page.locator('button').evaluateAll(elements => elements.map(button => button.textContent?.trim()).filter(Boolean).slice(0, 30)),
    text: (await page.locator('body').innerText()).slice(0, 2500)
  }, null, 2));
} finally { await browser.close(); }
