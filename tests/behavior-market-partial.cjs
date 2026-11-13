'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/app.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const start = 1800000000000;
const coin = (id, cap, price = 100) => ({ id, name: id, symbol: id, market_cap: cap,
  current_price: price, total_volume: 5e6, price_change_percentage_24h: 1,
  last_updated: new Date(start - 60000).toISOString() });
const full = () => [
  [coin('bitcoin', 1e12), coin('ethereum', 5e11)],
  [coin('alpha', 1e9)], [coin('candidate', 50e6)], [coin('delta', 30e6)],
];

function browser(pages) {
  let now = start, responses = pages, resolvePages;
  const elements = new Map(), requests = [];
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(), handlers = new Map();
      elements.set(id, { value: id === 'search' ? 'hold' : id === 'sort' ? 'market_cap' : '',
        textContent: '', innerHTML: '', hidden: true, dataset: {}, handlers,
        classList: { add: n => classes.add(n), remove: n => classes.delete(n),
          toggle: (n, on) => on ? classes.add(n) : classes.delete(n), contains: n => classes.has(n) },
        addEventListener: (name, fn) => handlers.set(name, fn), querySelectorAll: () => [], setAttribute() {},
      });
    }
    return elements.get(id);
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = { window: {}, Date: ClockDate, Intl, AbortController, URL,
    document: { hidden: false, documentElement: {}, getElementById: element,
      querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null }, WebSocket: class { close() {} }, console: { warn() {} },
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    fetch: async url => {
      requests.push(url);
      if (!url.includes('/coins/markets')) return { ok: true, json: async () => ({ lastPrice: '100' }) };
      const value = responses[Number(new URL(url).searchParams.get('page')) - 1];
      if (value === 'pending') await new Promise(resolve => { resolvePages = resolve; });
      if (value instanceof Error) throw value;
      if (value === 429) return { ok: false, status: 429, headers: { get: () => '900' } };
      return { ok: true, json: async () => value === 'pending' ? [coin('delayed', 1e9)] : value };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 1000 });
  const run = code => vm.runInContext(code, context);
  return { run, element, requests,
    ids: () => JSON.parse(run('JSON.stringify(coins.map(c=>c.id))')),
    calls: () => requests.filter(u => u.includes('/coins/markets')).length,
    respond: value => { responses = value; }, setTime: value => { now = value; },
    release: () => resolvePages(),
  };
}

test('cold partial load renders available assets with incomplete coverage, never a global top', async () => {
  const b = browser([new Error('offline'), full()[1], full()[2], full()[3]]);
  await flush();
  assert.deepEqual(b.ids(), ['alpha', 'candidate', 'delta']);
  assert.match(b.element('status').textContent, /3\/4/);
  assert.match(b.element('potentialUpdated').textContent, /[Нн]еполн/);
  assert.match(b.element('marketHint').textContent, /загруженн/);
  assert.equal(b.element('dot').classList.contains('ok'), false);
  assert.match(b.element('small').innerHTML, /candidate/);
});

test('warm partial update retains BTC, ETH, selected and favorite assets with their old receipt times', async () => {
  const b = browser(full());
  await flush();
  const btcTime = b.run("marketReceivedAt.get('bitcoin')");
  b.run("selectedCoinId='ethereum';favoriteIds.add('bitcoin');openCoin=()=>{};");
  b.setTime(start + 600000);
  b.respond([new Error('offline'), [coin('alpha', 1e9, 150)], full()[2], full()[3]]);
  await b.run('load(true)');
  assert.ok(b.ids().includes('bitcoin'));
  assert.ok(b.ids().includes('ethereum'));
  assert.equal(b.run("coins.find(c=>c.id==='alpha').current_price"), 150);
  assert.equal(b.run("marketReceivedAt.get('bitcoin')"), btcTime);
  assert.equal(b.run("marketReceivedAt.get('alpha')"), start + 600000);
  assert.match(b.element('major').innerHTML, /не обновлено/);
  assert.match(b.run("livePriceTitle(coins.find(c=>c.id==='bitcoin'))"), /не обновлено/);
  assert.equal(b.run('selectedCoinId'), 'ethereum');
  assert.equal(b.run("favoriteIds.has('bitcoin')"), true);
});

test('partial responses respect exponential backoff and shared 429 deadline', async () => {
  for (const failure of [new Error('offline'), 429]) {
    const b = browser([failure, full()[1], full()[2], full()[3]]);
    await flush();
    assert.equal(b.calls(), 4);
    await b.run('load(true)');
    assert.equal(b.calls(), 4);
    const retryAt = b.run('marketRetryAt');
    assert.equal(retryAt, start + (failure === 429 ? 900000 : 30000));
    b.setTime(retryAt - 1);
    await b.run('load(true)');
    assert.equal(b.calls(), 4);
    b.setTime(retryAt);
    b.respond(full());
    await b.run('load(true)');
    assert.equal(b.calls(), 8);
    assert.equal(b.run('marketFailures'), 0);
    assert.equal(b.element('dot').classList.contains('ok'), true);
    assert.doesNotMatch(b.element('potentialUpdated').textContent, /[Нн]еполн/);
  }
});

test('full recovery replaces the mixed snapshot and removes assets absent from the new snapshot', async () => {
  const b = browser([new Error('offline'), [coin('old', 1e9)], full()[2], full()[3]]);
  await flush();
  b.setTime(start + 30000);
  b.respond(full());
  await b.run('load(true)');
  assert.deepEqual(b.ids(), ['bitcoin', 'ethereum', 'alpha', 'candidate', 'delta']);
  assert.equal(b.run("marketReceivedAt.has('old')"), false);
  assert.doesNotMatch(b.element('marketHint').textContent, /загруженн/);
});

test('malformed pages are not treated as full coverage and duplicate IDs stay unique', async () => {
  for (const bad of [null, {}, [], [{ id: 'broken' }], [coin('bad', 1e9), null]]) {
    const b = browser([full()[0], [coin('bitcoin', 1e12, 110)], bad, full()[3]]);
    await flush();
    assert.equal(b.ids().filter(id => id === 'bitcoin').length, 1);
    assert.equal(b.ids().includes('broken'), false);
    assert.match(b.element('status').textContent, /3\/4/);
    assert.equal(b.element('dot').classList.contains('ok'), false);
  }
});

test('total outage preserves data and provenance and clears the success indicator', async () => {
  const b = browser(full());
  await flush();
  const previous = b.ids(), previousTime = b.run('lastMarketSuccess');
  b.setTime(start + 300000);
  b.respond(Array(4).fill(new Error('offline')));
  await b.run('load(true)');
  assert.deepEqual(b.ids(), previous);
  assert.equal(b.run('lastMarketSuccess'), previousTime);
  assert.equal(b.run("marketReceivedAt.get('bitcoin')"), start);
  assert.equal(b.element('dot').classList.contains('ok'), false);
  b.run('updatePotentialTimestamp()');
  assert.match(b.element('potentialUpdated').textContent, /[Оо]шибка/);
});

test('source age remains distinct from receipt time, invalid and future timestamps stay unknown', async () => {
  const pages = full();
  pages[0][0].last_updated = new Date(start - 3600000).toISOString();
  pages[0][1].last_updated = new Date(start + 3600000).toISOString();
  pages[1][0].last_updated = 'invalid';
  const b = browser(pages);
  await flush();
  assert.match(b.run("livePriceTitle(coins[0])"), /устарел/);
  assert.match(b.run("livePriceTitle(coins[1])"), /время источника неизвестно/);
  assert.match(b.run("livePriceTitle(coins[2])"), /время источника неизвестно/);
  assert.match(b.run("livePriceTitle(coins[0])"), /получено/);
});

test('concurrent refreshes never create a second page batch', async () => {
  const b = browser(['pending', full()[1], full()[2], full()[3]]);
  await b.run('load(true)');
  await b.run('load(true)');
  assert.equal(b.calls(), 4);
  b.release();
  await flush();
  assert.equal(b.run('marketLoadPending'), false);
});
