import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { statePath, userPrefix, writeState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const role = process.argv[2];
const roles = ['admin', 'editor', 'reader', 'unassigned', 'unmapped'];
if (!roles.includes(role)) throw new Error(`usage: create-zitadel-cmdbuild-oidc-tf-user.mjs <${roles.join('|')}>`);
const username = `${userPrefix}-${role}`;
const email = `${username}@openwebui.192.168.202.35`;
const firstName = 'cmdbuild-oidc-tf';
const lastName = role[0].toUpperCase() + role.slice(1);
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const passwordPath = `secrets/zitadel_cmdbuild_oidc_tf_${role}_password`;
const generatedPassword = !existsSync(passwordPath);
if (generatedPassword && !['unassigned', 'unmapped'].includes(role)) throw new Error(`missing_poc_password:${passwordPath}`);
const initialPassword = generatedPassword
  ? `${randomBytes(27).toString('base64url')}aA1!`
  : readFileSync(passwordPath, 'utf8').trim();
if (!initialPassword) throw new Error('POC initial password is empty');
if (generatedPassword) writeState(`${role}_password`, initialPassword);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(12_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1800);
  await page.goto('http://192.168.202.35:8084/ui/console/users', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const existing = page.getByText(username, { exact: true });
  if (await existing.count()) {
    await existing.first().click();
    await page.waitForTimeout(400);
    const existingUserId = new URL(page.url()).pathname.match(/\/users\/(\d+)/)?.[1];
    if (!existingUserId) throw new Error('existing_user_id_not_found');
    writeState(`${role}_user_id`, existingUserId);
    console.log(JSON.stringify({ role, status: 'already_exists', user_id_hash: existingUserId.slice(-8), state_path: statePath(`${role}_user_id`), generated_password: false }));
    process.exit(0);
  }
  await page.goto('http://192.168.202.35:8084/ui/console/users/create', { waitUntil: 'domcontentloaded' });
  await page.locator('#cnsl-input-0').fill(email, { force: true });
  await page.locator('#cnsl-input-5').fill(username, { force: true });
  await page.locator('#cnsl-input-1').fill(firstName, { force: true });
  await page.locator('#cnsl-input-2').fill(lastName, { force: true });
  await page.getByLabel('Email Verified').check({ force: true });
  await page.getByLabel('Set Initial Password').check({ force: true });
  await page.locator('#cnsl-input-6').fill(initialPassword, { force: true });
  await page.locator('#cnsl-input-7').fill(initialPassword, { force: true });
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(1400);
  await page.goto('http://192.168.202.35:8084/ui/console/users', { waitUntil: 'domcontentloaded' });
  await page.getByText(username, { exact: true }).first().click();
  await page.waitForTimeout(400);
  const userId = new URL(page.url()).pathname.match(/\/users\/(\d+)/)?.[1];
  if (!userId) throw new Error('created_user_id_not_found');
  writeState(`${role}_user_id`, userId);
  const body = await page.locator('body').innerText();
  console.log(JSON.stringify({
    role,
    url: page.url(),
    user_visible: body.includes(username),
    user_id_hash: userId.slice(-8),
    state_path: statePath(`${role}_user_id`),
    generated_password: generatedPassword
  }, null, 2));
} finally { await browser.close(); }
