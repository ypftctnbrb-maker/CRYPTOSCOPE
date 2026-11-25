'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const source = process.env.CATALOGUE_SITE_SOURCE || path.resolve(__dirname, '..');
const { preparePublic } = require(path.join(source, 'scripts/prepare-public.cjs'));

const live = process.env.LIVE === '1';
const mime = { '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.js': 'text/javascript', '.mjs': 'text/javascript' };
const names = ['Bybit', 'Hyperliquid', 'OKX', 'Bitfinex', 'MEXC'];

function protobuf(fields) {
  const bytes = [];
  function varint(value) {
    while (value >= 128) {
      bytes.push(value % 128 + 128);
      value = Math.floor(value / 128);
    }
    bytes.push(value);
  }
  for (const [field, value] of fields) {
    const binary = typeof value !== 'number';
    varint(field * 8 + (binary ? 2 : 0));
    if (!binary) varint(value);
    else {
      const data = Buffer.from(value);
      varint(data.length);
      bytes.push(...data);
    }
  }
  return Buffer.from(bytes);
}

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
    preparePublic(source, root);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const proxy = process.env.HTTPS_PROXY;
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(live && proxy && { proxy: { server: proxy, bypass: '127.0.0.1' } }) });
    const page = await browser.newPage({ viewport: { width: Number(process.env.CATALOGUE_WIDTH || 390), height: 850 } });
    const errors = [], responses = [], failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('https:')) responses.push([response.status(), response.url()]);
    });
    page.on('requestfailed', request => failures.push([request.failure()?.errorText, request.url()]));
    let stream, closed = false, historyRequests = 0, okxClosed = 0, okxTradeHistory = 0, okxTradeStream;
    const closedExtra = { hyperliquid: 0, bitfinex: 0, mexc: 0, mexcSpot: 0 };
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
      await page.route('https://www.okx.com/**', route => {
        const url = new URL(route.request().url());
        const instId = url.searchParams.get('instId');
        if (url.pathname.endsWith('/history-trades') && instId === 'BTC-USDT-SWAP') okxTradeHistory++;
        const timestamp = Math.floor(Date.now() / 300000) * 300000;
        const rows = {
          instruments: [{ instId, ctVal: '0.01', ctValCcy: 'BTC', tickSz: '0.1' }],
          candles: [[String(timestamp), '61000', '61100', '60900', '61001', '20']],
          'history-trades': [{ instId, tradeId: 'rest', ts: String(timestamp), px: '61000', sz: '30', side: 'buy' }],
          'open-interest': [{ oiCcy: '7', ts: String(timestamp) }],
          'funding-rate-history': [{ realizedRate: '0.0002', fundingTime: String(timestamp) }],
        };
        return route.fulfill({ json: { code: '0', data: rows[url.pathname.split('/').at(-1)] } });
      });
      await page.routeWebSocket('wss://ws.okx.com:8443/**', socket => {
        socket.onClose(() => { okxClosed++; });
        socket.onMessage(message => {
          if (message === 'ping') return;
          const [arg] = JSON.parse(message).args;
          const now = Date.now();
          if (arg.channel === 'trades-all') okxTradeStream = socket;
          const candle = [String(Math.floor(now / 300000) * 300000), '61000', '61100', '60900', '61002', '21'];
          const trade = { instId: arg.instId, tradeId: 'live', ts: String(now), px: '61001', sz: '20', side: 'sell' };
          socket.send(JSON.stringify({ arg, data: arg.channel === 'candle5m' ? [candle] : [trade, trade] }));
        });
      });
      const currentBucket = () => Math.floor(Date.now() / 300000) * 300000;
      await page.route('https://api.hyperliquid.xyz/info', route => {
        const query = route.request().postDataJSON();
        if (query.type === 'metaAndAssetCtxs') return route.fulfill({ json:
          [{ universe: [{ name: 'BTC' }] }, [{ openInterest: '14', funding: '-0.0002' }]] });
        const coin = query.coin ?? query.req.coin;
        const time = currentBucket();
        const candle = { s: coin, i: '5m', t: time, o: '2', h: '3', l: '1', c: '2', v: '6' };
        const trade = { coin, tid: 1, time, px: '2', sz: '6', side: 'B' };
        return route.fulfill({ json: query.type === 'candleSnapshot' ? [candle] : [trade] });
      });
      await page.routeWebSocket('wss://api.hyperliquid.xyz/**', socket => {
        socket.onClose(() => { closedExtra.hyperliquid++; });
        socket.onMessage(data => {
          const subscription = JSON.parse(data).subscription;
          if (!subscription) return;
          const { coin, type } = subscription;
          const value = type === 'candle'
            ? { s: coin, i: '5m', t: currentBucket(), o: '2', h: '3', l: '1', c: '2', v: '6' }
            : [{ coin, tid: 2, time: Date.now(), px: '2', sz: '4', side: 'A' }];
          socket.send(JSON.stringify({ channel: type, data: value }));
        });
      });
      await page.route('https://api-pub.bitfinex.com/v2/**', route => {
        const time = currentBucket();
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/status/deriv')) {
          const row = Array(23).fill(null);
          Object.assign(row, { 0: url.searchParams.get('keys'), 1: time, 11: 0.001, 17: 5 });
          return route.fulfill({ json: [row] });
        }
        return route.fulfill({ json: url.pathname.includes('/candles/') ? [[time, 6, 7, 8, 5, 12]] : [[1, time, -4, 7]] });
      });
      await page.routeWebSocket('wss://api-pub.bitfinex.com/**', socket => {
        socket.onClose(() => { closedExtra.bitfinex++; });
        socket.onMessage(data => {
          const { channel, symbol, key } = JSON.parse(data);
          socket.send(JSON.stringify({ event: 'subscribed', channel, symbol, key, chanId: 9 }));
          socket.send(JSON.stringify(channel === 'candles'
            ? [9, [currentBucket(), 6, 7, 8, 5, 12]] : [9, 'te', [2, Date.now(), 3, 7]]));
        });
      });
      await page.route('https://contract.mexc.com/api/v1/**', route => {
        const url = route.request().url();
        const time = currentBucket();
        const data = url.includes('/kline/')
          ? { time: [time / 1000], open: [7], high: [8], low: [6], close: [7], vol: [10] }
          : url.includes('/deals/') ? [{ i: '1', t: time, p: 7, v: 9, T: 2 }]
            : { symbol: 'BTC_USDT', holdVol: 10, fundingRate: 0.0001, timestamp: time };
        return route.fulfill({ json: { success: true, code: 0, data } });
      });
      await page.routeWebSocket('wss://contract.mexc.com/**', socket => {
        socket.onClose(() => { closedExtra.mexc++; });
        socket.onMessage(raw => {
          const { method, param } = JSON.parse(raw);
          if (!param) return;
          const { symbol, interval } = param;
          const ts = Date.now();
          const data = method === 'sub.kline'
            ? { symbol, interval, t: currentBucket() / 1000, o: 7, h: 8, l: 6, c: 7, q: 10 }
            : [{ i: '2', t: ts, p: 7, v: 8, T: 1 }];
          socket.send(JSON.stringify({ channel: method.replace('sub.', 'push.'), symbol, data, ts }));
        });
      });
      await page.route('https://api.mexc.com/api/v3/**', route => {
        const time = currentBucket();
        return route.fulfill({ json: route.request().url().includes('/klines')
          ? [[time, '7', '8', '6', '7', '10']] : [{ id: null, time, price: '7', qty: '9', isBuyerMaker: true }] });
      });
      await page.routeWebSocket('wss://wbs-api.mexc.com/**', socket => {
        socket.onClose(() => { closedExtra.mexcSpot++; });
        socket.onMessage(raw => {
          const channel = JSON.parse(raw).params?.[0];
          if (!channel) return;
          const now = Date.now();
          const fields = [[1, channel], [3, 'BTCUSDT'], [6, now]];
          if (channel.includes('.kline.')) {
            fields.push([308, protobuf([[1, 'Min5'], [2, currentBucket() / 1000],
              [3, '7'], [4, '7'], [5, '8'], [6, '6'], [7, '10']])]);
          } else {
            const deal = protobuf([[1, '7'], [2, '8'], [3, 1], [4, now], [5, 'mexc-spot-1']]);
            fields.push([314, protobuf([[1, deal]])]);
          }
          socket.send(protobuf(fields));
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
      await page.locator('#instrument-venue').selectOption('okx');
      for (const [id, type] of [['BTC-USDT', 'spot'], ['BTC-USDT-SWAP', 'perp']]) {
        await search.fill(id);
        await page.getByRole('button', { name: 'OKX · ' + type + ' · ' + id, exact: true }).click();
        await page.waitForTimeout(4500);
        console.log(JSON.stringify({ id, type, status: await page.locator('#instrument-chart-status').innerText(),
          metrics: await page.locator('#instrument-metrics').innerText() }));
      }
      for (const [venue, label, id] of [
        ['hyperliquid', 'Hyperliquid · spot · @142', '@142'],
        ['bitfinex', 'Bitfinex · spot · BTCUSD', 'BTCUSD'],
        ['mexc', 'MEXC · spot · BTCUSDT', 'BTCUSDT'],
        ['mexc', 'MEXC · perp · BTC_USDT', 'BTC_USDT'],
      ]) {
        await page.locator('#instrument-venue').selectOption(venue);
        await search.fill(id);
        await page.getByRole('button', { name: label, exact: true }).click();
        await page.waitForTimeout(3500);
        console.log(JSON.stringify({ venue, id, status: await page.locator('#instrument-chart-status').innerText(),
          metrics: await page.locator('#instrument-metrics').innerText() }));
      }
      await page.locator('#instrument-refresh').click();
      await page.waitForFunction(() => !document.querySelector('#instrument-refresh').disabled, {}, { timeout: 90000 });
      console.log(JSON.stringify({ coverage: await page.locator('#instrument-coverage').textContent(), responses, failures, errors }));
      return;
    }
    await page.waitForFunction(() => document.querySelector('#instrument-chart-status').textContent.includes('LIVE'));
    await page.locator('#instrument-cvd-chart canvas').first().waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('#instrument-cvd-chart').dataset.liveBars === '1');
    assert.equal(await instrument.getAttribute('aria-pressed'), 'true');
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
    assert.match(await page.locator('#instrument-history-rows').textContent(), /CVD 2 1000PEPE/);
    closed = false;
    await page.locator('#instrument-venue').selectOption('okx');
    await search.fill('BTC-USDT-SWAP');
    await page.getByRole('button', { name: 'OKX · perp · BTC-USDT-SWAP', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#instrument-chart-status').textContent.includes('OKX swap · BTC-USDT-SWAP · 5m · LIVE') &&
      document.querySelector('#instrument-history-rows').textContent.includes('CVD 0.3 BTC') &&
      document.querySelector('#instrument-metrics').textContent.includes('OI · 7 BTC'));
    await page.waitForFunction(() => document.querySelector('#instrument-cvd-chart').dataset.liveBars === '1' &&
      document.querySelector('#instrument-cvd-status').textContent.includes('BTC-USDT-SWAP'));
    assert.doesNotMatch(await page.locator('#instrument-cvd-status').textContent(), /Bybit/);
    assert.match(await page.locator('#instrument-metrics').innerText(), /сегмент с .* -0.2 BTC/);
    assert.match(await page.locator('#instrument-metrics').innerText(), /Funding · 0.02 %/);
    assert.doesNotMatch(await page.locator('#instrument-history-rows').textContent(), /Bybit|1000PEPE/);
    const previousOkxStream = okxTradeStream;
    previousOkxStream.close();
    await page.waitForFunction(() => document.querySelector('#instrument-metrics').textContent.includes('CVD · данные устарели'));
    await page.waitForFunction(() => document.querySelector('#instrument-metrics').textContent.includes('CVD · LIVE') &&
      document.querySelector('#instrument-history-rows').textContent.includes('CVD 0.3 BTC'));
    assert.notEqual(okxTradeStream, previousOkxStream);
    assert.equal(okxTradeHistory, 2);
    await search.fill('BTC-USDT');
    await page.getByRole('button', { name: 'OKX · spot · BTC-USDT', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#instrument-history-rows').textContent.includes('CVD 30 BTC') &&
      document.querySelector('#instrument-metrics').textContent.includes('CVD · LIVE'));
    assert.match(await page.locator('#instrument-metrics').innerText(), /сегмент с .* -20 BTC/);
    assert.doesNotMatch(await page.locator('#instrument-metrics').innerText(), /OI · 7 BTC/);
    for (const [venue, label, id, value, historyValue, oi] of [
      ['bybit', 'Bybit · spot · PEPEUSDT', 'PEPEUSDT', '-3 PEPE', '2 PEPE'],
      ['hyperliquid', 'Hyperliquid · spot · @129', '@129', '-4 MON', '6 MON'],
      ['hyperliquid', 'Hyperliquid · perp · BTC', 'BTC', '-4 BTC', '6 BTC', '14 BTC'],
      ['bitfinex', 'Bitfinex · spot · BTCUSD', 'BTCUSD', '3 BTC', '-4 BTC'],
      ['bitfinex', 'Bitfinex · perp · BTCF0:USTF0', 'BTCF0:USTF0', '3 контрактов', '-4 контрактов', '5 контрактов'],
      ['mexc', 'MEXC · perp · BTC_USDT', 'BTC_USDT', '8 контрактов', '-9 контрактов', '10 контрактов'],
      ['mexc', 'MEXC · spot · BTCUSDT', 'BTCUSDT', '8 BTC', null],
    ]) {
      await page.locator('#instrument-venue').selectOption(venue);
      await search.fill(id);
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#instrument-chart-status').textContent.includes('LIVE') &&
        document.querySelector('#instrument-metrics').textContent.includes('CVD · LIVE'));
      await page.waitForFunction(venueName => document.querySelector('#instrument-cvd-chart').dataset.liveBars === '1' &&
        document.querySelector('#instrument-cvd-status').textContent.startsWith(venueName), label.split(' · ')[0]);
      await page.waitForFunction(amount => document.querySelector('#instrument-history-rows').textContent.includes(amount),
        historyValue ? 'CVD ' + historyValue : 'REST без ID');
      await page.waitForFunction(expected => document.querySelector('#instrument-metrics').textContent.includes(expected), 'OI · ' + (oi || '—'));
      assert.match(await page.locator('#instrument-metrics').innerText(), new RegExp('сегмент с .* ' + value));
      assert.match(await page.locator('#instrument-history-rows').textContent(), new RegExp(label.split(' · ')[0]));
    }
    await page.locator('#instrument-venue').selectOption('bybit');
    await search.fill('PEPEUSDT');
    await instrument.click();
    await page.waitForFunction(() => document.querySelector('#instrument-history-rows').textContent.includes('Bybit'));
    for (let index = 0; index < 50 && (!closed || okxClosed < 4 ||
      closedExtra.hyperliquid < 4 || closedExtra.bitfinex < 4 || closedExtra.mexc < 2 || closedExtra.mexcSpot < 2); index++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closed, true);
    assert.ok(okxClosed >= 4);
    assert.deepEqual(closedExtra, { hyperliquid: 4, bitfinex: 4, mexc: 2, mexcSpot: 2 });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS: all venue scopes, Hyperliquid native ID, spot/perp price and CVD candles for five venues, partial REST history, instrument switching and socket cleanup');
  } finally {
    await browser?.close();
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
