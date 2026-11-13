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
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  try {
    for (const width of [360, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let partial = false, calls = 0;
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
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (url.pathname.endsWith('/coins/markets')) {
          calls++;
          const n = Number(url.searchParams.get('page'));
          if (partial && n === 1) return route.fulfill({ status: 500, body: '{}' });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pages[n - 1]) });
        }
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
      await page.clock.fastForward(30000);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.getElementById('dot').classList.contains('ok'));
      assert.doesNotMatch(await page.locator('#potentialUpdated').innerText(), /неполн/);
      // A new visit has no complete snapshot to retain: never claim a market-wide top.
      partial = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('3/4'));
      assert.equal(await page.locator('#major tr[data-id="bitcoin"]').count(), 0);
      assert.equal(await page.locator('#major tr[data-id="alpha"]').count(), 1);
      assert.match(await page.locator('#marketHint').innerText(), /загруженн/);
      assert.deepEqual(errors, []);
      results.push({ width, partialRetainsLeaders: true, favoritesRetained: true,
        clickBackoff: true, fullRecovery: true, horizontalOverflow: false, pageErrors: errors });
      await page.close();
    }
    console.log(JSON.stringify({ fixtureBrowserChecks: results }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
