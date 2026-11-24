const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
async function expectPoll(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const root = process.env.QA_ARTIFACT_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'cryptoscope-browser-qa');
fs.mkdirSync(root, { recursive: true });
(async () => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html',
      'assets/app.js', 'assets/lightweight-charts-4.2.3.js', 'assets/styles.css', 'assets/information.css',
      'assets/config.js', 'assets/referrals.js', 'assets/referrals.css', 'assets/referral-market.js'].includes(file)) {
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
      const streams = new Map();
      const disconnected = new WeakSet();
      const candleRequests = [];
      const recoveredRows = [];
      await page.routeWebSocket(/stream\.binance\.com/, socket => {
        const stream = new URL(socket.url()).pathname.split('/').pop();
        const connections = streams.get(stream) || [];
        socket.onClose(() => disconnected.add(socket));
        connections.push(socket);
        streams.set(stream, connections);
      });
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
        [coin('pepe', 'pepe', 30e6, 0.00000301)],
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
        if (url.pathname.endsWith('/klines')) {
          candleRequests.push(url.searchParams.get('symbol') + ':' + url.searchParams.get('interval'));
          if (url.searchParams.get('symbol') === 'PEPEUSDT') {
            return route.fulfill({ json: [
              [1794596400000, '0.00000300', '0.00000302', '0.00000299', '0.00000301', '12'],
              [1794596700000, '0.00000301', '0.00000303', '0.00000300', '0.00000302', '15'],
              ...recoveredRows,
            ] });
          }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify([
            [1794596400000, '100', '105', '99', '104', '12'],
            [1794600000000, '104', '106', '103', '105', '15'],
          ]) });
        }
        if (url.pathname.includes('/coins/candidate')) researchCalls++;
        return route.abort();
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('5 монет'));
      await page.waitForFunction(() => document.querySelector('#nativeChart canvas'));
      assert.equal(await page.evaluate(() => LightweightCharts.version()), '4.2.3');
      assert.match(await page.locator('#chartStatus').innerText(), /Binance Spot.*BTCUSDT.*2/);
      assert.match(await page.locator('#investmentDisclaimer').innerText(), /Не является инвестиционной рекомендацией/);
      if (width === 390) {
        await page.evaluate(() => {
          const library = window.LightweightCharts;
          window.LightweightCharts = { ...library, createChart(...args) {
            const chart = library.createChart(...args);
            const addCandlestickSeries = chart.addCandlestickSeries.bind(chart);
            chart.addCandlestickSeries = options => {
              const series = addCandlestickSeries(options);
              window.testCandleSeries = series;
              return series;
            };
            const addHistogramSeries = chart.addHistogramSeries.bind(chart);
            chart.addHistogramSeries = options => {
              window.testVolumeSeries = addHistogramSeries(options);
              return window.testVolumeSeries;
            };
            return chart;
          } };
        });
        await page.locator('#timeframes button[data-tf="5m"]').click();
        await page.waitForFunction(() => /BTCUSDT · 5m · 2/.test(document.querySelector('#chartStatus').textContent));
        for (const [table, coinId, pair, prices, labels] of [
          ['small', 'pepe', 'PEPEUSDT', [0.00000301, 0.00000302], ['0.00000301', '0.00000302']],
          ['major', 'bitcoin', 'BTCUSDT', [104, 105], ['104.00', '105.00']],
          ['small', 'pepe', 'PEPEUSDT', [0.00000301, 0.00000302], ['0.00000301', '0.00000302']],
        ]) {
          await page.locator(`#${table} tr[data-id="${coinId}"] td`).first().click();
          await page.waitForFunction(pair => document.querySelector('#chartStatus').textContent.includes(pair + ' · 5m · 2'), pair);
          const actual = await page.evaluate(prices => {
            const formatter = window.testCandleSeries.priceFormatter();
            return prices.map(price => formatter.format(price));
          }, prices);
          console.log(`Candlestick formatter ${pair} 5m: ${actual.join(', ')}`);
          assert.deepEqual(actual, labels, pair + ' price labels must preserve distinct adjacent prices');
        }
        const stream = 'pepeusdt@kline_5m';
        const waitForStream = async (name, count) => {
          await expectPoll(() => (streams.get(name)?.length || 0) >= count, 'missing WebSocket ' + name);
          return streams.get(name)[count - 1];
        };
        const send = (socket, time, eventTime, close, volume) => socket.send(JSON.stringify({
          e: 'kline', E: eventTime, s: 'PEPEUSDT',
          k: { t: time, T: time + 299999, i: '5m',
            o: '0.00000301', h: '0.00000312', l: '0.00000300', c: close, v: volume },
        }));
        const readLatest = () => page.evaluate(() => [
          window.testCandleSeries.data().at(-1).close,
          window.testVolumeSeries.data().at(-1).value,
          window.testCandleSeries.data().length,
        ]);
        const expectLatest = async expected => {
          await expectPoll(async () => JSON.stringify(await readLatest()) === JSON.stringify(expected),
            'expected candle close, volume, count: ' + expected);
        };
        const last = 1794596700000;
        const original = await readLatest();
        console.log('PEPE before live fixture:', original);
        const socket = await waitForStream(stream, 2);
        send(socket, last, last + 1000, '0.00000303', '21');
        await expectLatest([0.00000303, 21, 2]);
        send(socket, last, last + 1000, '0.00000302', '15');
        send(socket, last + 300000, last + 301000, '0.00000304', '5');
        await expectLatest([0.00000304, 5, 3]);
        assert.deepEqual(await page.evaluate(() => [
          window.testCandleSeries.data().at(-2).close, window.testVolumeSeries.data().at(-2).value,
        ]), [0.00000303, 21], 'duplicate must not overwrite the latest snapshot');
        const requestsBeforeGap = candleRequests.length;
        recoveredRows.push(...[1, 2, 3].map(step => [
          last + step * 300000, '0.00000301', '0.00000312', '0.00000300', '0.00000305', '25',
        ]));
        send(socket, last + 900000, last + 901000, '0.00000312', '75');
        await expectPoll(() => candleRequests.length > requestsBeforeGap, 'gap must trigger REST backfill');
        const restored = await waitForStream(stream, 3);
        send(restored, last + 900000, last + 902000, '0.00000306', '26');
        await expectLatest([0.00000306, 26, 5]);
        await page.clock.fastForward(16000);
        await page.waitForFunction(() => document.querySelector('#chartStatus').textContent.includes('устарели'));
        const reconnected = await waitForStream(stream, 4);
        send(reconnected, last + 900000, last + 903000, '0.00000307', '27');
        await expectLatest([0.00000307, 27, 5]);
        assert.match(await page.locator('#chartStatus').innerText(), /LIVE/);
        await page.locator('#timeframes button[data-tf="15m"]').click();
        const fifteenMinute = await waitForStream('pepeusdt@kline_15m', 1);
        await expectPoll(() => disconnected.has(reconnected), 'old timeframe must close its socket');
        await page.locator('#timeframes button[data-tf="5m"]').click();
        const finalPepe = await waitForStream(stream, 5);
        await expectPoll(() => disconnected.has(fifteenMinute), '15m socket must close when switching back');
        console.log('PASS: candle updates, rollover, duplicate, gap backfill, stale recovery, timeframe switch');
        await page.locator('#search').fill('');
        await page.waitForFunction(() => /BTCUSDT · 5m · 2/.test(document.querySelector('#chartStatus').textContent));
        await waitForStream('btcusdt@kline_5m', 3);
        await expectPoll(() => disconnected.has(finalPepe), 'old pair must close its socket');
      }
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
      const informationPages = [];
      for (const file of ['about.html', 'methodology.html', 'disclaimer.html']) {
        await page.goto(origin + '/' + file, { waitUntil: 'load' });
        assert.match(await page.locator('footer').innerText(), /Не является инвестиционной рекомендацией/);
        assert.equal(await page.locator('h1').count(), 1);
        for (const target of ['index.html', 'about.html', 'methodology.html', 'disclaimer.html']) {
          await page.locator('header .information-links a[href="./' + target + '"]').click();
          assert.equal(new URL(page.url()).pathname, '/' + target);
          await page.goto(origin + '/' + file, { waitUntil: 'load' });
        }
        const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(size.scroll <= size.width, file + ': ' + JSON.stringify(size));
        informationPages.push({ file, horizontalOverflow: false });
      }
      assert.deepEqual(errors, []);
      results.push({ width, informationPages, partialRetainsLeaders: true, favoritesRetained: true,
        clickBackoff: true, fullRecovery: true, researchRetainedSupply: true, sharedTwoHourCap: true, horizontalOverflow: false, pageErrors: errors });
      await page.close();
    }
    console.log(JSON.stringify({ fixtureBrowserChecks: results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
