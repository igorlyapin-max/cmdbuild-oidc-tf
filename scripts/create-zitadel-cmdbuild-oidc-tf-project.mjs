import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { projectName, readState, statePath, writeState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const username = 'openwebui-admin@openwebui.192.168.202.35';
const password = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

function projectIdFromUrl(url) {
  return new URL(url).pathname.match(/\/projects\/(\d+)/)?.[1];
}

try {
  try {
    const projectId = readState('project_id');
    console.log(JSON.stringify({ status: 'already_provisioned', project: projectName, project_id_hash: projectId.slice(-8) }));
    process.exit(0);
  } catch (error) {
    if (!String(error).includes('missing_zitadel_state')) throw error;
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1_800);
  await page.goto('http://192.168.202.35:8084/ui/console/projects', { waitUntil: 'domcontentloaded' });
  await page.getByText('Create New Project', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('Create New Project', { exact: true }).click();
  await page.locator('#cnsl-input-0').fill(projectName, { force: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1_000);
  const projectId = projectIdFromUrl(page.url());
  if (!projectId) throw new Error('created_project_id_not_found');
  writeState('project_id', projectId);
  console.log(JSON.stringify({ status: 'created', project: projectName, project_id_hash: projectId.slice(-8), state_path: statePath('project_id') }));
} finally {
  await browser.close();
}
