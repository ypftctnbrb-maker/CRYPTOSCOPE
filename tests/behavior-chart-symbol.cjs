'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the real unverified-pair branch and timeframe handler from app.js.
// No network, browser, or charting library is required.
const source = fs.readFileSync('assets/app.js', 'utf8');
const start = source.indexOf('if(!symbol){lastSpotSymbol=');
const end = source.indexOf('return}', start);
assert.ok(start >= 0 && end > start, 'Unverified-pair branch must exist');
const branch = source.slice(start, end + 'return}'.length);
const handlerStart = source.indexOf("$('timeframes').addEventListener('click',");
const handlerEnd = source.indexOf('});', handlerStart) + 2;
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'Timeframe handler must exist');
const handler = source.slice(handlerStart, handlerEnd + 1);

const elements = new Map();
const $ = id => {
  if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '' });
  return elements.get(id);
};
let clickHandler;
const calls = [];
const context = {
  $, chartSymbol: 'BTCUSDT', chartSeq: 0, coinRequest: 0,
  lastSpotSymbol: 'BTCUSDT', activeTf: '1h',
  csText: x => x, loadCandles: symbol => {
    calls.push(symbol);
    $('nativeChart').hidden = false;
  },
  document: { querySelectorAll: () => [] },
};
context.$ = id => id === 'timeframes'
  ? { addEventListener: (type, fn) => { clickHandler = fn; } }
  : $(id);
vm.createContext(context);
vm.runInContext(handler, context);
vm.runInContext('(function(){' + branch + '})()', context);
assert.equal($('nativeChart').hidden, true, 'Unsupported coin must hide native chart');
clickHandler({
  target: { closest: () => ({
    dataset: { tf: '4h' },
    classList: { toggle: () => {} },
  }) },
});
assert.equal(context.chartSymbol, '', 'Unsupported coin must clear previous symbol');
assert.deepEqual(calls, [], 'Timeframe click must not load previous coin candles');
assert.equal($('nativeChart').hidden, true, 'Timeframe click must keep chart hidden');
console.log('PASS: unsupported coin cannot resurrect previous chart');
