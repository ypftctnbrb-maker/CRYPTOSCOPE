import assert from 'node:assert/strict';
import { bybitAdapter } from '../assets/bybit-market.mjs';

const adapter = bybitAdapter({ venue: 'bybit', type: 'spot', id: 'BTCUSDT',
  base: 'BTC', quote: 'USDT', precision: { price: '0.01' } });
assert.equal(typeof adapter.streamTrades, 'function', 'Bybit needs a realtime trade stream');

const { trackTradeSegments } = await import('../assets/instrument-trades.mjs');
let now = 3000000;
const timers = new Map();
let sequence = 0;
const clock = {
  Date: { now: () => now },
  setTimeout(callback, delay) {
    timers.set(++sequence, { callback, at: now + delay });
    return sequence;
  },
  clearTimeout(id) { timers.delete(id); },
};
function advance(at) {
  while (true) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > at) break;
    timers.delete(next[0]);
    now = next[1].at;
    next[1].callback();
  }
  now = at;
}
let trades, disconnect, closed = 0;
const events = [];
const stop = trackTradeSegments({
  streamTrades(onTrades, onDisconnect) {
    trades = onTrades;
    disconnect = onDisconnect;
    return () => { closed++; };
  },
}, event => events.push(structuredClone(event)), clock);
const sample = (id, quantity, side, time = now) => ({ id, quantity, side, time });
const first = sample('a', 3, 'Buy');
trades([first, first, sample('b', 1, 'Sell')]);
assert.equal(events.at(-1).segment.delta, 2);
const oldTrades = trades;
advance(now + 14999);
trades([first]); // A replay cannot keep the stream live.
assert.equal(events.at(-1).state, 'live');
advance(now + 1);
assert.equal(events.at(-1).state, 'stale');
assert.equal(closed, 1);
advance(now + 1000);
assert.equal(events.at(-1).state, 'waiting');
oldTrades([sample('old', 500, 'Buy')]);
assert.equal(events.at(-1).state, 'waiting');
trades([sample('too-old', 500, 'Buy', now - 15000), sample('c', 4, 'Sell')]);
assert.equal(events.at(-1).segment.cumulative, -4);
assert.equal(events.at(-1).segment.delta, -4);
for (let index = 0; index < 19; index++) {
  advance(now + 14200);
  trades([sample('tick-' + index, 1, 'Buy')]);
}
const lastBucket = events.at(-1).segment.candle;
const lastStart = events.at(-1).segment.start;
advance(lastBucket + 300000 - 1);
trades([sample("closing", 1, "Buy")]);
advance(lastBucket + 300000);
trades([sample('rollover', 2, 'Sell')]);
assert.equal(events.at(-1).segment.delta, -2);
assert.equal(events.at(-1).segment.cumulative, 14);
assert.equal(events.at(-1).segment.start, lastStart);
disconnect();
assert.equal(events.at(-1).state, 'stale');
stop();
assert.equal(timers.size, 0);

for (const [instrument, category, unit, step] of [
  [{ type: 'spot', id: 'BTCUSDT', base: 'BTC', quote: 'USDT', precision: { price: '0.01' } }, 'spot', 'BTC', 0.01],
  [{ type: 'perp', id: 'XDCUSDT', base: 'XDC', quote: 'USDT', precision: { price: '0.00001' } }, 'linear', 'XDC', 0.00001],
  [{ type: 'perp', id: 'NEARUSD', inverse: true, base: 'NEAR', quote: 'USD', precision: { price: '0.001' } }, 'inverse', 'USD', 0.001],
]) {
  const market = bybitAdapter({ venue: 'bybit', ...instrument });
  assert.deepEqual([market.category, market.volumeUnit, market.priceStep], [category, unit, step]);
}
console.log('PASS: deduplication, aggressor side, 15-second expiry, reconnect, late callback cleanup and spot/perpetual units');

const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(null, { status: 429, headers: { 'Retry-After': '900000' } });
  };
  const started = Date.now();
  await assert.rejects(adapter.getCandles(), error =>
    error.retryAt >= started + 30000 && error.retryAt <= Date.now() + 120000);
  await assert.rejects(adapter.getTrades(), error => error.retryAt > Date.now());
  assert.equal(requests, 1);
  assert.equal((await adapter.getOI()).value, null);
  // Spot OI is inapplicable and does not issue a REST request.
} finally {
  globalThis.fetch = originalFetch;
}
