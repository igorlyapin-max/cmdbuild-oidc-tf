import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState, statePath, writeState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  try {
    const appId = readState('bff_app_id');
    const clientId = readState('bff_client_id');
    console.log(JSON.stringify({ status: 'already_provisioned', app_id_hash: appId.slice(-8), client_id_hash: clientId.slice(-8) }));
    process.exit(0);
  } catch (error) {
    if (!String(error).includes('missing_zitadel_state')) throw error;
  }
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
  const applicationName = `${projectName}-bff`;
  const existing = page.locator('[data-e2e="app-card"]').filter({ hasText: applicationName });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await page.locator('[data-e2e="app-card-add"]').click();
    await page.locator('#cnsl-input-0').fill(applicationName);
    await page.locator('[data-e2e="continue-button-nameandtype"]').click();
    await page.locator('[data-e2e="continue-button-authmethod"]').click();
    await page.locator('#mat-mdc-slide-toggle-0-button').click({ force: true });
    await page.locator('#cnsl-input-1').fill('http://192.168.202.35:18086/oauth/callback');
    await page.locator('button').filter({ hasText: 'add' }).nth(0).click({ force: true });
    await page.locator('#cnsl-input-2').fill('http://192.168.202.35:18086');
    await page.locator('button').filter({ hasText: 'add' }).nth(1).click({ force: true });
    await page.locator('[data-e2e="continue-button-redirecturis"]').click();
    await page.locator('[data-e2e="create-button"]').click();
  }
  await page.waitForTimeout(800);
  const text = await page.locator('body').innerText();
  const clientId = text.match(/Client Id\s*\n\s*(\d+)/i)?.[1];
  if (!clientId) throw new Error('created_application_client_id_not_found');
  const appId = new URL(page.url()).pathname.match(/\/apps\/(\d+)/)?.[1];
  if (!appId) throw new Error('created_application_app_id_not_found');
  writeState('bff_app_id', appId);
  writeState('bff_client_id', clientId);
  console.log(JSON.stringify({ status: 'provisioned', app_id_hash: appId.slice(-8), client_id_hash: clientId.slice(-8), url: page.url(), application_present: text.includes(applicationName), state_path: statePath('bff_client_id') }));
} finally {
  await browser.close();
}
