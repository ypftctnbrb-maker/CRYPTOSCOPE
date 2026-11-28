import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupPriceBars, movingAverage } from '../assets/instrument-charts.mjs';

const row = (time, close = 10, volume = 2) => ({ time, open: 10, high: Math.max(11, close), low: 9, close, volume });

test('price rollup preserves OHLC and volume and skips gaps', () => {
  assert.deepEqual(groupPriceBars([row(0), row(300, 12), row(600, 11), row(900)], 15), [
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 6 },
    row(900),
  ]);
  assert.deepEqual(groupPriceBars([row(0), row(600), row(900)], 15), [row(900)]);
  assert.deepEqual(groupPriceBars([row(0), row(300, 11, null)], 15), [
    { time: 0, open: 10, high: 11, low: 9, close: 11, volume: null },
  ]);
});

test('moving average requires an uninterrupted window', () => {
  assert.deepEqual(movingAverage([row(0), row(300, 20), row(600, 30), row(1200)], 3), [
    { time: 600, value: 20 },
  ]);
});
