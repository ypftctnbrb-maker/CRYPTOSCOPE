'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync('assets/app.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('HTTP-date formats use UTC in every tested local timezone', () => {
  const deadlineSource = source.slice(source.indexOf('function coinGeckoDeadline('), source.indexOf('async function getJson('));
  const script = deadlineSource + `
    const assert = require('node:assert/strict');
    const responseTime = Date.UTC(1994, 10, 6, 8, 49, 37);
    const dates = ['Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994'];
    for (const offset of [-3600000, 3600000, 99*3600000]) {
      const now = responseTime - offset;
      const expected = Math.max(now + 30000, Math.min(now + 7200000, responseTime));
      for (const date of dates) assert.equal(coinGeckoDeadline(date, now), expected, date + ' offset ' + offset);
    }
  `;
  for (const zone of ['UTC', 'Europe/Moscow', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(result.status, 0, zone + ': ' + result.stderr);
  }
});

function browser({ retryAfter = '900', status = 429 } = {}) {
  let now = 1800000000000, responseStatus = status, header = retryAfter, timerId = 0;
  const elements = new Map(), requests = [], timers = new Map(), listeners = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(), handlers = new Map();
      elements.set(id, {
        value: id === 'search' ? 'hold' : '', hidden: true, textContent: '', dataset: {}, handlers,
        classList: { add: n => classes.add(n), remove: n => classes.delete(n),
          toggle: (n, on) => on ? classes.add(n) : classes.delete(n), contains: n => classes.has(n) },
        addEventListener: (type, fn) => handlers.set(type, fn),
        querySelectorAll: () => [], setAttribute() {}, scrollIntoView() {},
      });
    }
    return elements.get(id);
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const document = { hidden: false, documentElement: {}, getElementById: element,
    querySelectorAll: () => [], addEventListener: (name, fn) => listeners.set(name, fn) };
  const schedule = (fn, delay, repeat = 0) => {
    const id = ++timerId;
    timers.set(id, { fn, at: now + delay, repeat });
    return id;
  };
  const context = { document, window: {}, Date: ClockDate, Intl, AbortController, URL,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    console: { warn() {} }, localStorage: { getItem: () => null },
    WebSocket: class { close() {} },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, ms),
    fetch: async url => {
      requests.push(url);
      if (url.startsWith('https://api.coingecko.com/')) {
        const value = typeof header === 'function' ? header(url) : header;
        return { ok: responseStatus === 200, status: responseStatus,
          headers: { get: name => name.toLowerCase() === 'retry-after' ? value : null },
          json: async () => [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 100,
            market_cap: 1e12, total_volume: 1e9, price_change_percentage_24h: 1 }] };
      }
      return { ok: true, json: async () => ({ lastPrice: '100', priceChangePercent: '1' }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 1000 });
  const run = code => vm.runInContext(code, context);
  const marketCalls = () => requests.filter(u => u.includes('/coins/markets')).length;
  return { run, requests, marketCalls, element,
    now: () => now,
    setTime: value => { now = value; },
    respond: (code, value = null) => { responseStatus = code; header = value; },
    click: async id => { await element(id).handlers.get('click')?.({ type: 'click' }); await flush(); },
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 2000; count++) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = end; return; }
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.repeat;
        else timers.delete(id);
        timer.fn();
        await flush();
      }
      throw Error('Timer loop did not settle');
    },
  };
}

test('429 Retry-After blocks both refresh buttons until the server deadline', async () => {
  const b = browser();
  await flush();
  assert.equal(b.marketCalls(), 4);
  for (let i = 0; i < 5; i++) {
    await b.click('refresh');
    await b.click('potentialRefresh');
  }
  assert.equal(b.marketCalls(), 4, 'Manual refresh must not bypass a 429 cooldown');
  await b.advance(899999);
  assert.equal(b.marketCalls(), 4, 'Automatic refresh must honor Retry-After');
  b.respond(200);
  await b.advance(1);
  assert.equal(b.marketCalls(), 8, 'Refresh should resume when the server deadline expires');
  assert.equal(b.run('coins[0].current_price'), 100);
});

test('HTTP-date Retry-After preserves the longest deadline from parallel pages', async () => {
  const start = 1800000000000;
  const b = browser({ retryAfter: url => new Date(start + (url.includes('page=4') ? 1200000 : 600000)).toUTCString() });
  await flush();
  b.setTime(start + 1199999);
  await b.run('load(true)');
  assert.equal(b.marketCalls(), 4, 'A later page must not shorten the server cooldown');
  b.respond(200);
  b.setTime(start + 1200000);
  await b.run('load(true)');
  assert.equal(b.marketCalls(), 8);
});

test('CoinGecko project research shares cooldown while Binance remains usable', async () => {
  const b = browser();
  await flush();
  let blocked = false;
  try { await b.run("getJson('https://api.coingecko.com/api/v3/coins/ethereum')"); }
  catch { blocked = true; }
  assert.equal(blocked, true);
  assert.equal(b.requests.filter(u => u.startsWith('https://api.coingecko.com/')).length, 4);
  const count = b.requests.length;
  await b.run("getJson('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT')");
  assert.equal(b.requests.length, count + 1);
});

test('missing or invalid Retry-After uses backoff and blocks click spam', async () => {
  for (const header of [null, 'invalid', '-1', '1.5']) {
    const b = browser({ retryAfter: header });
    await flush();
    await b.click('refresh');
    await b.click('potentialRefresh');
    assert.equal(b.marketCalls(), 4, `Fallback backoff required for ${header}`);
    b.respond(200);
    b.setTime(b.now() + 30000);
    await b.run('load(true)');
    assert.equal(b.marketCalls(), 8);
  }
});

test('non-429 errors back off, successful manual refresh remains available', async () => {
  const b = browser({ status: 500 });
  await flush();
  await b.click('refresh');
  assert.equal(b.marketCalls(), 4);
  b.respond(200);
  b.setTime(b.now() + 30000);
  await b.run('load(true)');
  assert.equal(b.marketCalls(), 8);
  await b.click('refresh');
  assert.equal(b.marketCalls(), 12, 'A successful snapshot must not block an explicit refresh for five minutes');
});

test('a longer cooldown is honored and existing prices survive 429', async () => {
  const b = browser({ retryAfter: '3600' });
  b.run("coins=[{id:'bitcoin',name:'Bitcoin',symbol:'btc',current_price:77,market_cap:1e12}]");
  await flush();
  assert.equal(b.run('coins[0].current_price'), 77);
  b.setTime(b.now() + 3599999);
  await b.run('load(true)');
  assert.equal(b.marketCalls(), 4, 'Server deadline must not be capped by the local 15-minute backoff');
});

test('both blocked refresh buttons explain retry time beside the potential list', async () => {
  for (const status of [429, 500]) {
    const b = browser({ retryAfter: '900', status });
    await flush();
    for (const id of ['refresh', 'potentialRefresh']) {
      b.element('status').textContent = 'Waiting';
      b.element('potentialUpdated').textContent = 'Waiting';
      await b.click(id);
      const message = b.element('status').textContent;
      assert.match(message, /повтор после/);
      assert.equal(b.element('potentialUpdated').textContent, message);
      assert.equal(b.marketCalls(), 4, `${id} must not bypass HTTP ${status} backoff`);
    }
  }
});

test('blocked refresh keeps the saved data time and does not duplicate feedback', async () => {
  const b = browser();
  await flush();
  b.run('lastMarketSuccess=Date.now()-60000');
  for (let i = 0; i < 3; i++) await b.click('potentialRefresh');
  const message = b.element('potentialUpdated').textContent;
  assert.match(message, /повтор после/);
  assert.match(message, /данные от/);
  assert.equal(message.split('повтор после').length, 2);
  assert.equal(b.marketCalls(), 4);
});

test('excessive Retry-After stays blocked for two hours, including numeric overflow', async () => {
  for (const retryAfter of ['999999999', '8640000000000', '99999999999999999999', '9'.repeat(400)]) {
    const b = browser({ retryAfter });
    await flush();
    assert.equal(b.marketCalls(), 4);
    b.respond(200);
    b.setTime(b.now() + 7199999);
    await b.run('load(true)');
    assert.equal(b.marketCalls(), 4, 'Must not retry before two-hour cap: ' + retryAfter.slice(0, 24));
    b.setTime(b.now() + 1);
    await b.run('load(true)');
    assert.equal(b.marketCalls(), 8, 'Must recover at two-hour cap: ' + retryAfter.slice(0, 24));
  }
});
