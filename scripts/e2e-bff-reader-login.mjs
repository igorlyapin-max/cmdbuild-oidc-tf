import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const username = 'cmdbuild-oidc-tf-reader';
const password = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_reader_password', 'utf8').trim();
const expectedSubject = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_reader_user_id', 'utf8').trim();
const bffUrl = 'http://192.168.202.35:18086';

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function currentUsername(payload) {
  const data = payload && typeof payload === 'object' ? payload.data : undefined;
  return data && typeof data === 'object' && typeof data.username === 'string' ? data.username : undefined;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`${bffUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(`${bffUrl}/`, { timeout: 15_000 });
  const cmdbuild = await page.goto(`${bffUrl}/api/cmdbuild/whoami`, { waitUntil: 'domcontentloaded' });
  const cmdbuildResponse = await page.locator('body').innerText();
  const removedProbe = await page.goto(`${bffUrl}/api/mcp/reader-write-check`, { waitUntil: 'domcontentloaded' });
  const mappedUsername = currentUsername(parseJson(cmdbuildResponse));
  const directUserApiPass = cmdbuild?.status() === 200 && mappedUsername === expectedSubject;
  const legacyMutationRouteRemoved = removedProbe?.status() === 404;
  console.log(JSON.stringify({
    status: directUserApiPass && legacyMutationRouteRemoved ? 'direct_user_api_pass' : 'direct_user_api_not_proven',
    login: 'ok',
    cmdbuildStatus: cmdbuild?.status(),
    mappedUsername,
    expectedMappedUsername: expectedSubject,
    directUserApiPass,
    legacyMutationRouteStatus: removedProbe?.status(),
    legacyMutationRouteRemoved
  }));
  if (!directUserApiPass || !legacyMutationRouteRemoved) process.exitCode = 2;
} finally {
  await browser.close();
}
