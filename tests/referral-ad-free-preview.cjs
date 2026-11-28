'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const advertising = /bingx|referral|A7WGNX|googletagmanager|google-analytics|\bgtag\s*\(|\bfbq\s*\(/i;

test('4.0 dashboard source has no advertising, referral slots or tracking integrations', () => {
  assert.doesNotMatch(fs.readFileSync('instruments.html', 'utf8'), advertising);
});

test('dashboard PREVIEW artifact excludes legacy entry points, advertising and tracking', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-adfree-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'preview');
  // Exercise the same committed-source packaging command used for the preview.
  const result = spawnSync('bash', ['scripts/prepare-preview.sh', output, 'HEAD', '--dashboard'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const file of ['about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html', 'reports',
    'assets/app.js', 'assets/config.js', 'assets/information.css', 'assets/styles.css',
    'assets/referrals.js', 'assets/referrals.css', 'assets/referral-market.js']) {
    assert.equal(fs.existsSync(path.join(output, file)), false, file + ' must not enter the preview');
  }
  for (const file of fs.readdirSync(output, { recursive: true })) {
    if (!/\.(?:html|js|mjs|css)$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(output, file), 'utf8'), advertising, file);
  }
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /data-default-market/);
  assert.match(html, /CRYPTOSCOPE PREVIEW/);
  assert.match(html, /id="instrument-sphere"/);
  assert.match(html, /id="instrument-chart"/);
  assert.match(html, /id="instrument-cvd-chart"/);
});
