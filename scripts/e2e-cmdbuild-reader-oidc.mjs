import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const role = process.argv[2] ?? 'reader';
if (!['reader', 'editor'].includes(role)) throw new Error('usage: e2e-cmdbuild-reader-oidc.mjs [reader|editor]');
const loginUsername = `cmdbuild-oidc-tf-${role}`;
const password = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_password`, 'utf8').trim();
const expectedSubject = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_user_id`, 'utf8').trim();
const expectedClientId = readFileSync('secrets/cmdbuild_oidc_tf_client_id', 'utf8').trim();
const cmdbuildUrl = process.env.CMDBUILD_UI_URL ?? 'http://192.168.202.35:18090/cmdbuild/ui/';
const expectedHost = new URL(cmdbuildUrl).host;
const expectedHostname = new URL(cmdbuildUrl).hostname;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const observedRest = [];
  const oauthTrace = [];
  const recordRest = (request, response) => {
    const url = new URL(request.url());
    if (url.hostname !== expectedHostname || !url.pathname.includes('/cmdbuild/services/rest/')) return;
    observedRest.push({
      method: request.method(),
      path: url.pathname.replace(/^\/cmdbuild\/services\/rest\/v[34]\//, ''),
      status: response.status(),
      cmdbuild_authorization_header: Object.keys(request.headers()).some((name) => name.toLowerCase() === 'cmdbuild-authorization')
    });
  };
  page.on('response', (response) => recordRest(response.request(), response));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname !== expectedHostname && url.hostname !== '192.168.202.35') return;
    if (!/\/(cmdbuild-oidc\/auth|oauth2\/callback|ui\/v2\/login\/(login|loginname|password|accounts))$/.test(url.pathname)) return;
    oauthTrace.push({ host: url.host, path: url.pathname, status: response.status() });
  });
  page.setDefaultTimeout(20_000);
  const initial = await page.goto(cmdbuildUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  let loginName = page.locator('input[name="loginName"]:visible');
  if (!await loginName.count()) {
    const oauthLink = page.getByText('Login with Oauth2', { exact: true });
    if (await oauthLink.count()) {
      await oauthLink.click();
      await page.waitForTimeout(500);
      loginName = page.locator('input[name="loginName"]:visible');
    }
  }
  if (!await loginName.count()) {
    const current = new URL(page.url());
    console.log(JSON.stringify({
      status: 'oauth_login_not_reached',
      initial_status: initial?.status(),
      url: current.pathname,
      oauth_query_keys: [...current.searchParams.keys()].sort(),
      client_id_matches_config: current.searchParams.get('client_id') === expectedClientId,
      redirect_uri_matches_config: current.searchParams.get('redirect_uri') === cmdbuildUrl.replace(/ui\/$/, 'oauth2/callback'),
      buttons: await page.locator('button').evaluateAll((elements) => elements.map((element) => element.textContent?.trim()).filter(Boolean)),
      links: await page.locator('a').evaluateAll((elements) => elements.map((element) => ({ text: element.textContent?.trim(), href: element.getAttribute('href') })).filter((item) => item.text || item.href)),
      inputs: await page.locator('input').evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('name'), type: element.type, value: element.value }))),
      text: (await page.locator('body').innerText()).slice(0, 1200)
    }));
    process.exitCode = 2;
  } else {
    await loginName.pressSequentially(loginUsername);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[name="password"]:visible').fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(1_200);
    const response = await page.goto(cmdbuildUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    const currentUrl = new URL(page.url());
    const body = await page.locator('body').innerText();
    const currentSession = await page.evaluate(async () => {
      const response = await fetch('/cmdbuild/services/rest/v4/sessions/current', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : {};
      return {
        status: response.status,
        username: data && typeof data === 'object' && 'username' in data ? data.username : undefined,
        role: data && typeof data === 'object' && 'role' in data ? data.role : undefined,
        available_role_count: data && typeof data === 'object' && Array.isArray(data.availableRoles) ? data.availableRoles.length : 0,
        data_keys: data && typeof data === 'object' ? Object.keys(data).sort() : []
      };
    });
    const storage = await page.evaluate(() => ({
      local_storage_keys: Object.keys(localStorage).sort(),
      session_storage_keys: Object.keys(sessionStorage).sort(),
      visible_cookie_names: document.cookie.split(';').map((item) => item.trim().split('=')[0]).filter(Boolean).sort()
    }));
    const http_cookie_names = (await page.context().cookies()).map((cookie) => cookie.name).sort();
    const distinctRest = observedRest.filter((item, index, items) => index === items.findIndex((candidate) => (
      candidate.method === item.method
      && candidate.path === item.path
      && candidate.status === item.status
      && candidate.cmdbuild_authorization_header === item.cmdbuild_authorization_header
    )));
    const authenticated = currentUrl.host === expectedHost
      && response?.status() === 200
      && !/login|error/i.test(body)
      && currentSession.status === 200
      && currentSession.username === expectedSubject;
    console.log(JSON.stringify({
      status: authenticated ? 'cmdbuild_ui_authenticated' : 'cmdbuild_ui_not_authenticated',
      response_status: response?.status(),
      final_host: currentUrl.host,
      final_path: currentUrl.pathname,
      has_login_name_form: await page.locator('input[name="loginName"]:visible').count() > 0,
      has_error_marker: /error/i.test(body),
      current_session_status: currentSession.status,
      expected_user_mapped: currentSession.username === expectedSubject,
      role,
      cmdbuild_role: currentSession.role ?? 'not_reported',
      available_role_count: currentSession.available_role_count,
      current_session_data_keys: currentSession.data_keys,
      session_request_statuses: distinctRest.filter((item) => item.path === 'sessions/current').map((item) => item.status),
      oauth_trace: oauthTrace.filter((item, index, items) => index === items.findIndex((candidate) => (
        candidate.host === item.host && candidate.path === item.path && candidate.status === item.status
      ))),
      cmdbuild_session_cookie_present: http_cookie_names.includes('CMDBuild-Authorization'),
      browser_storage_used: storage.local_storage_keys.length > 0 || storage.session_storage_keys.length > 0,
    }));
    if (!authenticated) process.exitCode = 2;
  }
} finally {
  await browser.close();
}
