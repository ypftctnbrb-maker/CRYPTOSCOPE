'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('integration documentation names the namespace actually written by the counter', () => {
  const docs = fs.readFileSync('docs/referrals/integration.md', 'utf8');
  const documented = docs.match(/cs-referral-clicks-v\d+(?::<id>)?/);
  assert.ok(documented, 'persistence namespace is documented');
  const prefix = documented[0].replace('<id>', '');
  let written;
  const storage = { getItem: () => null, setItem: key => { written = key; } };
  require('../assets/referrals.js').createTracker(storage).count('header');
  assert.ok(written?.startsWith(prefix), 'documented namespace must describe actual persisted click records');
});
test('README and every external template are generated from the canonical config with disclosures', () => {
  const { buildCopy } = require('../scripts/render-referral-copy.cjs');
  const { REF_BINGX } = require('../assets/config.js');
  const { RISK } = require('../assets/referrals.js');
  const files = buildCopy();
  for (const [file, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(file, 'utf8'), text, file + ' must be regenerated after config changes');
    assert.ok(text.includes(REF_BINGX));
    assert.ok(text.includes('Реферальная ссылка'));
    assert.ok(text.includes(RISK));
    assert.doesNotMatch(text, /гарантированно/i);
  }
  const external = files['docs/referrals/external-templates.md'];
  for (const section of ['Telegram: описание', 'Telegram: закреп', 'Ежедневный отчёт', 'X: био', 'YouTube', 'Telegram-бот', 'Обзор или видео']) {
    assert.ok(external.includes(section), section);
  }
});
