'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
test('publication refreshes asset hashes in existing reports after runtime changes without changing report content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-existing-report-'));
  const outputs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-report-artifact-')));
  t.after(() => [root, ...outputs].forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
  for (const file of fs.readdirSync('.').filter(file => file.endsWith('.html'))) fs.copyFileSync(file, path.join(root, file));
  fs.cpSync('assets', path.join(root, 'assets'), { recursive: true });
  const { renderDailyReport } = require('../scripts/render-daily-report.cjs');
  const date = '2026-11-17', text = 'BTC $100 · $& $$ <b>исходный текст</b>';
  let report = renderDailyReport({ date, text });
  report = report.replace('</head>', '<link rel="stylesheet" href="https://example.invalid/style.css?v=keep"></head>');
  fs.mkdirSync(path.join(root, 'reports'));
  const original = path.join(root, 'reports/' + date + '.html');
  fs.writeFileSync(original, report);
  for (const file of ['config.js', 'referrals.js', 'information.css', 'referrals.css']) {
    fs.appendFileSync(path.join(root, 'assets', file), '\n/* changed after the report was generated */\n');
  }
  const { preparePublic } = require('../scripts/prepare-public.cjs');
  for (const out of outputs) preparePublic(root, out);
  const published = fs.readFileSync(path.join(outputs[0], 'reports/' + date + '.html'), 'utf8');
  const refs = [...published.matchAll(/(?:src|href)="\.\.\/(assets\/[\w.-]+)\?v=([0-9a-f]{12})"/g)];
  assert.ok(refs.length >= 4);
  for (const [, file, version] of refs) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(outputs[0], file))).digest('hex').slice(0, 12);
    assert.equal(version, digest, file + ' must match the published bytes');
  }
  assert.equal(fs.readFileSync(original, 'utf8'), report, 'packaging does not rewrite report sources');
  assert.equal(published.match(/<article>[\s\S]*?<\/article>/)[0], report.match(/<article>[\s\S]*?<\/article>/)[0]);
  assert.ok(published.includes('Обзор рынка · ' + date));
  assert.ok(published.includes('https://example.invalid/style.css?v=keep'));
  assert.equal(published, fs.readFileSync(path.join(outputs[1], 'reports/' + date + '.html'), 'utf8'), 'deterministic output');
});
test('report packaging preserves every byte outside rewritten asset URLs including invalid UTF-8', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-byte-report-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-byte-artifact-'));
  t.after(() => [root, out].forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
  for (const file of fs.readdirSync('.').filter(file => file.endsWith('.html'))) fs.copyFileSync(file, path.join(root, file));
  fs.cpSync('assets', path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'));
  const prefix = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<html>\r\n<head>')]);
  const reference = '<script src="../assets/config.js?v=old"></script>';
  const suffix = Buffer.concat([Buffer.from('</head>\r\n<article>Цена $& $$ <b>текст</b> '),
    Buffer.from([0x80, 0xc3, 0x28, 0xff]), Buffer.from('</article>\r\n</html>')]);
  const input = Buffer.concat([prefix, Buffer.from(reference), suffix]);
  const file = 'reports/2026-11-18.html';
  fs.writeFileSync(path.join(root, file), input);
  require('../scripts/prepare-public.cjs').preparePublic(root, out);
  const digest = createHash('sha256').update(fs.readFileSync(path.join(out, 'assets/config.js'))).digest('hex').slice(0, 12);
  const expected = Buffer.concat([prefix, Buffer.from(reference.replace('v=old', 'v=' + digest)), suffix]);
  assert.deepEqual(fs.readFileSync(path.join(out, file)), expected, 'only the ASCII asset version changes');
  assert.deepEqual(fs.readFileSync(path.join(root, file)), input, 'source bytes remain untouched');
});
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

test('report resource guard rejects an empty resource list instead of passing without checks', () => {
  const { assertReportAssets } = require('./helpers/report-assets.cjs');
  assert.throws(() => assertReportAssets([], process.cwd()), assert.AssertionError);
});
test('report resource guard rejects missing versions and missing required resources', () => {
  const { assertReportAssets } = require('./helpers/report-assets.cjs');
  const html = require('../scripts/render-daily-report.cjs').renderDailyReport({ date: '2026-11-18', text: 'ТЕСТ' });
  const refs = [...html.matchAll(/(?:src|href)="(\.\.\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert.equal(assertReportAssets(refs, process.cwd()), 4, 'control fixture checks all four assets');
  for (let i = 0; i < refs.length; i++) {
    const unversioned = refs.map((ref, n) => n === i ? ref.replace(/\?v=.+$/, '') : ref);
    assert.throws(() => assertReportAssets(unversioned, process.cwd()), assert.AssertionError, 'missing ?v= must fail');
    assert.throws(() => assertReportAssets(refs.filter((_, n) => n !== i), process.cwd()), assert.AssertionError,
      'missing required resource must fail');
  }
});
test('report resource guard skips empty DOM attributes while still checking all required assets', () => {
  const { assertReportAssets } = require('./helpers/report-assets.cjs');
  const html = require('../scripts/render-daily-report.cjs').renderDailyReport({ date: '2026-11-18', text: 'ТЕСТ' });
  const refs = [...html.matchAll(/(?:src|href)="(\.\.\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert.equal(assertReportAssets([null, '', undefined, 42, ...refs], process.cwd()), 4);
});
test('report resource guard explains missing assets with AssertionError for an empty DOM attribute', () => {
  const { assertReportAssets } = require('./helpers/report-assets.cjs');
  assert.throws(() => assertReportAssets([null], process.cwd()), assert.AssertionError);
});
