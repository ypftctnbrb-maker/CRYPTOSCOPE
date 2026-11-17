'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('every HTML page has a footer referral without a copied URL', () => {
  const { REF_BINGX } = require('../assets/config.js');
  for (const file of fs.readdirSync('.').filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    const footer = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/)?.[0] || '';
    assert.equal((footer.match(/data-bingx-placement="footer"/g) || []).length, 1, file);
    assert.ok(!html.includes(REF_BINGX), file);
  }
});
