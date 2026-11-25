import assert from 'node:assert/strict';
import { hyperliquidAdapter } from '../assets/hyperliquid-market.mjs';
import { bitfinexAdapter } from '../assets/bitfinex-market.mjs';
import { mexcAdapter } from '../assets/mexc-market.mjs';

assert.equal(typeof hyperliquidAdapter, 'function');
assert.equal(typeof bitfinexAdapter, 'function');
assert.equal(typeof mexcAdapter, 'function');

const { decodeMexc } = await import('../assets/mexc-protobuf.mjs');
const time = 1795619700000;
const hl = hyperliquidAdapter({ type: 'spot', id: '@129', base: 'MON', precision: { amount: 2 } },
  async (_url, _signal, body) => {
    if (body.type === 'candleSnapshot') {
      assert.equal(body.req.coin, '@129');
      return [{ s: '@129', i: '5m', t: time, o: '0.015', h: '0.017', l: '0.014', c: '0.016', v: '10' }];
    }
    assert.equal(body.coin, '@129');
    return [{ coin: '@129', tid: 12, time, px: '0.015', sz: '1', side: 'A' },
      { coin: '@43', tid: 13, time, px: '0.015', sz: '1', side: 'B' }];
  });
assert.equal((await hl.getCandles()).candles[0].close, 0.016);
assert.equal((await hl.getTrades()).trades[0].side, 'Sell');
assert.equal((await hl.getTrades()).trades.length, 1);
assert.equal((await hl.getOI()).value, null);
assert.equal(hl.priceStep, 0.000001);
const hlPerp = hyperliquidAdapter({ type: 'perp', id: 'xyz:XYZ', base: 'xyz:XYZ', precision: { amount: 2 } },
  async (_url, _signal, body) => {
    assert.equal(body.dex, 'xyz');
    return [{ universe: [{ name: 'xyz:OTHER' }, { name: 'xyz:XYZ' }] }, [{ openInterest: '99' }, { openInterest: '1', funding: '0' }]];
  });
assert.equal((await hlPerp.getOI()).value, 1);
assert.equal((await hlPerp.getFunding()).value, 0);

const bf = bitfinexAdapter({ type: 'perp', id: 'BTCF0:USTF0', base: 'BTC' }, async url => {
  if (url.includes('candles/')) return [[time, 50000, 50001, 50002, 49999, 8]];
  if (url.includes('trades/')) return [[1, time, -0.5, 50001], [1, time, -0.5, 50001]];
  assert.match(decodeURIComponent(url), /tBTCF0:USTF0/);
  const row = Array(23).fill(null);
  Object.assign(row, { 0: 'tBTCF0:USTF0', 1: time, 11: '-0.001', 17: '5' });
  return [row];
});
assert.equal((await bf.getCandles()).candles[0].high, 50002);
assert.deepEqual((await bf.getTrades()).trades, [{ id: '1', time, price: 50001, quantity: 0.5, side: 'Sell' }]);
assert.equal((await bf.getOI()).value, 5);
assert.equal((await bf.getFunding()).value, -0.001);

const mx = mexcAdapter({ type: 'perp', id: 'BTC_USDT', base: 'BTC', precision: { price: 0.1 } }, async url => {
  assert.match(url, /BTC_USDT/);
  const data = url.includes('/kline/') ? { time: [time / 1000], open: [50001], high: [50002], low: [50000], close: [50002], vol: [8] }
    : url.includes('/deals/') ? [{ i: '9007199254740993', t: time, p: 50001, v: 3, T: 1 }]
      : { symbol: 'BTC_USDT', holdVol: 11, fundingRate: 0.001, timestamp: time };
  return { success: true, code: 0, data };
});
assert.equal((await mx.getCandles()).candles[0].volume, 8);
assert.equal((await mx.getTrades()).trades[0].id, '9007199254740993');
assert.equal((await mx.getOI()).value, 11);
assert.equal((await mx.getFunding()).value, 0.001);
assert.equal(mx.priceStep, 0.1);
const spot = mexcAdapter({ type: 'spot', id: 'BTCUSDT', base: 'BTC', precision: { price: 2 } },
  async () => [{ id: null, time, price: '50001', qty: '3', isBuyerMaker: true }]);
assert.deepEqual((await spot.getTrades()).trades, []);

const captured = Buffer.from('0a2873706f74407075626c69632e6b6c696e652e76332e6170692e70624042544355534454404d696e351a07425443555344542220326662393432313534656634346134616232656639386338616662366134613728fbc99e9aa134a2134e0a044d696e3510f4f69bd8061a0735383030302e36220835373735302e36322a0735383030302e36320835373734342e39323a0a382e373132303835333142083530343237322e3448a0f99bd806', 'hex');
const channel = 'spot@public.kline.v3.api.pb@BTCUSDT@Min5';
const asArrayBuffer = bytes => Uint8Array.from(bytes).buffer;
assert.deepEqual(decodeMexc(asArrayBuffer(captured), channel, 'BTCUSDT').candle,
  [time, '58000.6', '58000.6', '57744.92', '57750.62', '8.71208531']);
assert.equal(decodeMexc(asArrayBuffer(captured), channel, 'ETHUSDT'), null);
assert.equal(decodeMexc(asArrayBuffer(captured.subarray(0, -1)), channel, 'BTCUSDT'), null);
console.log('PASS: Hyperliquid, Bitfinex, MEXC normalization, native IDs, dedup, and MEXC protobuf');
