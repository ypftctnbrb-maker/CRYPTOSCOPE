'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('both market tables opt into trading links and observe re-renders without duplicating cells', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="major" data-bingx-table/);
  assert.match(html, /id="small" data-bingx-table/);
  const { watchTables } = require('../assets/referral-market.js');
  let update, count = 0;
  const row = { cell: null, querySelector() { return this.cell; }, appendChild(cell) { this.cell = cell; } };
  const body = { querySelectorAll: () => [row] };
  const doc = { querySelectorAll: () => [body], createElement: () => ({ dataset: {} }) };
  class Observer { constructor(fn) { update = fn; } observe(node, options) { assert.equal(options.subtree, undefined); } }
  watchTables(doc, Observer, { mount: (cell, place) => { count++; assert.equal(place, 'table'); } });
  update(); update();
  assert.equal(count, 1);
});
