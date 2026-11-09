'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the production openCoin function and timeframe handler with deterministic
// market and DOM doubles. This tests state transitions without network access.
const source = fs.readFileSync('assets/app.js', 'utf8');
const openStart = source.indexOf('async function openCoin(');
const openEnd = source.indexOf('const researchCache=', openStart);
assert.ok(openStart >= 0 && openEnd > openStart, 'openCoin must exist');
const handlerStart = source.indexOf("$('timeframes').addEventListener('click',");
const handlerEnd = source.indexOf('\n', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'Timeframe handler must exist');

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '' });
  return elements.get(id);
};
let clickHandler;
const chartCalls = [];
const tradeCalls = [];
const metricRequests = [];
const context = {
  coins: [
    { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' },
    { id: 'unsupported', name: 'Unsupported', symbol: 'btc' },
  ],
  selectedCoinId: '', detailRequest: 0, chartSeq: 0, coinRequest: 0,
  chartSymbol: '', lastSpotSymbol: '', activeTf: '1h',
  verifiedPair: coin => coin.id === 'bitcoin' ? 'BTCUSDT' : '',
  displayPrice: () => 1, usd: String, compact: String, fmt: String,
  csText: text => text,
  getJson: async url => { metricRequests.push(url); return {}; },
  loadCandles: symbol => {
    context.chartSymbol = symbol;
    context.chartSeq++;
    chartCalls.push(symbol);
    element('nativeChart').hidden = false;
  },
  loadTrades: symbol => { context.coinRequest++; tradeCalls.push(symbol); },
  document: { querySelectorAll: () => [] },
  $: id => id === 'timeframes'
    ? { addEventListener: (type, handler) => { clickHandler = handler; } }
    : element(id),
};
vm.createContext(context);
vm.runInContext(source.slice(openStart, openEnd), context);
vm.runInContext(source.slice(handlerStart, handlerEnd), context);
const clickTimeframe = tf => clickHandler({
  target: { closest: () => ({ dataset: { tf } }) },
});

(async () => {
  await context.openCoin('bitcoin');
  assert.deepEqual(chartCalls, ['BTCUSDT'], 'Supported coin must load its chart');
  assert.deepEqual(tradeCalls, ['BTCUSDT'], 'Supported coin must load its trades');
  clickTimeframe('4h');
  assert.equal(chartCalls.length, 2, 'Supported timeframe must reload candles');
  const chartSeq = context.chartSeq;
  const coinRequest = context.coinRequest;
  const requests = metricRequests.length;

  await context.openCoin('unsupported');
  assert.equal(context.chartSymbol, '', 'Unsupported coin must clear previous symbol');
  assert.equal(context.lastSpotSymbol, '', 'Unsupported coin must clear previous spot symbol');
  assert.equal(context.chartSeq, chartSeq + 1, 'Unsupported coin must invalidate pending candles');
  assert.equal(context.coinRequest, coinRequest + 1, 'Unsupported coin must invalidate pending trades');
  assert.equal(metricRequests.length, requests, 'Unsupported coin must not request derivatives');
  assert.equal(element('nativeChart').hidden, true, 'Unsupported coin must hide native chart');
  assert.equal(element('detailChart').hidden, true, 'Unsupported coin must hide fallback chart');
  for (const tf of ['5m', '15m', '1h', '4h', '1d', '1w']) clickTimeframe(tf);
  assert.equal(chartCalls.length, 2, 'Timeframes must not load previous coin candles');
  assert.equal(element('nativeChart').hidden, true, 'Timeframes must keep unsupported chart hidden');

  await context.openCoin('bitcoin');
  assert.equal(chartCalls.length, 3, 'Returning to supported coin must load candles');
  assert.equal(tradeCalls.length, 2, 'Returning to supported coin must load trades');
  assert.equal(element('nativeChart').hidden, false, 'Supported chart must be visible again');
  console.log('PASS: supported -> unsupported -> all timeframes -> supported');
})().catch(error => { console.error(error); process.exitCode = 1; });
