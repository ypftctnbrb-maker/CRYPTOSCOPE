import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bybit, collect, inventory, request, instrument } from './discovery.mjs';

test('Bybit follows cursors, isolates spot failure and deduplicates without collapsing market types', async () => {
  const row = { symbol: 'ABCUSDT', baseCoin: 'ABC', quoteCoin: 'USDT', settleCoin: 'USDT',
    status: 'Trading', contractType: 'LinearPerpetual', priceFilter: { tickSize: '0.01' } };
  const seen = [];
  const results = await bybit(async url => {
    const params = new URL(url).searchParams;
    const category = params.get('category');
    const cursor = params.get('cursor');
    seen.push([category, cursor]);
    if (category === 'spot') throw Error('HTTP 503');
    if (category === 'inverse') return { retCode: 0, result: { list: [] } };
    return { retCode: 0, result: { list: cursor ? [row, { ...row, symbol: 'OLD', status: 'Settled' }] : [row],
      nextPageCursor: cursor ? '' : 'next' } };
  });
  assert.ok(seen.some(([category, cursor]) => category === 'linear' && cursor === 'next'));
  assert.equal(results.find(result => result.scope === 'spot').status, 'unavailable');
  const linear = results.find(result => result.scope === 'linear');
  assert.equal(linear.status, 'complete');
  assert.equal(linear.duplicateCount, 1);
  assert.equal(linear.count, 1);
  assert.equal(linear.markets[0].precision.price, '0.01');

  const source = 'fixture';
  const rows = [instrument(source, 'spot', 'A1', { base: 'ABC', active: true }),
    instrument(source, 'spot', 'A2', { base: 'ABC', active: true }),
    instrument(source, 'perp', 'A1', { base: 'ABC', active: true })];
  assert.equal(inventory('all', rows).count, 3);
});

test('partial pagination retains affirmative rows and never reports a complete count', async () => {
  const row = instrument('fixture', 'spot', 'A1', { active: true });
  const result = await collect('spot', async cursor => {
    if (cursor) throw Error('HTTP 503');
    return { rows: [row], next: 'next' };
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.count, null);
  assert.deepEqual(result.markets, [row]);
  const repeated = await collect('spot', async () => ({ rows: [row], next: 'loop' }));
  assert.equal(repeated.status, 'partial');
  assert.match(repeated.error, /cursor/);
  assert.equal(inventory('spot', [instrument('fixture', 'spot', 'unknown')]).count, null);
});

test('429 retries once using Retry-After, with no third request', async () => {
  const delays = [];
  const evidence = [];
  let calls = 0;
  const json = request(evidence, {
    fetch: async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }); },
    sleep: async time => { delays.push(time); },
  });
  await assert.rejects(json('https://example.test'), /429/);
  assert.deepEqual([calls, ...delays], [2, 1000]);
  assert.deepEqual(evidence.map(entry => entry.http), [429, 429]);
});

test('Hyperliquid preserves token identity and separates each builder DEX', async () => {
  const { venues } = await import('./venues.mjs');
  const result = await venues.hyperliquid(async (_, body) => {
    if (body.type === 'spotMeta') return {
      tokens: [{ index: 0, name: 'USDC', tokenId: 'quote' },
        { index: 1, name: 'SAME', tokenId: 'a' }, { index: 2, name: 'SAME', tokenId: 'b' }],
      universe: [{ index: 10, tokens: [1, 0] }, { index: 11, tokens: [2, 0] }],
    };
    if (body.type === 'perpDexs') return [null, { name: 'dex1' }, { name: 'dex2' }];
    if (body.dex === 'dex2') throw Error('HTTP 503');
    return { collateralToken: 0, universe: [
      { name: body.dex ? 'dex1:SAME' : 'SAME', szDecimals: 3 },
      { name: 'OLD', isDelisted: true },
    ] };
  });
  assert.deepEqual(result.map(scope => [scope.scope, scope.count]),
    [['spot', 2], ['perp', 1], ['perp:dex1', 1], ['perp:dex2', null]]);
  assert.deepEqual(result[0].markets.map(market => [market.id, market.base, ...market.assetIds]),
    [['@10', 'SAME', 'a', 'quote'], ['@11', 'SAME', 'b', 'quote']]);
  assert.equal(result[2].markets[0].settle, 'USDC');
});
