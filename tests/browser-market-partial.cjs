const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = process.env.QA_ARTIFACT_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'cryptoscope-browser-qa');
fs.mkdirSync(root, { recursive: true });
(async () => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'assets/app.js', 'assets/styles.css'].includes(file)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' :
      file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const width of [360, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let partial = false, limited = false, calls = 0, researchCalls = 0;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-11-13T19:00:00Z') });
      const coin = (id, symbol, cap, price) => ({ id, symbol, name: id, market_cap: cap,
        current_price: price, total_volume: 10e6, price_change_percentage_24h: 2,
        last_updated: '2026-11-13T18:59:00Z' });
      const pages = [
        [coin('bitcoin', 'btc', 1e12, 100), coin('ethereum', 'eth', 5e11, 10)],
        [coin('alpha', 'alpha', 1e9, 1)], [coin('candidate', 'cand', 50e6, 0.1)],
        [coin('delta', 'delta', 30e6, 0.03)],
      ];
      Object.assign(pages[2][0], { fully_diluted_valuation: 200e6, circulating_supply: 50e6,
        total_supply: 75e6, max_supply: 100e6 });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (url.pathname.endsWith('/coins/markets')) {
          calls++;
          const n = Number(url.searchParams.get('page'));
          if (limited && n === 3) return route.fulfill({ status: 429, headers: { 'Retry-After': '999999999', 'Access-Control-Expose-Headers': 'Retry-After' }, body: '{}' });
          if (partial && n === 1) return route.fulfill({ status: 500, body: '{}' });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pages[n - 1]) });
        }
        if (url.pathname.includes('/coins/candidate')) researchCalls++;
        return route.abort();
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('5 монет'));
      await page.locator('#major button[data-favorite="bitcoin"]').click();
      partial = true;
      await page.clock.fastForward(60000);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('3/4'));
      assert.equal(await page.locator('#major tr[data-id="bitcoin"]').count(), 1);
      assert.equal(await page.locator('#major tr[data-id="ethereum"]').count(), 1);
      assert.match(await page.locator('#major tr[data-id="bitcoin"]').innerText(), /не обновлено/);
      assert.equal(await page.locator('#major button[data-favorite="bitcoin"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#dot').evaluate(el => el.classList.contains('ok')), false);
      const before = calls;
      await page.locator('#potentialRefresh').click();
      assert.equal(calls, before);
      assert.match(await page.locator('#potentialUpdated').innerText(), /3\/4/);
      await page.locator('#markets').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${root}/qa-${width}.png`, fullPage: false });
      const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(dimensions.document <= dimensions.viewport, JSON.stringify(dimensions));
      partial = false;
      await page.clock.fastForward(await page.evaluate(() => Math.max(0, Math.ceil(marketRetryAt - Date.now())) + 100));
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.getElementById('dot').classList.contains('ok'));
      assert.doesNotMatch(await page.locator('#potentialUpdated').innerText(), /неполн/);
      // Combined catalogue/research flow: retained supply, shared 429 cap, no click spam.
      limited = true;
      await page.clock.fastForward(60000);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('3/4'));
      const deadline = await page.evaluate(() => marketRetryAt);
      const remaining = await page.evaluate(() => marketRetryAt - Date.now());
      assert.ok(remaining <= 7200000 && remaining > 7195000, String(remaining));
      await page.locator('button[data-research="candidate"]').click();
      await page.waitForFunction(() => !document.getElementById('researchRefresh').disabled);
      await page.locator('#researchRefresh').click();
      await page.waitForFunction(() => !document.getElementById('researchRefresh').disabled);
      assert.equal(researchCalls, 0);
      const provenance = await page.evaluate(() => marketAssetNote(coins.find(c => c.id === 'candidate')));
      assert.ok((await page.locator('#fundamentalStatus').innerText()).includes(provenance));
      assert.match(await page.locator('#fundamentalContent').innerText(), /не обновлено/);
      assert.match(await page.locator('#fundamentalContent').innerText(), /200M/);
      assert.equal(await page.locator('#fundamentalContent strong').filter({ hasText: 'CAND' }).count(), 3);
      await page.screenshot({ path: `${root}/research-${width}.png`, fullPage: false });
      const researchDimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(researchDimensions.document <= researchDimensions.viewport, JSON.stringify(researchDimensions));
      const limitedCalls = calls;
      await page.clock.fastForward(deadline - await page.evaluate(() => Date.now()) - 5000);
      await page.locator('#potentialRefresh').click();
      assert.equal(calls, limitedCalls);
      limited = false;
      await page.clock.fastForward(6000);
      await page.waitForFunction(() => document.getElementById('dot').classList.contains('ok'));
      assert.equal(calls, limitedCalls + 4);
      // A new visit has no complete snapshot to retain: never claim a market-wide top.
      partial = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('3/4'));
      assert.equal(await page.locator('#major tr[data-id="bitcoin"]').count(), 0);
      assert.equal(await page.locator('#major tr[data-id="alpha"]').count(), 1);
      assert.match(await page.locator('#marketHint').innerText(), /загруженн/);
      assert.deepEqual(errors, []);
      results.push({ width, partialRetainsLeaders: true, favoritesRetained: true,
        clickBackoff: true, fullRecovery: true, researchRetainedSupply: true, sharedTwoHourCap: true, horizontalOverflow: false, pageErrors: errors });
      await page.close();
    }
    console.log(JSON.stringify({ fixtureBrowserChecks: results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
