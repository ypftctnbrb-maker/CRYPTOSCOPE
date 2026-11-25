import assert from 'node:assert/strict';
import { tradeHistory } from '../assets/instrument-trades.mjs';

const time = 1800000000000;
const trade = (id, offset, quantity, side = 'Buy') => ({ id, time: time + offset, quantity, side });
const rows = tradeHistory([
  trade('b', 2, 5, 'Sell'), trade('a', 1, 3), trade('b', 2, 5, 'Sell'),
  trade('c', 3, 4), trade('d', 300000, 1, 'Sell'), trade('e', 900000, 4, 'Sell'),
]);
assert.deepEqual(rows.map(({ open, high, low, close }) => [open, high, low, close]),
  [[0, 3, -2, 2], [2, 2, 1, 1], [0, 0, -4, -4]]);

const { trackTradeSegments } = await import('../assets/instrument-trades.mjs');
const now = time + 300010;
let emit, result;
const clock = { Date: { now: () => now }, setTimeout: () => 1, clearTimeout() {} };
const stop = trackTradeSegments({
  streamTrades(callback) {
    emit = callback;
    return () => {};
  },
}, event => { result = event; }, clock);

emit([trade('start', 299996, 3), trade('later', 299999, 1)]);
emit([trade('rollover', 300001, 2)]);
emit([trade('late', 299998, 5, 'Sell')]);
assert.deepEqual(result.segment.bars.map(({ open, high, low, close }) => [open, high, low, close]),
  [[0, 3, -2, -1], [-1, 1, -1, 1]]);
assert.equal(result.segment.delta, 2);
assert.equal(result.segment.cumulative, 1);
stop();
console.log('PASS: historical and live OHLC, dedup, gaps, rollover and late trades');
