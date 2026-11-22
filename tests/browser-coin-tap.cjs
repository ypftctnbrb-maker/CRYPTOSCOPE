const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const site = path.join(__dirname, '..');
const files = new Set(['index.html', 'assets/app.js', 'assets/styles.css',
  'assets/lightweight-charts-4.2.3.js', 'assets/config.js', 'assets/referrals.js',
  'assets/referrals.css', 'assets/referral-market.js']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const artifactDir = process.env.QA_ARTIFACT_DIR || '/tmp/cryptoscope-coin-tap';
const market = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap: 1e12 },
  { id: 'zcash', symbol: 'zec', name: 'Zcash', market_cap: 50e6 },
].map(coin => ({ ...coin, current_price: 100, total_volume: 10e6,
  price_change_percentage_24h: 1, last_updated: '2026-11-13T18:59:00Z' }));
const candles = [[1794596400000, '100', '105', '99', '104', '12']];

async function snapshot(page) {
  return page.evaluate(() => ({
    hidden: document.querySelector('#coinDetail').hidden,
    title: document.querySelector('#detailName').textContent,
    chart: document.querySelector('#chartStatus').textContent,
    search: document.querySelector('#search').value,
  }));
}

async function checkTap(browser, origin, width, target) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true });
  let evidence = { width, target };
  try {
    await page.routeWebSocket(/.*/, socket => socket.close());
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.pathname === '/api/v3/coins/markets') {
        return route.fulfill({ json: url.searchParams.get('page') === '1' ? market : [] });
      }
      if (url.pathname === '/api/v3/klines' && ['BTCUSDT', 'ZECUSDT'].includes(url.searchParams.get('symbol'))) {
        return route.fulfill({ json: candles });
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#chartStatus').textContent.startsWith('Binance Spot · BTCUSDT'), {}, { timeout: 5000 });
    const row = page.locator('#small tr[data-id="zcash"]');
    const surface = target === 'center' ? row : row.getByText(/^Zcash\b/);
    await surface.scrollIntoViewIfNeeded();
    const box = target === 'center' ? await surface.boundingBox() : await surface.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y, width, height };
    });
    assert.ok(box, 'tap surface must be visible');
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const hit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element && {
        tag: element.tagName, text: element.textContent.trim(),
        coin: element.closest('tr')?.dataset.id,
        button: element.closest('button')?.outerHTML,
      };
    }, { x, y });
    evidence = { ...evidence, x, y, hit, before: await snapshot(page) };
    assert.equal(evidence.before.title, 'Bitcoin (BTC)');
    assert.equal(hit?.coin, 'zcash', 'tap coordinates must hit the fixture row');
    await page.touchscreen.tap(x, y);
    await page.waitForFunction(() => document.querySelector('#chartStatus').textContent.startsWith('Binance Spot · ZECUSDT'), {}, { timeout: 5000 });
    const after = await snapshot(page);
    assert.equal(after.hidden, false);
    assert.equal(after.title, 'Zcash (ZEC)');
    console.log(JSON.stringify({ ...evidence, after }));
  } catch (error) {
    await fs.mkdir(artifactDir, { recursive: true });
    const screenshot = path.join(artifactDir, `tap-${width}-${target}.png`);
    await page.screenshot({ path: screenshot });
    console.error(JSON.stringify({ ...evidence, after: await snapshot(page), screenshot }));
    throw error;
  } finally {
    await page.close();
  }
}

async function main() {
  const server = http.createServer(async (request, response) => {
    const file = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!files.has(file)) return response.writeHead(404).end();
    try {
      const body = await fs.readFile(path.join(site, file));
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] }).end(body);
    } catch {
      response.writeHead(500).end();
    }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const width of [320, 390, 430]) {
      for (const target of ['center', 'name']) await checkTap(browser, origin, width, target);
    }
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
