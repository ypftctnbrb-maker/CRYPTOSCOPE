'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function assertReportAssets(refs, output) {
  let checked = 0;
  for (const ref of refs) {
    const asset = ref.match(/^\.\.\/(assets\/[\w.-]+)\?v=([0-9a-f]{12})$/);
    if (!asset) continue;
    const digest = createHash('sha256').update(fs.readFileSync(path.join(output, asset[1]))).digest('hex').slice(0, 12);
    assert.equal(asset[2], digest, 'report resource hash matches the published file');
    checked++;
  }
  return checked;
}
module.exports = { assertReportAssets };
