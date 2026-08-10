import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const username = 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Projects', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByText('OpenWebUI', { exact: true }).last().click();
  await page.waitForTimeout(500);
  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    buttons: await page.locator('button').evaluateAll(elements => elements.map(button => button.textContent?.trim()).filter(Boolean).slice(0, 30)),
    links: await page.locator('a').evaluateAll(elements => elements.map(link => ({ text: link.textContent?.trim(), href: link.getAttribute('href') })).filter(link => link.text).slice(0, 40)),
    text: (await page.locator('body').innerText()).slice(0, 3500)
  }, null, 2));
} finally {
  await browser.close();
}
