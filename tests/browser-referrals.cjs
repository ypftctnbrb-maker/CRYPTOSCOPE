'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { REF_BINGX } = require('../assets/config.js');
const { RISK } = require('../assets/referrals.js');
const { preparePublic } = require('../scripts/prepare-public.cjs');
const { renderDailyReport } = require('../scripts/render-daily-report.cjs');
(async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-referral-browser-'));
  preparePublic(process.cwd(), output);
  fs.mkdirSync(path.join(output, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(output, 'reports/2026-11-17.html'),
    renderDailyReport({ date: '2026-11-17', text: 'ТЕСТОВЫЙ ОТЧЁТ. Эти данные не публикуются.' }));
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(output, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(output + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const width of [360, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (url.href === REF_BINGX) return route.fulfill({ contentType: 'text/html', body: '<p>Test-only invitation</p>' });
        if (url.pathname.endsWith('/coins/markets')) {
          const coin = (id, symbol, cap) => ({ id, name: id, symbol, market_cap: cap, current_price: 1,
            total_volume: 10e6, price_change_percentage_24h: 1, last_updated: new Date().toISOString() });
          const pages = [[coin('bitcoin', 'btc', 1e12), coin('ethereum', 'eth', 5e11)],
            [coin('candidate', 'cand', 50e6)], [coin('delta', 'delta', 40e6)], [coin('alpha', 'alpha', 1e9)]];
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(pages[Number(url.searchParams.get('page')) - 1]) });
        }
        return route.abort();
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const click = async placement => {
        const before = await page.evaluate(p => CSReferral.createTracker(localStorage).counts()[p] || 0, placement);
        const link = page.locator('a[data-referral="bingx"][data-placement="' + placement + '"]').first();
        const popup = page.waitForEvent('popup');
        await link.click();
        await (await popup).close();
        assert.equal(await page.evaluate(p => CSReferral.createTracker(localStorage).counts()[p], placement), before + 1);
      };
      const linksAreSafe = async () => {
        for (const link of await page.locator('a[data-referral="bingx"]').all()) {
          assert.equal(await link.getAttribute('href'), REF_BINGX);
          assert.equal(await link.getAttribute('target'), '_blank');
          assert.equal(await link.getAttribute('rel'), 'sponsored noopener noreferrer');
          const text = await link.evaluate(el => el.closest('.referral-block').textContent);
          assert.ok(text.includes('Реферальная ссылка') && text.includes(RISK));
        }
      };
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('#major .referral-trade-cell a').length >= 2);
      await linksAreSafe();
      const tableLink = page.locator('#major .referral-trade-cell a').first();
      assert.equal(await tableLink.isVisible(), true, 'trade column must remain visible on mobile');
      const coinName = await page.locator('#detailName').innerText();
      await click('table');
      assert.equal(await page.locator('#detailName').innerText(), coinName, 'trade click must not select another row');
      await click('coin'); await click('header'); await click('footer');
      if (width <= 700) {
        const bounds = await page.evaluate(() => ({ main: document.querySelector('main').getBoundingClientRect().bottom,
          dock: document.getElementById('bingxMobile').getBoundingClientRect().top }));
        assert.ok(bounds.main <= bounds.dock + 1, 'mobile dock must not overlap scrollable content: ' + JSON.stringify(bounds));
        await click('mobile');
        const count = await page.evaluate(() => CSReferral.createTracker(localStorage).counts());
        await page.locator('#bingxMobileClose').click();
        assert.equal(await page.locator('#bingxMobile').isVisible(), false);
        assert.deepEqual(await page.evaluate(() => CSReferral.createTracker(localStorage).counts()), count);
        await page.reload();
        assert.equal(await page.locator('#bingxMobile').isVisible(), false, 'dismissal persists for the session');
      }
      for (const file of ['about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html', 'reports/2026-11-17.html']) {
        await page.goto(origin + '/' + file, { waitUntil: 'load' });
        await linksAreSafe();
        assert.equal(await page.locator('[data-placement="header"]').count(), 1);
        assert.equal(await page.locator('[data-placement="footer"]').count(), 1);
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.width, file + ' overflows');
        if (file === 'where-to-trade.html') {
          await click('exchange');
          assert.match(await page.locator('[data-referral-analytics-status]').innerText(), /не подключён/);
        }
        if (file.startsWith('reports/')) { await click('report-top'); await click('report-bottom'); }
      }
      await page.goto(origin + '/where-to-trade.html', { waitUntil: 'load' });
      const beforePeer = await page.evaluate(() => CSReferral.createTracker(localStorage).counts().footer || 0);
      const peer = await context.newPage();
      peer.on('pageerror', error => errors.push(error.message));
      await peer.goto(origin + '/where-to-trade.html', { waitUntil: 'load' });
      const peerPopup = peer.waitForEvent('popup');
      await peer.locator('[data-placement="footer"]').click();
      await (await peerPopup).close();
      await page.waitForFunction(expected => [...document.querySelectorAll('[data-referral-counts] tbody tr')]
        .some(row => row.querySelector('th')?.textContent === 'footer' && Number(row.querySelector('td')?.textContent) === expected), beforePeer + 1);
      assert.equal(await page.evaluate(() => CSReferral.createTracker(localStorage).counts().footer), beforePeer + 1);
      await peer.close();
      assert.deepEqual(errors, []);
      results.push({ width, allReferralAttributes: true, perPlacementClicks: true, tradeColumnVisible: true,
        mobileDockNoOverlap: true, mobileDismissal: true, pagesAndReport: true, crossTabCounts: true, pageErrors: errors });
      await context.close();
    }
    console.log(JSON.stringify({ referralBrowserChecks: results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(output, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
