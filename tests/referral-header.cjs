'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
// Legacy production pages retain their existing contract; the 4.0 preview is ad-free.
const legacyPages = ['index.html', 'about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html'];
test('every legacy production HTML page has one clearly labelled header referral slot inside header', () => {
  for (const file of legacyPages) {
    const header = fs.readFileSync(file, 'utf8').match(/<header>[\s\S]*?<\/header>/)?.[0] || '';
    assert.equal((header.match(/data-bingx-placement="header"/g) || []).length, 1, file);
    assert.match(header, /data-bingx-label="Торговать на BingX"/);
  }
});
