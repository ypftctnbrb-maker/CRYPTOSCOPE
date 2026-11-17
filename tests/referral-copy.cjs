'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
