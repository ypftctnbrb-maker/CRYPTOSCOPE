'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');

const market = (venue, type, id, base = 'SAME', active = true) => ({ venue, type, id, base, quote: 'USD', active });
const complete = (...markets) => ({ scope: 'spot', status: 'complete', markets });

test('the application loads its own packaged venue catalogue and keeps instrument identity', async () => {
  assert.match(fs.readFileSync('index.html', 'utf8'), /href="\.\/instruments\.html"/);
  const { searchCatalogue } = await import('../assets/venue-catalogue.mjs');
  const venues = ['bybit', 'okx', 'bitfinex', 'hyperliquid', 'mexc'];
  const entries = Object.fromEntries(venues.map(venue => [venue, [complete(market(venue, 'spot', 'pair'))]]));
  entries.hyperliquid[0].markets.push(market('hyperliquid', 'spot', '@129'));
  entries.bybit.push({ ...complete(market('bybit', 'perp', 'pair')), scope: 'linear' });
  assert.equal(searchCatalogue(entries, 'same').total, 7);
  assert.equal(searchCatalogue(entries, '@129').markets[0].venue, 'hyperliquid');
});

test('partial refresh keeps cached coverage and a complete refresh removes deleted instruments', async () => {
  const { reconcileScopes, searchCatalogue } = await import('../assets/venue-catalogue.mjs');
  const oldMarket = market('bybit', 'spot', 'old');
  const newMarket = market('bybit', 'spot', 'new');
  const old = [{ ...complete(oldMarket), retrievedAt: 'old-time' }];
  const partial = reconcileScopes(old, [{ scope: 'spot', status: 'partial', markets: [newMarket] }], 'new-time');
  assert.equal(partial[0].retrievedAt, 'old-time');
  assert.equal(searchCatalogue({ bybit: partial }, 'same').total, 2);
  const refreshed = reconcileScopes(partial, [complete(newMarket)], 'final-time');
  assert.deepEqual(searchCatalogue({ bybit: refreshed }, 'same').markets.map(item => item.id), ['new']);
});

test('Bybit adapter uses native category and keeps missing metrics distinct from zero', async () => {
  const { bybitAdapter } = await import('../assets/bybit-market.mjs');
  const calls = [];
  const adapter = bybitAdapter({ ...market('bybit', 'perp', 'THINUSD'), inverse: true }, async url => {
    calls.push(new URL(url));
    return { time: 100, result: { list: [{ fundingRate: '0', openInterest: null, fundingRateTimestamp: '97' }] } };
  });
  assert.equal((await adapter.getFunding()).value, 0);
  assert.equal((await adapter.getOI()).value, null);
  assert.ok(calls.every(url => url.searchParams.get('category') === 'inverse' && url.searchParams.get('symbol') === 'THINUSD'));
});
