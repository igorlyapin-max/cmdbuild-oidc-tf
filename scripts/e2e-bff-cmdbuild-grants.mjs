import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const bffUrl = process.env.BFF_E2E_URL ?? 'http://192.168.202.35:18086';
const readerUsername = process.env.BFF_READER_USERNAME ?? 'cmdbuild-oidc-tf-reader';
const editorUsername = process.env.BFF_EDITOR_USERNAME ?? 'cmdbuild-oidc-tf-editor';
const readerPasswordPath = process.env.BFF_READER_PASSWORD_FILE ?? 'secrets/zitadel_cmdbuild_oidc_tf_reader_password';
const editorPasswordPath = process.env.BFF_EDITOR_PASSWORD_FILE ?? 'secrets/zitadel_cmdbuild_oidc_tf_editor_password';
const attribute = process.env.BFF_POC_ATTRIBUTE ?? 'Description';
const readerSubject = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_reader_user_id', 'utf8').trim();
const editorSubject = readFileSync('secrets/zitadel_cmdbuild_oidc_tf_editor_user_id', 'utf8').trim();

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function cardAttribute(payload, name) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
  return data && typeof data === 'object' && typeof data[name] === 'string' ? data[name] : undefined;
}

function currentUsername(payload) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' ? payload.data : undefined;
  return data && typeof data.username === 'string' ? data.username : undefined;
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.text() };
  }, { method, path, body });
}

async function login(browser, username, passwordPath) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(`${bffUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  await page.locator('input[name="loginName"]').waitFor({ state: 'visible' });
  await page.locator('input[name="loginName"]').pressSequentially(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(readFileSync(passwordPath, 'utf8').trim());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(`${bffUrl}/`, { timeout: 20_000 });
  return { context, page };
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
let originalValue;
let editorPage;
let markerWritten = false;
try {
  const reader = await login(browser, readerUsername, readerPasswordPath);
  try {
    const [readerWhoami, readerCards, readerWrite, removedMutationRoute] = await Promise.all([
      api(reader.page, 'GET', '/api/cmdbuild/whoami'),
      api(reader.page, 'GET', '/api/cmdbuild/demo-cards?limit=1'),
      api(reader.page, 'PUT', '/api/cmdbuild/demo-card', { attribute, value: `reader-denied-${randomUUID()}` }),
      api(reader.page, 'GET', '/api/mcp/reader-write-check')
    ]);
    if (readerWhoami.status !== 200 || currentUsername(parseJson(readerWhoami.body)) !== readerSubject || readerCards.status !== 200 || readerWrite.status !== 403 || !readerWrite.body.includes('group_does_not_allow_write') || removedMutationRoute.status !== 404) {
      throw new Error(JSON.stringify({
        code: 'bff_reader_least_privilege_failed',
        whoami_status: readerWhoami.status,
        read_status: readerCards.status,
        write_status: readerWrite.status,
        write_denial_code_present: readerWrite.body.includes('group_does_not_allow_write'),
        mapped_subject_matches: currentUsername(parseJson(readerWhoami.body)) === readerSubject,
        removed_mutation_route_status: removedMutationRoute.status
      }));
    }
  } finally {
    await reader.context.close();
  }

  const editor = await login(browser, editorUsername, editorPasswordPath);
  editorPage = editor.page;
  const editorWhoami = await api(editor.page, 'GET', '/api/cmdbuild/whoami');
  const before = await api(editor.page, 'GET', '/api/cmdbuild/demo-card');
  originalValue = cardAttribute(parseJson(before.body), attribute);
  if (editorWhoami.status !== 200 || currentUsername(parseJson(editorWhoami.body)) !== editorSubject || before.status !== 200 || !originalValue) {
    throw new Error('bff_editor_precondition_failed');
  }
  const marker = `cmdbuild-oidc-tf-poc-${randomUUID()}`;
  const update = await api(editor.page, 'PUT', '/api/cmdbuild/demo-card', { attribute, value: marker });
  markerWritten = update.status === 200;
  const readBack = await api(editor.page, 'GET', '/api/cmdbuild/demo-card');
  if (!markerWritten || readBack.status !== 200 || cardAttribute(parseJson(readBack.body), attribute) !== marker) {
    throw new Error('bff_editor_write_readback_failed');
  }
  const restore = await api(editor.page, 'PUT', '/api/cmdbuild/demo-card', { attribute, value: originalValue });
  markerWritten = false;
  const restored = await api(editor.page, 'GET', '/api/cmdbuild/demo-card');
  if (restore.status !== 200 || restored.status !== 200 || cardAttribute(parseJson(restored.body), attribute) !== originalValue) {
    throw new Error('bff_editor_rollback_failed');
  }
  console.log(JSON.stringify({ status: 'passed', reader: { whoami: 200, read: 200, write: 403 }, editor: { whoami: 200, update: 200, restore: 200 } }));
  await editor.context.close();
} finally {
  if (markerWritten && editorPage && originalValue) {
    const restore = await api(editorPage, 'PUT', '/api/cmdbuild/demo-card', { attribute, value: originalValue });
    if (restore.status !== 200) process.exitCode = 3;
  }
  await browser.close();
}
