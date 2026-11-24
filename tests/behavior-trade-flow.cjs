'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('assets/app.js', 'utf8');
const start = source.indexOf('function mergeTradeWindow(');
const end = source.indexOf('let chartInstance=', start);
assert.ok(start >= 0 && end > start);

const fixture = (id, quantity, sell = false) => ({ id, quantity, sell, time: 1794596400000 + id });

function harness() {
  const elements = new Map();
  const timers = new Map();
  const sockets = [];
  const scheduled = [];
  const document = { hidden: false };
  let nextTimer = 0;
  class Socket {
    constructor(url) { this.url = url; sockets.push(this); }
    close() { this.closed = true; }
    trade(symbol, id, quantity, sell = false) {
      this.onmessage?.({ data: JSON.stringify({
        e: 'aggTrade', s: symbol, a: id, q: String(quantity), m: sell, T: fixture(id).time,
      }) });
    }
  }
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '4', textContent: '' });
    return elements.get(id);
  };
  const sandbox = {
    document, $, AbortController, WebSocket: Socket,
    fetch: (url, options) => new Promise(resolve => scheduled.push({ url, options, resolve })),
    setTimeout: (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; },
    clearTimeout: key => timers.delete(key),
    fmt: String, drawCvd: () => {}, coinGeckoDeadline: (_, now) => now + 30000,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), context);
  function fire(ms) {
    const [key, timer] = [...timers].find(([, timer]) => timer.ms === ms) || [];
    assert.ok(timer, 'expected timer for ' + ms);
    timers.delete(key);
    timer.callback();
  }
  function respond(rows, status = 200) {
    const request = scheduled.shift();
    assert.ok(request, 'expected REST request');
    request.resolve({ ok: status === 200, status, headers: new Map(), json: async () => rows });
    return new Promise(setImmediate);
  }
  return { context, $, document, timers, sockets, scheduled, fire, respond };
}

test('trade window orders and deduplicates, rejects gaps, and calculates rolling CVD', () => {
  const { context } = harness();
  const history = [fixture(0, 2), fixture(1, 1, true)];
  assert.equal(context.mergeTradeWindow(history, [fixture(3, 2, true)], 4), null);
  const window = context.mergeTradeWindow(history, [fixture(3, 2, true), fixture(2, 4), fixture(2, 4)], 4);
  assert.deepEqual(Array.from(window, trade => trade.id), [0, 1, 2, 3]);
  const { buy, sell, points } = context.summarizeTradeWindow(window);
  assert.deepEqual([buy, sell, ...points], [6, 3, 2, 1, 5, 3]);
  assert.deepEqual(Array.from(context.mergeTradeWindow(window, [fixture(4, 1)], 4), trade => trade.id), [1, 2, 3, 4]);
});

test('buffer joins a pending snapshot, detects a gap and recovers without double counting', async () => {
  const { context, $, sockets, fire, respond } = harness();
  context.loadTrades('BTCUSDT');
  assert.equal($('dCvd').textContent, '—');
  sockets[0].trade('BTCUSDT', 3, 2, true);
  sockets[0].trade('BTCUSDT', 2, 4);
  const row = (a, q, m) => ({ a, q, m, T: fixture(a).time });
  await respond([row(1, '1', true)]);
  await respond([row(0, '2', false), row(1, '1', true)]);
  assert.deepEqual(['buyVolume','sellVolume','dCvd'].map(id => $(id).textContent), ['6 BTC','3 BTC','+3 BTC']);
  sockets[0].trade('BTCUSDT', 5, 1);
  fire(150);
  assert.match($('flowStatus').textContent, /пропуск.*устарели/);
  assert.equal($('dCvd').textContent, '+3 BTC');
  assert.equal(sockets[0].closed, true);
  fire(1000);
  sockets[1].trade('BTCUSDT', 5, 1);
  await respond([row(4, '1', false)]);
  await respond([row(1, '1', true), row(2, '4', false), row(3, '2', true), row(4, '1', false)]);
  assert.equal($('dCvd').textContent, '+4 BTC');
  assert.match($('flowStatus').textContent, /LIVE/);
});

test('100 stop cycles cancel requests and timers, and old responses cannot update a new pair/window', async () => {
  const { context, $, document, timers, sockets, scheduled, respond } = harness();
  for (let index = 0; index < 100; index++) {
    context.loadTrades('BTCUSDT');
    const stale = sockets.at(-1).onmessage;
    context.stopTradeFlow();
    assert.equal(sockets.at(-1).closed, true);
    assert.equal(scheduled[0].options.signal.aborted, true);
    assert.equal(timers.size, 0);
    stale({ data: '{}' });
    await respond([]);
    assert.equal(timers.size, 0);
  }
  context.loadTrades('BTCUSDT');
  $('cvdWindow').value = '2';
  context.loadTrades('PEPEUSDT');
  await respond([]);
  assert.equal($('dCvd').textContent, '—');
  assert.match($('flowStatus').textContent, /PEPEUSDT · окно 2/);
  document.hidden = true;
  context.stopTradeFlow();
  const opened = sockets.length;
  context.loadTrades('PEPEUSDT');
  assert.equal(sockets.length, opened);
  assert.equal(timers.size, 0);
});

test('429 closes the stream and gates subsequent selections until Retry-After', async () => {
  const { context, $, sockets, scheduled, timers, respond } = harness();
  context.loadTrades('BTCUSDT');
  await respond([], 429);
  assert.equal(sockets[0].closed, true);
  assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].ms >= 29000);
  context.loadTrades('PEPEUSDT');
  assert.equal(sockets.length, 1);
  assert.equal(scheduled.length, 0);
  assert.match($('flowStatus').textContent, /лимит REST/);
  context.stopTradeFlow();
  assert.equal(timers.size, 0);
});
