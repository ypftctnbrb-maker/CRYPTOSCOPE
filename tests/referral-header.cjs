'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('every HTML page has one clearly labelled header referral slot inside header', () => {
  for (const file of fs.readdirSync('.').filter(file => file.endsWith('.html'))) {
    const header = fs.readFileSync(file, 'utf8').match(/<header>[\s\S]*?<\/header>/)?.[0] || '';
    assert.equal((header.match(/data-bingx-placement="header"/g) || []).length, 1, file);
    assert.match(header, /data-bingx-label="Торговать на BingX"/);
  }
});
