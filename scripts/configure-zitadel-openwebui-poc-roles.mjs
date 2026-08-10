import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const consoleBaseUrl = 'http://192.168.202.35:8084/ui/console';
const projectId = '381721272255512578';
const projectName = 'OpenWebUI';
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPasswordPath = '/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password';
const roles = [
  ['cmdbuild_oidc_tf_admin', 'cmdbuild-oidc-tf Admin', 'cmdbuild-oidc-tf'],
  ['cmdbuild_oidc_tf_editor', 'cmdbuild-oidc-tf Editor', 'cmdbuild-oidc-tf'],
  ['cmdbuild_oidc_tf_reader', 'cmdbuild-oidc-tf Reader', 'cmdbuild-oidc-tf']
];
const assignments = [
  [readState('admin_user_id'), 'cmdbuild_oidc_tf_admin'],
  [readState('editor_user_id'), 'cmdbuild_oidc_tf_editor'],
  [readState('reader_user_id'), 'cmdbuild_oidc_tf_reader']
];

async function signIn(page) {
  await page.goto(`${consoleBaseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  const loginName = page.locator('input[name="loginName"]:visible');
  if (!(await loginName.count())) return;
  await loginName.click();
  await loginName.pressSequentially(adminUsername);
  await loginName.press('Tab');
  await page.getByRole('button', { name: 'Continue' }).click();
  const password = page.locator('input[name="password"]:visible');
  await password.waitFor({ state: 'visible' });
  await password.fill(readFileSync(adminPasswordPath, 'utf8').trim());
  await password.press('Tab');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1_500);
}

async function ensureProjectRoles(page) {
  await page.goto(`${consoleBaseUrl}/projects/${projectId}?id=roles`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Roles' }).waitFor({ state: 'visible' });
  const body = await page.locator('body').innerText();
  const missing = roles.filter(([key]) => !body.includes(key));
  if (!missing.length) return 'already_exists';
  await page.getByText('New', { exact: true }).click();
  for (let index = 0; index < missing.length; index += 1) {
    if (index > 0) await page.getByRole('button', { name: 'Add additional role' }).click();
    const [key, displayName, group] = missing[index];
    const offset = index * 3;
    await page.locator(`#cnsl-input-${offset}`).fill(key, { force: true });
    await page.locator(`#cnsl-input-${offset + 1}`).fill(displayName, { force: true });
    await page.locator(`#cnsl-input-${offset + 2}`).fill(group, { force: true });
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText(missing[0][0], { exact: true }).waitFor({ state: 'visible' });
  return 'created';
}

async function ensureRoleAssertion(page) {
  await page.goto(`${consoleBaseUrl}/projects/${projectId}?id=general`, { waitUntil: 'domcontentloaded' });
  const roleAssertion = page.getByLabel('Return user roles during authentication');
  if (await roleAssertion.isChecked()) return 'already_enabled';
  await roleAssertion.check({ force: true });
  await page.getByRole('button', { name: 'Save' }).click();
  return 'enabled';
}

async function ensureAssignment(page, userId, role) {
  await page.goto(`${consoleBaseUrl}/users/${userId}?id=roles`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Role Assignments' }).click();
  await page.getByText('New', { exact: true }).click();
  await page.locator('#cnsl-input-5').fill(projectName);
  await page.getByText(projectName, { exact: true }).last().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const roleCheckbox = page.locator('tr').filter({ hasText: role }).locator('input[type="checkbox"]');
  if (await roleCheckbox.isChecked()) {
    await page.getByRole('button', { name: 'Cancel' }).click();
    return 'already_exists';
  }
  await roleCheckbox.check({ force: true });
  await page.getByRole('button', { name: 'Save' }).click();
  return 'created';
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await signIn(page);
  const rolesStatus = await ensureProjectRoles(page);
  const roleAssertion = await ensureRoleAssertion(page);
  const assignmentStatus = {};
  for (const [userId, role] of assignments) assignmentStatus[role] = await ensureAssignment(page, userId, role);
  console.log(JSON.stringify({ project: projectName, roles: rolesStatus, roleAssertion, assignments: assignmentStatus }));
} finally {
  await browser.close();
}
