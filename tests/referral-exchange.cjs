'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('where-to-trade page describes sources and distinguishes local counters from site-wide analytics', () => {
  const html = fs.readFileSync('where-to-trade.html', 'utf8');
  assert.match(html, /<h1>Где торговать<\/h1>/);
  assert.match(html, /data-bingx-placement="exchange"/);
  assert.match(html, /Зарегистрироваться на BingX/);
  assert.match(html, /https:\/\/bingx\.com\/en/);
  assert.match(html, /data-referral-counts/);
  assert.match(html, /не статистика всех посетителей/);
  assert.ok(!html.includes(require('../assets/config.js').REF_BINGX));
  const { renderDailyReport } = require('../scripts/render-daily-report.cjs');
  assert.ok(renderDailyReport({ date: '2026-11-17', text: 'test' }).includes('Обзор рынка за 2026-11-17'));
});
