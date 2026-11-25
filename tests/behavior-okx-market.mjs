import assert from 'node:assert/strict';
import { okxAdapter } from '../assets/okx-market.mjs';
import { tradeHistory } from '../assets/instrument-trades.mjs';

const market = { venue: 'okx', type: 'perp', id: 'BTC-USDT-SWAP', base: 'BTC', quote: 'USDT',
  contractSize: '0.01', contractSizeUnit: 'BTC', precision: { price: '0.1' } };
assert.equal(okxAdapter(market).volumeUnit, 'BTC');
assert.equal(tradeHistory([]).length, 0);

const now = 1800000000000;
const make = (id, ts, side = 'buy', instId = market.id) => ({ tradeId: id, ts: String(ts), side, instId, sz: '2', px: '61000' });
const urls = [];
const mock = okxAdapter(market, async raw => {
  const url = new URL(raw);
  urls.push(url);
  const data = {
    candles: [[String(now), '61000', '61001', '60999', '61000', '2']],
    'history-trades': [make('c', now + 900000), make('b', now + 300000, 'sell'), make('a', now),
      make('a', now), make('ignored', now, 'buy', 'ETH-USDT-SWAP')],
    'open-interest': [{ oiCcy: '1.25', ts: String(now) }],
    'funding-rate-history': [{ realizedRate: '-0.0001', fundingTime: String(now) }],
  };
  return { code: '0', data: data[url.pathname.split('/').at(-1)] };
});
const [candles, trades, oi, funding] = await Promise.all([mock.getCandles(), mock.getTrades(), mock.getOI(), mock.getFunding()]);
assert.ok(urls.every(url => url.searchParams.get('instId') === market.id));
assert.equal(candles.candles[0].volume, 0.02);
assert.equal(mock.priceStep, 0.1);
assert.equal(oi.value, 1.25);
assert.equal(funding.value, -0.0001);
assert.deepEqual(tradeHistory(trades.trades).map(({ delta, cumulative, segment }) => [delta, cumulative, segment]),
  [[0.02, 0.02, now], [-0.02, 0, now], [0.02, 0.02, now + 900000]]);

const inverse = { ...market, id: 'BTC-USD-SWAP', quote: 'USD', contractSize: '100', contractSizeUnit: 'USD' };
const inverseAdapter = okxAdapter(inverse, async () => ({ code: '0', data: [make('inverse', now, 'sell', inverse.id)] }));
assert.equal((await inverseAdapter.getTrades()).trades[0].quantity, 200);
assert.equal(inverseAdapter.volumeUnit, 'USD');
const spot = { ...market, type: 'spot', id: 'PEPE-USDT', base: 'PEPE', precision: { price: '0.00000001' } };
const spotAdapter = okxAdapter(spot, async () => ({ code: '0', data: [make('spot', now, 'buy', spot.id)] }));
assert.equal((await spotAdapter.getTrades()).trades[0].quantity, 2);
assert.equal(spotAdapter.priceStep, 0.00000001);
assert.equal((await spotAdapter.getFunding()).value, null);
assert.equal((await spotAdapter.getOI()).value, null);
const unknown = okxAdapter({ ...market, contractSize: null }, async () => ({ code: '0', data: [make('unknown', now)] }));
assert.deepEqual((await unknown.getTrades()).trades, []);
console.log('PASS: OKX native ID, spot/SWAP units, OI/funding, REST dedup and observed CVD segments');
