'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function assertReportAssets(refs, output) {
  let checked = 0;
  const required = new Set(['assets/config.js', 'assets/referrals.js', 'assets/information.css', 'assets/referrals.css']);
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref.startsWith('../assets/')) continue;
    const asset = ref.match(/^\.\.\/(assets\/[\w.-]+)\?v=([0-9a-f]{12})$/);
    assert.ok(asset, 'every local report resource must include its asset hash: ' + ref);
    const digest = createHash('sha256').update(fs.readFileSync(path.join(output, asset[1]))).digest('hex').slice(0, 12);
    assert.equal(asset[2], digest, 'report resource hash matches the published file');
    checked++;
    required.delete(asset[1]);
  }
  assert.ok(checked >= 4, 'report must check at least four versioned local resources');
  assert.deepEqual([...required], [], 'report must include each required script and stylesheet');
  return checked;
}
module.exports = { assertReportAssets };
