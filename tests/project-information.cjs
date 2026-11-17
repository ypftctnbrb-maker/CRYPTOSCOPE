'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const pages = ['index.html', 'about.html', 'methodology.html', 'disclaimer.html'];
const expectedFiles = [...pages, 'assets/app.js', 'assets/styles.css', 'assets/information.css', '.nojekyll'].sort();
const read = file => fs.readFileSync(file, 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)).map(file => entry.name + '/' + file) : [entry.name]);

test('Pages artifact contains all information pages and only public allowlisted files', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-public-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['scripts/prepare-public.cjs', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(walk(output).sort(), expectedFiles);
  for (const file of expectedFiles.filter(file => file !== '.nojekyll')) {
    assert.equal(read(path.join(output, file)), read(file), file + ' must match source');
  }
});

test('every page has the exact risk disclosure and working local navigation and assets', () => {
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /Не является инвестиционной рекомендацией/, file);
    for (const target of pages.filter(target => target !== file)) {
      assert.ok(html.includes('href="./' + target + '"'), file + ' must link to ' + target);
    }
    for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^https?:/.test(match[1])) continue;
      const target = match[1].split(/[?#]/)[0];
      assert.ok(fs.statSync(path.resolve(path.dirname(file), target)).isFile(), file + ': ' + target);
    }
  }
});

test('information pages are Russian, readable without JavaScript and have distinct metadata', () => {
  const titles = new Set(), descriptions = new Set();
  for (const file of pages.slice(1)) {
    const html = read(file);
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|\son\w+=/i);
    titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
    descriptions.add(html.match(/name="description" content="([^"]+)"/)[1]);
  }
  assert.equal(titles.size, 3);
  assert.equal(descriptions.size, 3);
});

test('methodology distinguishes spot trade-window CVD and futures snapshots with primary sources', () => {
  const html = read('methodology.html');
  for (const text of ['/api/v3/aggTrades', '/fapi/v1/openInterest', '/fapi/v1/premiumIndex',
    'm=false', 'm=true', 'lastFundingRate', 'не фиксированные 24 часа', 'не годовая доходность']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /https:\/\/github\.com\/binance\/binance-spot-api-docs/);
  assert.match(html, /https:\/\/developers\.binance\.com\//);
  assert.match(html, /https:\/\/docs\.coingecko\.com\/reference\/coins-markets/);
});

test('packaging rejects missing source files before copying any artifact', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-source-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-output-'));
  t.after(() => [root, output].forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  const { preparePublic } = require('../scripts/prepare-public.cjs');
  assert.throws(() => preparePublic(root, output), /Missing public source/);
  assert.deepEqual(fs.readdirSync(output), []);
});
