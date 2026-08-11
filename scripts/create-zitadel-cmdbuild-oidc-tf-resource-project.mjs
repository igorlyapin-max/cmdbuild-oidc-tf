import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState, statePath, writeState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const resourceProjectName = `${projectName}-cmdbuild-resource`;
const username = 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();

function projectIdFromUrl(url) {
  return new URL(url).pathname.match(/\/projects\/(\d+)/)?.[1];
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  try {
    const projectId = readState('resource_project_id');
    console.log(JSON.stringify({ status: 'already_provisioned', project: resourceProjectName, project_id_hash: projectId.slice(-8) }));
    process.exit(0);
  } catch (error) {
    if (!String(error).includes('missing_zitadel_state')) throw error;
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/projects', { waitUntil: 'domcontentloaded' });
  const loginName = page.locator('input[name="loginName"]:visible');
  if (await loginName.count()) {
    await loginName.pressSequentially(username);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/ui/console/'), { timeout: 20_000 });
    await page.goto('http://192.168.202.35:8084/ui/console/projects', { waitUntil: 'domcontentloaded' });
  }
  const existing = page.getByText(resourceProjectName, { exact: true });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await page.getByText('Create New Project', { exact: true }).click();
    await page.locator('#cnsl-input-0').fill(resourceProjectName, { force: true });
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  const projectId = projectIdFromUrl(page.url());
  if (!projectId) throw new Error('resource_project_id_not_found');
  writeState('resource_project_id', projectId);
  console.log(JSON.stringify({ status: 'provisioned', project: resourceProjectName, project_id_hash: projectId.slice(-8), state_path: statePath('resource_project_id') }));
} finally {
  await browser.close();
}
