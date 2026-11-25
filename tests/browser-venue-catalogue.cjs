'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { preparePublic } = require('../scripts/prepare-public.cjs');

const live = process.env.LIVE === '1';
const mime = { '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.js': 'text/javascript', '.mjs': 'text/javascript' };
const names = ['Bybit', 'Hyperliquid', 'OKX', 'Bitfinex', 'MEXC'];

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'venue-browser-'));
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    try {
      if (!file.startsWith(root + path.sep)) throw Error('outside site');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  let browser;
  try {
    preparePublic(path.resolve(__dirname, '..'), root);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const proxy = process.env.HTTPS_PROXY;
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(live && proxy && { proxy: { server: proxy, bypass: '127.0.0.1' } }) });
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
    const errors = [], responses = [], failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('https:')) responses.push([response.status(), response.url()]);
    });
    page.on('requestfailed', request => failures.push([request.failure()?.errorText, request.url()]));
    let stream, closed = false, historyRequests = 0;
    if (!live) {
      await page.route('https://api.bybit.com/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/kline')) historyRequests++;
        const timestamp = 1795555200000;
        const list = url.pathname.endsWith('/kline') ? [[String(timestamp), '0.00000301', '0.00000304', '0.000003', '0.00000302', '30']]
          : url.pathname.endsWith('/recent-trade') ? [{ execId: 'a', side: 'Buy', size: '2', time: String(timestamp), price: '0.00000302' }]
          : url.pathname.endsWith('/open-interest') ? [{ openInterest: '0', timestamp: String(timestamp) }]
          : [{ fundingRate: '0.0001', fundingRateTimestamp: String(timestamp) }];
        return route.fulfill({ json: { retCode: 0, time: timestamp, result: { list } } });
      });
      await page.routeWebSocket('wss://stream.bybit.com/**', socket => {
        socket.onClose(() => { closed = true; });
        socket.onMessage(message => {
          const topic = JSON.parse(message).args?.[0];
          if (topic?.startsWith('publicTrade.')) {
            socket.send(JSON.stringify({ topic, data: [{ s: topic.slice('publicTrade.'.length), i: 'live-a',
              v: '3', p: '0.00000302', T: Date.now(), S: 'Sell' }] }));
          }
          if (topic?.startsWith('kline.')) {
            stream = socket;
            socket.send(JSON.stringify({ topic, data: [{ start: 1795555200000, open: '0.00000301',
              high: '0.00000305', low: '0.000003', close: '0.00000304', volume: '41', timestamp: 1795555201000 }] }));
          }
        });
      });
    }
    await page.goto('http://127.0.0.1:' + server.address().port + '/instruments.html');
    await page.waitForFunction(() => document.querySelector('#instrument-next').disabled === false &&
      document.querySelector('#instrument-count').textContent.includes('Инструментов'));
    const coverage = await page.locator('#instrument-coverage').textContent();
    for (const name of names) assert.match(coverage, new RegExp(name));
    const search = page.locator('#instrument-search');
    await search.fill('@129');
    await page.getByRole('button', { name: /Hyperliquid.*@129$/ }).waitFor();
    await page.locator('#instrument-venue').selectOption('bybit');
    await search.fill('PEPEUSDT');
    const instrument = page.getByRole('button', { name: 'Bybit · perp · 1000PEPEUSDT', exact: true });
    await instrument.click();
    if (live) {
      for (const [id, type] of [['1000PEPEUSDT', 'perp'], ['XDCUSDT', 'perp'], ['NEARUSD', 'perp'], ['PEPEUSDT', 'spot']]) {
        await search.fill(id);
        await page.getByRole('button', { name: 'Bybit · ' + type + ' · ' + id, exact: true }).click();
        await page.waitForTimeout(6500);
        console.log(JSON.stringify({ id, type, status: await page.locator('#instrument-chart-status').innerText(),
          metrics: await page.locator('#instrument-metrics').innerText() }));
      }
      await page.locator('#instrument-refresh').click();
      await page.waitForFunction(() => !document.querySelector('#instrument-refresh').disabled, {}, { timeout: 90000 });
      console.log(JSON.stringify({ coverage: await page.locator('#instrument-coverage').textContent(), responses, failures, errors }));
      return;
    }
    await page.waitForFunction(() => document.querySelector('#instrument-chart-status').textContent.includes('LIVE'));
    assert.ok(stream);
    await page.waitForFunction(() => document.querySelector('#instrument-metrics').textContent.includes('OI · 0'));
    await page.waitForFunction(() => document.querySelector('#instrument-metrics').textContent.includes('CVD · LIVE'));
    assert.match(await page.locator('#instrument-metrics').innerText(), /Δ 5m .* -3 1000PEPE/);
    assert.match(await page.locator('#instrument-metrics').innerText(), /CVD снимка сделок · 2 1000PEPE/);
    assert.match(await page.locator('#instrument-metrics').innerText(), /Funding · 0.01 %/);
    const firstStream = stream;
    firstStream.close();
    await page.waitForFunction(() => document.querySelector('#instrument-chart-status').textContent.includes('устарели'));
    for (let index = 0; index < 150 && stream === firstStream; index++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.notEqual(stream, firstStream);
    assert.equal(historyRequests, 2);
    await page.waitForFunction(() => document.querySelector('#instrument-chart-status').textContent.includes('LIVE'));
    closed = false;
    await page.locator('#instrument-venue').selectOption('hyperliquid');
    await search.fill('@129');
    await page.getByRole('button', { name: /Hyperliquid.*@129$/ }).click();
    assert.match(await page.locator('#instrument-chart-status').innerText(), /Метрики.*недоступны/);
    for (let index = 0; index < 50 && !closed; index++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closed, true);
    assert.equal(await page.locator('#instrument-metrics li').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS: all venue scopes, Hyperliquid native ID, Bybit fixture metrics, live candle and socket cleanup');
  } finally {
    await browser?.close();
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
