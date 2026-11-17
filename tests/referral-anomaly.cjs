'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('anomaly CTA is available only for an explicitly confirmed OI/funding/CVD event', () => {
  const { signalBlock } = require('../assets/referral-market.js');
  const { block } = require('../assets/referrals.js');
  for (const kind of ['oi', 'funding', 'cvd']) {
    assert.equal(signalBlock(kind, false, block), '');
    const html = signalBlock(kind, true, block);
    assert.ok(html.includes('data-placement="signal-' + kind + '"'));
    assert.ok(html.includes('Торговать этот сигнал на BingX'));
    assert.ok(html.includes('Реферальная ссылка'));
  }
  assert.equal(signalBlock('unknown', true, block), '');
});
