import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readState } from './zitadel-cmdbuild-oidc-tf-state.mjs';

const actionName = 'cmdbuild_oidc_tf_flat_groups';
const groupClaim = 'cmdbuild_oidc_tf_groups';
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

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  const loginName = page.locator('input[name="loginName"]:visible');
  if (await loginName.count()) {
    await loginName.click();
    await loginName.pressSequentially('openwebui-admin@openwebui.192.168.202.35');
    await loginName.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    const password = page.locator('input[name="password"]:visible');
    await password.fill(readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim());
    await password.press('Tab');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(1_500);
  }
  await page.goto('http://192.168.202.35:8084/ui/console/actions', { waitUntil: 'domcontentloaded' });
  await page.getByText(actionName, { exact: true }).click();
  await page.locator('.CodeMirror').evaluate((element, value) => {
    element.CodeMirror.setValue(value);
  }, actionCode);
  await page.waitForFunction((claim) => {
    const value = document.querySelector('.CodeMirror')?.textContent ?? '';
    return value.includes(claim) && !value.includes('cmdbuild_username');
  }, groupClaim);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(500);
  console.log(JSON.stringify({ action: actionName, group_claim: groupClaim, project_id_hash: projectId.slice(-8), local_cmdbuild_mapping: 'OIDC sub', updated: true }));
} finally {
  await browser.close();
}
