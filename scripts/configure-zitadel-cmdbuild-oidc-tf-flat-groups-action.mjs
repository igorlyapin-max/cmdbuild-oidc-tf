import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const consoleUrl = 'http://192.168.202.35:8084/ui/console/actions';
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPasswordPath = '/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password';
const actionName = 'cmdbuild_oidc_tf_flat_groups';
const groupClaim = 'cmdbuild_oidc_tf_groups';
const complementTokenTriggers = ['Pre Userinfo creation', 'Pre access token creation'];
const projectId = readState('project_id');
const actionCode = `function ${actionName}(ctx, api) {
  if (ctx.v1.user.grants === undefined || ctx.v1.user.grants.count === 0) {
    return;
  }
  const groups = [];
  ctx.v1.user.grants.grants.forEach((grant) => {
    if (grant.projectId !== '${projectId}') return;
    grant.roles.forEach((role) => {
      const mapped = role.match(/^cmdbuild_oidc_tf_(admin|editor|reader)$/)?.[1];
      if (mapped) groups.push(mapped);
    });
  });
  api.v1.claims.setClaim('${groupClaim}', [...new Set(groups)]);
}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox']
});

async function selectComplementTokenFlow(page) {
  const flowSelector = page.locator('mat-select').nth(1);
  if ((await flowSelector.innerText()).trim() === 'Complement Token') return;
  await flowSelector.click();
  await page.getByText('Complement Token', { exact: true }).last().click();
}

async function ensureTrigger(page, triggerName) {
  const existingTrigger = page.locator('cnsl-card.trigger').filter({ hasText: triggerName });
  if (await existingTrigger.count()) {
    const attachedAction = (await existingTrigger.locator('.flow-action-name').innerText()).trim();
    if (attachedAction === actionName) return 'already_exists';
    await existingTrigger.locator('button[color="warn"]').click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await existingTrigger.waitFor({ state: 'detached' });
  }
  await page.getByText('Add trigger', { exact: true }).click();
  const dialogSelectors = page.locator('.cdk-overlay-pane mat-select');
  await dialogSelectors.first().click();
  await page.getByText(triggerName, { exact: true }).last().click();
  await dialogSelectors.nth(1).click();
  await page.getByText(actionName, { exact: true }).last().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const updatedTrigger = page.locator('cnsl-card.trigger').filter({ hasText: triggerName });
  await updatedTrigger.getByText(actionName, { exact: true }).waitFor({ state: 'visible' });
  return 'created_or_replaced';
}

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(consoleUrl, { waitUntil: 'domcontentloaded' });
  let loginPage = false;
  // The console client renders its shell before redirecting an unauthenticated
  // browser. Do not treat that shell as an authenticated session.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pathname = new URL(page.url()).pathname;
    if (pathname.startsWith('/ui/v2/login/') && await page.locator('input[name="loginName"]').count()) {
      loginPage = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (loginPage) {
    const loginName = page.locator('input[name="loginName"]');
    await loginName.waitFor({ state: 'visible' });
    await loginName.click();
    await loginName.pressSequentially(adminUsername, { delay: 10 });
    await loginName.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[name="password"]').waitFor({ state: 'visible' });
    await page.locator('input[name="password"]').fill(readFileSync(adminPasswordPath, 'utf8').trim());
    await page.locator('input[name="password"]').press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/ui/console/'), { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.goto(consoleUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.getByText('New', { exact: true }).waitFor({ state: 'visible' });

  const existing = page.getByText(actionName, { exact: true });
  let actionStatus = 'already_exists';
  if (!(await existing.count())) {
    await page.getByText('New', { exact: true }).click();
    await page.locator('#cnsl-input-0').fill(actionName);
    const editor = page.locator('.CodeMirror').first();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(actionCode);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText(actionName, { exact: true }).waitFor({ state: 'visible' });
    actionStatus = 'created';
  }
  await selectComplementTokenFlow(page);
  const triggers = {};
  for (const trigger of complementTokenTriggers) triggers[trigger] = await ensureTrigger(page, trigger);
  console.log(JSON.stringify({ action: actionName, status: actionStatus, group_claim: groupClaim, project_id_hash: projectId.slice(-8), local_cmdbuild_mapping: 'OIDC sub', triggers }));
} finally {
  await browser.close();
}
