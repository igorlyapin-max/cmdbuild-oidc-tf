import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const projectId = '385505066485809155';
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1400);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-e2e="app-card-add"]').click({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.locator('#cnsl-input-0').fill('cmdbuild-oidc-tf-bff');
  await page.locator('[data-e2e="continue-button-nameandtype"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-e2e="continue-button-authmethod"]').click();
  await page.waitForTimeout(300);
  await page.locator('#mat-mdc-slide-toggle-0-button').click({ force: true });
  await page.locator('#cnsl-input-1').fill('http://192.168.202.35:18086/oauth/callback');
  await page.locator('button').filter({ hasText: 'add' }).nth(0).click({ force: true });
  await page.locator('#cnsl-input-2').fill('http://192.168.202.35:18086');
  await page.locator('button').filter({ hasText: 'add' }).nth(1).click({ force: true });
  await page.locator('[data-e2e="continue-button-redirecturis"]').click();
  await page.waitForTimeout(500);
  console.log(JSON.stringify({
    url: page.url(),
    labels: await page.locator('label').evaluateAll((elements) => elements.map((label) => ({ text: label.textContent?.trim(), for: label.htmlFor })).filter((label) => label.text)),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((input) => ({ id: input.id, type: input.type, value: input.value, checked: input.checked }))),
    uriFields: await page.locator('#cnsl-input-1, #cnsl-input-2').evaluateAll((elements) => elements.map((input) => ({
      id: input.id,
      parent: input.parentElement?.parentElement?.outerHTML.slice(0, 1500),
    }))),
    buttons: await page.locator('button').evaluateAll((elements) => elements.map((button) => ({
      text: button.textContent?.trim(), id: button.id, type: button.type, outer: button.outerHTML.slice(0, 400),
    })).filter((button) => button.text)),
    newNodes: await page.locator('*').evaluateAll((elements) => elements
      .filter((element) => element.children.length === 0 && element.textContent?.trim() === 'New')
      .map((element) => ({ tag: element.tagName, className: element.className, parent: element.parentElement?.outerHTML.slice(0, 1000) }))),
    text: (await page.locator('body').innerText()).slice(0, 3200),
  }, null, 2));
} finally {
  await browser.close();
}
