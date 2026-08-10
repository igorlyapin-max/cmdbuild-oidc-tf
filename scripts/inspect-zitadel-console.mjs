import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox']
});

try {
  const page = await browser.newPage();
  await page.goto('http://192.168.202.35:8084/ui/console/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    inputs: await page.locator('input').evaluateAll(elements => elements.map(input => ({
      type: input.type,
      name: input.getAttribute('name'),
      autocomplete: input.getAttribute('autocomplete'),
      placeholder: input.getAttribute('placeholder')
    }))),
    buttons: await page.locator('button').evaluateAll(elements => elements.map(button => button.textContent?.trim()).filter(Boolean).slice(0, 20)),
    text: (await page.locator('body').innerText()).slice(0, 1500)
  }, null, 2));
} finally {
  await browser.close();
}
