import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const targetRole = process.argv[2];
if (targetRole && !['admin', 'editor', 'reader'].includes(targetRole)) {
  throw new Error('usage: inspect-zitadel-cmdbuild-oidc-tf-users.mjs [admin|editor|reader]');
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1600);
  await page.goto('http://192.168.202.35:8084/ui/console/users', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  if (targetRole) {
    await page.getByText(`cmdbuild-oidc-tf ${targetRole[0].toUpperCase()}${targetRole.slice(1)}`, { exact: true }).click();
    await page.waitForTimeout(400);
    console.log(JSON.stringify({ role: targetRole, url: page.url() }));
  }
  const body = await page.locator('body').innerText();
  console.log(JSON.stringify({
    url: page.url(),
    users: ['cmdbuild-oidc-tf-admin', 'cmdbuild-oidc-tf-editor', 'cmdbuild-oidc-tf-reader'].filter((username) => body.includes(username)),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((input) => ({
      id: input.id,
      placeholder: input.getAttribute('placeholder'),
      type: input.type,
    }))),
    links: await page.locator('a').evaluateAll((elements) => elements.map((link) => ({
      text: link.textContent?.trim(),
      href: link.getAttribute('href'),
    })).filter((link) => link.text?.startsWith('cmdbuild-oidc-tf-'))),
    text: body.slice(0, 3000),
  }));
} finally {
  await browser.close();
}
