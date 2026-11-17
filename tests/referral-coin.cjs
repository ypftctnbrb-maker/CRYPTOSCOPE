'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('coin referral sits below the chart and follows the visible coin after a selection change', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="chartStatus"[\s\S]*?id="coinReferral"[\s\S]*?class="detailgrid"/);
  const { watchCoin } = require('../assets/referral-market.js');
  let update;
  const name = { textContent: 'Bitcoin (BTC)' }, slot = { dataset: {} }, rendered = [];
  const document = { getElementById: id => id === 'detailName' ? name : id === 'coinReferral' ? slot : null };
  class Observer { constructor(fn) { update = fn; } observe() {} }
  watchCoin(document, Observer, { mount: (...args) => rendered.push(args) });
  name.textContent = 'Ethereum (ETH)'; update();
  assert.deepEqual(rendered.map(args => args.slice(1)), [['coin', 'Открыть Bitcoin (BTC) на BingX'],
    ['coin', 'Открыть Ethereum (ETH) на BingX']]);
});
