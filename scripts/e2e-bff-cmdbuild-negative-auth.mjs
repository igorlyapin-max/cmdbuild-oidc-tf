import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const scenario = process.argv[2];
if (!['unassigned', 'unmapped'].includes(scenario)) {
  throw new Error('usage: e2e-bff-cmdbuild-negative-auth.mjs <unassigned|unmapped>');
}

const bffUrl = process.env.BFF_E2E_URL ?? 'http://192.168.202.35:18086';
const username = `cmdbuild-oidc-tf-${scenario}`;
const password = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${scenario}_password`, 'utf8').trim();

const expected = scenario === 'unassigned'
  ? { status: 403, error: 'group_not_allowed' }
  : { status: 401, error: 'cmdbuild_rejected_forwarded_user_token' };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(`${bffUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_000);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  try {
    await page.waitForURL(`${bffUrl}/`, { timeout: 20_000 });
  } catch {
    const pageState = await page.evaluate(() => {
      const text = document.body.innerText;
      const index = text.search(/incorrect|invalid|failed|error/i);
      return {
        password_field_visible: Boolean(document.querySelector('input[name="password"]')),
        error_marker_present: index >= 0,
        error_context: index >= 0 ? text.slice(Math.max(0, index - 40), index + 160) : undefined,
        current_path: location.pathname
      };
    });
    throw new Error(JSON.stringify({ code: 'negative_auth_login_failed', scenario, ...pageState }));
  }
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/cmdbuild/whoami');
    const body = await response.json().catch(() => ({}));
    return { status: response.status, error: typeof body?.error === 'string' ? body.error : undefined };
  });
  if (result.status !== expected.status || result.error !== expected.error) {
    throw new Error(JSON.stringify({ code: 'negative_auth_contract_failed', scenario, status: result.status, error: result.error }));
  }
  console.log(JSON.stringify({ status: 'passed', scenario, whoami_status: result.status, cmdbuild_call: scenario === 'unmapped' ? 'rejected_no_local_mapping' : 'not_attempted' }));
  await context.close();
} finally {
  await browser.close();
}
