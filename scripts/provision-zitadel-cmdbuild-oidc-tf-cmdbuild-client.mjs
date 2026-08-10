import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const applicationName = `${projectName}-cmdbuild`;
const redirectUri = process.env.CMDBUILD_OIDC_REDIRECT_URI ?? 'http://127.0.0.1:18090/cmdbuild/oauth2/callback';
const postLogoutUri = 'http://127.0.0.1:18090/cmdbuild/ui/';
const clientIdFile = 'secrets/cmdbuild_oidc_tf_client_id';
const clientSecretFile = 'secrets/cmdbuild_oidc_tf_client_secret';
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

if (existsSync(clientIdFile) && existsSync(clientSecretFile)
  && readFileSync(clientIdFile, 'utf8').trim() && readFileSync(clientSecretFile, 'utf8').trim()) {
  console.log(JSON.stringify({ status: 'already_provisioned', client_id_hash: shortHash(readFileSync(clientIdFile, 'utf8').trim()) }));
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
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
  if ((await page.locator('body').innerText()).includes(applicationName)) {
    await page.locator('[data-e2e="app-card"]').filter({ hasText: applicationName }).click();
  } else {
    await page.locator('[data-e2e="app-card-add"]').click();
    await page.locator('#cnsl-input-0').fill(applicationName);
    await page.locator('[data-e2e="continue-button-nameandtype"]').click();
    await page.locator('label[for="CODE"]').click({ force: true });
    await page.locator('[data-e2e="continue-button-authmethod"]').click();
    const developmentMode = page.locator('#mat-mdc-slide-toggle-0-button');
    if (!(await developmentMode.isChecked())) await developmentMode.click({ force: true });
    await page.locator('#cnsl-input-1').fill(redirectUri);
    await page.locator('button').filter({ hasText: 'add' }).nth(0).click({ force: true });
    await page.locator('#cnsl-input-2').fill(postLogoutUri);
    await page.locator('button').filter({ hasText: 'add' }).nth(1).click({ force: true });
    await page.locator('[data-e2e="continue-button-redirecturis"]').click();
    await page.getByRole('button', { name: 'Create' }).click();
  }
  await page.waitForTimeout(700);
  const clientId = await page.locator('#cnsl-input-0').inputValue();
  let text = await page.locator('body').innerText();
  let clientSecret = text.match(/(?:client\s*secret|secret)\s*(?:\n|:)\s*([A-Za-z0-9._~-]{16,})/i)?.[1]
    ?? (await page.locator('input').evaluateAll((inputs) => inputs
      .map((input) => input.value)
      .find((value) => value.length >= 16 && !/^\d+$/.test(value))));
  if (!clientSecret) {
    await page.getByRole('button', { name: /Actions/ }).click();
    await page.getByRole('menuitem', { name: 'Regenerate Client Secret' }).click();
    await page.waitForTimeout(250);
    const confirm = page.getByRole('button', { name: /^Regenerate$/ });
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(400);
    text = await page.locator('body').innerText();
    clientSecret = text.match(/(?:client\s*secret|secret)\s*(?:\n|:)\s*([A-Za-z0-9._~-]{16,})/i)?.[1]
      ?? (await page.locator('input').evaluateAll((inputs) => inputs
        .map((input) => input.value)
        .find((value) => value.length >= 16 && !/^\d+$/.test(value))));
  }
  if (!clientId || !clientSecret) throw new Error('cmdbuild_client_credentials_not_found_after_create');
  writeFileSync(clientIdFile, `${clientId}\n`, { mode: 0o600 });
  writeFileSync(clientSecretFile, `${clientSecret}\n`, { mode: 0o600 });
  chmodSync(clientIdFile, 0o600);
  chmodSync(clientSecretFile, 0o600);
  console.log(JSON.stringify({ status: 'created', client_id_hash: shortHash(clientId), redirect_uri: redirectUri }));
} finally {
  await browser.close();
}
