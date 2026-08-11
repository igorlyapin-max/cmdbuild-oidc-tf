import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const projectId = readState('project_id');
const applicationName = `${projectName}-cmdbuild`;
const redirectUri = process.env.CMDBUILD_OIDC_REDIRECT_URI ?? 'http://192.168.202.35:18090/cmdbuild/oauth2/callback';
const postLogoutUri = process.env.CMDBUILD_OIDC_POST_LOGOUT_URI ?? 'http://192.168.202.35:18090/cmdbuild/ui/';
const legacyRedirectUri = process.env.CMDBUILD_LEGACY_OIDC_REDIRECT_URI ?? 'http://127.0.0.1:18090/cmdbuild/oauth2/callback';
const legacyPostLogoutUri = process.env.CMDBUILD_LEGACY_OIDC_POST_LOGOUT_URI ?? 'http://127.0.0.1:18090/cmdbuild/ui/';
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();

async function inputForLabel(page, labelText) {
  const label = page.locator('label').filter({ hasText: labelText }).first();
  if (!(await label.count())) {
    await page.getByRole('button', { name: 'Redirect Settings' }).click();
    await page.waitForTimeout(250);
  }
  const inputId = await label.getAttribute('for');
  if (!inputId) throw new Error(`cmdbuild_redirect_input_not_found:${labelText}`);
  return page.locator(`#${inputId}`);
}

async function replaceUri(page, labelText, formIndex, previousUri, nextUri) {
  const desired = page.locator('.uri-line').filter({ hasText: nextUri });
  if (!(await desired.count())) {
    await (await inputForLabel(page, labelText)).fill(nextUri);
    await page.locator('form.redirect-uris-form').nth(formIndex).locator('button[type="submit"]').click({ force: true });
    await page.locator('.uri-line').filter({ hasText: nextUri }).waitFor({ state: 'visible' });
  }
  const existing = page.locator('.uri-line').filter({ hasText: previousUri });
  if (await existing.count()) await existing.locator('button').click({ force: true });
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
  await page.locator('[data-e2e="app-card"]').filter({ hasText: applicationName }).click();
  await page.getByRole('button', { name: 'Redirect Settings' }).click();
  await replaceUri(page, 'Redirect URIs', 0, legacyRedirectUri, redirectUri);
  await replaceUri(page, 'Post Logout URIs', 1, legacyPostLogoutUri, postLogoutUri);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(600);
  await page.goto(`http://192.168.202.35:8084/ui/console/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-e2e="app-card"]').filter({ hasText: applicationName }).click();
  await page.getByRole('button', { name: 'Redirect Settings' }).click();
  const redirectConfigured = await page.locator('.uri-line').filter({ hasText: redirectUri }).count() === 1;
  const postLogoutConfigured = await page.locator('.uri-line').filter({ hasText: postLogoutUri }).count() === 1;
  const legacyRedirectPresent = await page.locator('.uri-line').filter({ hasText: legacyRedirectUri }).count() > 0;
  const legacyPostLogoutPresent = await page.locator('.uri-line').filter({ hasText: legacyPostLogoutUri }).count() > 0;
  if (!redirectConfigured || !postLogoutConfigured || legacyRedirectPresent || legacyPostLogoutPresent) {
    throw new Error(`cmdbuild_redirect_settings_not_applied:${JSON.stringify({ redirectConfigured, postLogoutConfigured, legacyRedirectPresent, legacyPostLogoutPresent })}`);
  }
  console.log(JSON.stringify({ status: 'configured', redirect_uri: redirectUri, post_logout_uri: postLogoutUri }));
} finally {
  await browser.close();
}
