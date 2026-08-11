import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState, writeState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const applicationName = `${projectName}-cmdbuild`;
const redirectUri = process.env.CMDBUILD_OIDC_REDIRECT_URI ?? 'http://192.168.202.35:18090/cmdbuild/oauth2/callback';
const postLogoutUri = process.env.CMDBUILD_OIDC_POST_LOGOUT_URI ?? 'http://192.168.202.35:18090/cmdbuild/ui/';
const clientIdFile = 'secrets/cmdbuild_oidc_tf_client_id';
const clientSecretFile = 'secrets/cmdbuild_oidc_tf_client_secret';
const rotateClientSecret = process.env.CMDBUILD_ROTATE_CLIENT_SECRET === 'true';
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
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
  const clientId = (await page.locator('body').innerText()).match(/Client\s+ID\s*\n\s*(\d+)/i)?.[1];
  const secretAlreadyProvisioned = !rotateClientSecret && existsSync(clientSecretFile) && Boolean(readFileSync(clientSecretFile, 'utf8').trim());
  let text = await page.locator('body').innerText();
  let clientSecret = secretAlreadyProvisioned ? undefined : text.match(/(?:client\s*secret|secret)\s*(?:\n|:)\s*([A-Za-z0-9._~-]{16,})/i)?.[1]
    ?? (await page.locator('input').evaluateAll((inputs) => inputs
      .map((input) => input.value)
      .find((value) => value.length >= 16 && !/^\d+$/.test(value))));
  if (!clientSecret && !secretAlreadyProvisioned) {
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
  if (!clientId) throw new Error('cmdbuild_client_id_not_found');
  if (secretAlreadyProvisioned) {
    let recordedClientId;
    try {
      recordedClientId = readState('cmdbuild_client_id');
    } catch (error) {
      if (!String(error).includes('missing_zitadel_state')) throw error;
    }
    if (recordedClientId !== clientId) {
      throw new Error('cmdbuild_client_identity_changed_or_unrecorded_set_CMDBUILD_ROTATE_CLIENT_SECRET=true');
    }
  }
  if (!clientSecret && !secretAlreadyProvisioned) throw new Error('cmdbuild_client_secret_not_found_after_create');
  writeFileSync(clientIdFile, `${clientId}\n`, { mode: 0o600 });
  if (clientSecret && !secretAlreadyProvisioned) writeFileSync(clientSecretFile, `${clientSecret}\n`, { mode: 0o600 });
  chmodSync(clientIdFile, 0o600);
  chmodSync(clientSecretFile, 0o600);
  writeState('cmdbuild_client_id', clientId);
  console.log(JSON.stringify({ status: rotateClientSecret ? 'secret_rotated_and_reconciled' : 'reconciled', client_id_hash: shortHash(clientId), redirect_uri: redirectUri }));
} finally {
  await browser.close();
}
