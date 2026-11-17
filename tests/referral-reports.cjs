'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
test('daily report preserves literal dollar sequences without duplicating page markup', () => {
  const { renderDailyReport } = require('../scripts/render-daily-report.cjs');
  for (const text of ['$&', '$`', "$'", '$$', 'BTC $100 · $& $$ $` <b>текст</b>']) {
    const html = renderDailyReport({ date: '2026-11-17', text });
    const escaped = text.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
    assert.ok(html.includes('<article><p>' + escaped + '</p></article>'), 'literal report text: ' + text);
    assert.equal((html.match(/<main\b/g) || []).length, 1, 'one main element: ' + text);
    assert.equal((html.match(/data-bingx-placement="report-top"/g) || []).length, 1);
    assert.equal((html.match(/data-bingx-placement="report-bottom"/g) || []).length, 1);
    assert.equal((html.match(/<footer>/g) || []).length, 1);
  }
});
test('daily report template escapes content and adds top/bottom disclosed referral slots', () => {
  const { renderDailyReport } = require('../scripts/render-daily-report.cjs');
  const html = renderDailyReport({ date: '2026-11-17', text: '<script>bad()</script>\nИсточник: тестовые данные' });
  assert.match(html, /data-bingx-placement="report-top"/);
  assert.match(html, /data-bingx-placement="report-bottom"/);
  assert.ok(html.indexOf('report-top') < html.indexOf('bad()'));
  assert.ok(html.indexOf('report-bottom') > html.indexOf('bad()'));
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(html.includes('../assets/config.js'));
  assert.throws(() => renderDailyReport({ date: '2026-02-31', text: 'x' }), /date/);
  assert.throws(() => renderDailyReport({ date: '2026-11-17', text: '' }), /text/);
});
test('publication copies only dated report HTML, not inputs or arbitrary files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-report-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-report-out-'));
  t.after(() => [root, out].forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
  for (const file of fs.readdirSync('.').filter(file => file.endsWith('.html'))) fs.copyFileSync(file, path.join(root, file));
  fs.cpSync('assets', path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports/2026-11-17.html'), '<html>report</html>');
  fs.writeFileSync(path.join(root, 'reports/private-input.json'), '{"private":true}');
  require('../scripts/prepare-public.cjs').preparePublic(root, out);
  assert.deepEqual(fs.readdirSync(path.join(out, 'reports')), ['2026-11-17.html']);
});
