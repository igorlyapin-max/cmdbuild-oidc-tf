import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const role = process.argv[2] ?? 'reader';
if (!['admin', 'editor', 'reader'].includes(role)) {
  throw new Error('usage: inspect-zitadel-user-security.mjs [admin|editor|reader]');
}

const userId = readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_user_id`, 'utf8').trim();
const adminUsername = 'openwebui-admin@openwebui.192.168.202.35';
const adminPassword = readFileSync('/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

function jwtCandidates(value) {
  if (typeof value !== 'string') return [];
  return value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
}

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="loginName"]').pressSequentially(adminUsername, { delay: 10 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1800);
  const apiRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === 'http://192.168.202.35:8084' && !url.pathname.startsWith('/ui/')) {
      apiRequests.push({
        method: request.method(),
        path: url.pathname,
        hasAuthorization: Boolean(request.headers().authorization),
      });
    }
  });
  await page.goto(`http://192.168.202.35:8084/ui/console/users/${userId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Password and Security' }).click();
  await page.getByRole('button', { name: /^Actions/ }).click();
  await page.waitForTimeout(200);
  const browserStorage = await page.evaluate(() => [
    ...Object.values(localStorage),
    ...Object.values(sessionStorage),
  ]);
  const tokens = [...new Set(browserStorage.flatMap(jwtCandidates))];
  const managementUserStatuses = await Promise.all(tokens.map(async (token) => page.evaluate(async ({ id, token }) => {
    const response = await fetch(`/management/v1/users/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status;
  }, { id: userId, token })));
  console.log(JSON.stringify({
    role,
    managementTokenCandidates: tokens.length,
    managementUserStatuses,
    apiRequests: [...new Map(apiRequests.map((request) => [`${request.method}:${request.path}:${request.hasAuthorization}`, request])).values()],
    menuItems: await page.locator('[role="menuitem"]').allTextContents(),
    buttons: await page.locator('.cdk-overlay-pane button').allTextContents(),
    actionButtons: await page.locator('button').evaluateAll((elements) => elements.map((button) => ({
      text: button.textContent?.trim(),
      ariaLabel: button.getAttribute('aria-label'),
      cardActions: button.hasAttribute('card-actions'),
      disabled: button.disabled,
    })).filter((button) => button.text || button.ariaLabel || button.cardActions)),
    passwordMask: await page.locator('text=*********').evaluateAll((elements) => elements.map((element) => ({
      tag: element.tagName,
      className: element.className,
      role: element.getAttribute('role'),
      parentTag: element.parentElement?.tagName,
      parentClassName: element.parentElement?.className,
      parentRole: element.parentElement?.getAttribute('role'),
    }))),
    text: (await page.locator('body').innerText()).slice(-1200),
  }));
} finally {
  await browser.close();
}
