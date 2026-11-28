'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
// Legacy production pages retain their existing contract; the 4.0 preview is ad-free.
const legacyPages = ['index.html', 'about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html'];
test('mobile dock is dismissible for this session and does not count closing as a click', () => {
  const { installMobile } = require('../assets/referrals.js');
  const flags = new Map(), classes = new Set(); let close, change;
  const panel = { hidden: true }, button = { addEventListener: (type, fn) => { close = fn; } };
  const document = { getElementById: id => id === 'bingxMobile' ? panel : button,
    body: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } } };
  const media = { matches: true, addEventListener: (type, fn) => { change = fn; } };
  const host = { matchMedia: () => media, sessionStorage: { getItem: k => flags.get(k), setItem: (k, v) => flags.set(k, v) } };
  installMobile(document, host);
  assert.equal(panel.hidden, false); assert.ok(classes.has('referral-dock-open'));
  close(); assert.equal(panel.hidden, true); assert.equal(classes.size, 0);
  change(); assert.equal(panel.hidden, true);
  for (const file of legacyPages) {
    assert.match(fs.readFileSync(file, 'utf8'), /id="bingxMobileClose"/);
  }
});
