'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/app.js', 'utf8');

function browser() {
  let now = 1000000, timerId = 0, throwSocket = false;
  const timers = new Map(), elements = new Map(), listeners = new Map(), sockets = [];
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', hidden: true, textContent: '', title: '', dataset: {},
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
          contains: name => classes.has(name),
        },
        addEventListener() {}, querySelectorAll: () => [], setAttribute() {},
      });
    }
    return elements.get(id);
  };
  const document = {
    hidden: false, documentElement: {}, getElementById: element, querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.set(type, fn),
  };
  class Socket {
    constructor() {
      if (throwSocket) throw Error('WebSocket construction failed');
      this.readyState = 0;
      this.closed = 0;
      sockets.push(this);
    }
    open() { this.readyState = 1; this.onopen(); }
    sendTicks(ticks) { this.onmessage({ data: JSON.stringify(ticks) }); }
    close() { this.closed++; this.readyState = 3; this.onclose?.(); }
  }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const schedule = (fn, delay, repeat = 0) => {
    const id = ++timerId;
    timers.set(id, { fn, at: now + delay, repeat });
    return id;
  };
  const context = {
    document, window: {}, Date: ClockDate, Intl, WebSocket: Socket, AbortController,
    console: { warn() {} }, localStorage: { getItem: () => null },
    fetch: () => new Promise(() => {}),
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay),
  };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 1000 });
  vm.runInContext("coins=[{id:'bitcoin',current_price:50},{id:'ethereum',current_price:5}];", context);
  const row = { dataset: { id: 'bitcoin' }, cells: [element('coinCell'), element('priceCell')] };
  element('major').querySelectorAll = () => [row];
  vm.runInContext("selectedCoinId='bitcoin'", context);
  function advance(ms) {
    const end = now + ms;
    for (let count = 0; count < 1000; count++) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = end; return; }
      const [id, timer] = next;
      now = timer.at;
      if (timer.repeat) timer.at += timer.repeat;
      else timers.delete(id);
      timer.fn();
    }
    throw Error('Timer loop did not settle');
  }
  return {
    sockets, element, advance, run: code => vm.runInContext(code, context),
    connected: () => element('liveStatus').classList.contains('connected'),
    hidden(value) { document.hidden = value; listeners.get('visibilitychange')(); },
    failConstructor(value) { throwSocket = value; },
  };
}

const tests = {
  'open waits for a valid quote': () => {
    const b = browser();
    b.sockets[0].open();
    assert.equal(b.connected(), false, 'Opening a socket must not report live prices');
    b.sockets[0].sendTicks([{ s: 'BTCUSDT', c: '100' }]);
    assert.equal(b.connected(), true);
    b.advance(500);
    assert.equal(b.element('btc').textContent, '$100');
    assert.equal(b.element('priceCell').classList.contains('live-price'), true);
    assert.equal(b.element('dPrice').textContent, '$100');
  },
  'silent open socket reconnects': () => {
    const b = browser();
    b.sockets[0].open();
    b.advance(15000);
    assert.equal(b.sockets[0].closed, 1, 'No first quote must close the silent socket');
    assert.equal(b.connected(), false);
    b.advance(1000);
    assert.equal(b.sockets.length, 2);
  },
  'stalled handshake reconnects': () => {
    const b = browser();
    b.advance(16000);
    assert.equal(b.sockets[0].closed, 1);
    assert.equal(b.sockets.length, 2);
  },
  'fresh ETH does not revive stale BTC': () => {
    const b = browser(), socket = b.sockets[0];
    socket.open();
    socket.sendTicks([{ s: 'BTCUSDT', c: '100' }, { s: 'ETHUSDT', c: '10' }]);
    b.advance(14000);
    socket.sendTicks([{ s: 'ETHUSDT', c: '11' }]);
    b.advance(1000);
    assert.equal(b.run('displayPrice(coins[0])'), 50, 'BTC must use CoinGecko at 15 seconds');
    assert.equal(b.run('displayPrice(coins[1])'), 11);
    assert.equal(b.element('btc').textContent, '$50', 'Visible BTC must also expire');
    assert.equal(b.element('priceCell').textContent, '$50');
    assert.equal(b.element('priceCell').classList.contains('live-price'), false);
    assert.match(b.element('priceCell').title, /CoinGecko/);
    assert.equal(b.element('dPrice').textContent, '$50');
    assert.match(b.element('dPrice').title, /CoinGecko/);
    assert.equal(b.connected(), true, 'ETH quotes keep the connection healthy');
  },
  'dead stream falls back and ignores old callbacks': () => {
    const b = browser(), socket = b.sockets[0];
    socket.open();
    socket.sendTicks([{ s: 'BTCUSDT', c: '100' }]);
    b.advance(15000);
    assert.equal(b.connected(), false);
    assert.equal(b.element('btc').textContent, '$50');
    assert.equal(socket.closed, 1);
    b.advance(1000);
    socket.sendTicks([{ s: 'BTCUSDT', c: '999' }]);
    assert.equal(b.run('displayPrice(coins[0])'), 50);
    b.sockets[1].open();
    b.sockets[1].sendTicks([{ s: 'ETHUSDT', c: '11' }]);
    assert.equal(b.run('displayPrice(coins[0])'), 50);
  },
  'invalid or unrelated messages do not keep stream alive': () => {
    const b = browser(), socket = b.sockets[0];
    socket.open();
    socket.onmessage({ data: 'bad JSON' });
    socket.sendTicks([null, {}, { s: 'BTCUSDT', c: 'NaN' }, { s: 'BTCUSDT', c: '-1' }]);
    socket.sendTicks([{ s: 'UNKNOWNUSDT', c: '123' }]);
    assert.equal(b.connected(), false);
    b.advance(15000);
    assert.equal(socket.closed, 1);
  },
  'error closes once and retries with backoff': () => {
    const b = browser(), socket = b.sockets[0];
    socket.open();
    socket.sendTicks([{ s: 'BTCUSDT', c: '100' }]);
    socket.onerror();
    assert.equal(b.connected(), false);
    assert.equal(b.run('displayPrice(coins[0])'), 50);
    assert.equal(socket.closed, 1);
    b.advance(1000);
    assert.equal(b.sockets.length, 2);
    b.sockets[1].onerror();
    b.advance(1999);
    assert.equal(b.sockets.length, 2);
    b.advance(1);
    assert.equal(b.sockets.length, 3);
  },
  'hidden tab cancels retries and resumes without old quotes': () => {
    const b = browser(), socket = b.sockets[0];
    socket.open();
    socket.sendTicks([{ s: 'BTCUSDT', c: '100' }]);
    b.hidden(true);
    assert.equal(b.connected(), false);
    b.advance(30000);
    assert.equal(b.sockets.length, 1);
    b.hidden(false);
    assert.equal(b.sockets.length, 2);
    b.sockets[1].open();
    assert.equal(b.connected(), false);
    assert.equal(b.run('displayPrice(coins[0])'), 50);
    b.sockets[1].onerror();
    b.hidden(true);
    b.advance(30000);
    assert.equal(b.sockets.length, 2, 'Hidden tab must cancel an already scheduled retry');
  },
  'constructor failures retry with backoff': () => {
    const b = browser();
    b.failConstructor(true);
    b.sockets[0].onerror();
    b.advance(1000);
    assert.equal(b.sockets.length, 1);
    b.failConstructor(false);
    b.advance(1999);
    assert.equal(b.sockets.length, 1);
    b.advance(1);
    assert.equal(b.sockets.length, 2);
  },
};
let failures = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('PASS: ' + name); }
  catch (error) { failures++; console.error('FAIL: ' + name + ': ' + error.message); }
}
assert.equal(failures, 0, failures + ' live behavior tests failed');
