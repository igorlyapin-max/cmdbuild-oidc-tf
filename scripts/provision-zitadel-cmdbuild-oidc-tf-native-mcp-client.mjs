import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { projectName, readState, statePath, writeState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const serverId = 'cmdbuild-oidc-tf-native-mcp';
const applicationName = `${projectName}-native-mcp`;
const redirectUri = `http://192.168.202.35:8083/oauth/clients/mcp:${serverId}/callback`;
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  try {
    const appId = readState('native_mcp_app_id');
    const clientId = readState('native_mcp_client_id');
    console.log(JSON.stringify({ status: 'already_provisioned', app_id_hash: appId.slice(-8), client_id_hash: clientId.slice(-8), redirect_uri: redirectUri }));
    process.exit(0);
  } catch (error) {
    if (!String(error).includes('missing_zitadel_state')) throw error;
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_200);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1_400);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const existing = page.locator('[data-e2e="app-card"]').filter({ hasText: applicationName });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await page.locator('[data-e2e="app-card-add"]').click();
    await page.locator('#cnsl-input-0').fill(applicationName);
    await page.locator('[data-e2e="continue-button-nameandtype"]').click();
    await page.locator('[data-e2e="continue-button-authmethod"]').click();
    const developmentMode = page.locator('#mat-mdc-slide-toggle-0-button');
    if (!(await developmentMode.isChecked())) await developmentMode.click({ force: true });
    await page.locator('#cnsl-input-1').fill(redirectUri);
    await page.locator('button').filter({ hasText: 'add' }).nth(0).click({ force: true });
    await page.locator('#cnsl-input-2').fill('http://192.168.202.35:8083');
    await page.locator('button').filter({ hasText: 'add' }).nth(1).click({ force: true });
    await page.locator('[data-e2e="continue-button-redirecturis"]').click();
    await page.locator('[data-e2e="create-button"]').click();
  }
  await page.waitForTimeout(800);
  const text = await page.locator('body').innerText();
  const clientId = text.match(/Client Id\s*\n\s*(\d+)/i)?.[1];
  const appId = new URL(page.url()).pathname.match(/\/apps\/(\d+)/)?.[1];
  if (!clientId || !appId) throw new Error('native_mcp_client_identifiers_not_found');
  writeState('native_mcp_app_id', appId);
  writeState('native_mcp_client_id', clientId);
  console.log(JSON.stringify({ status: 'provisioned', app_id_hash: appId.slice(-8), client_id_hash: clientId.slice(-8), redirect_uri: redirectUri, state_path: statePath('native_mcp_client_id') }));
} finally {
  await browser.close();
}
