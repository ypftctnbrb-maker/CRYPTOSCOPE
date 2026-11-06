// Static regression checks for a browser-only deployment. Run: node tests/smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const js = fs.readFileSync('assets/app.js','utf8');
const css = fs.readFileSync('assets/styles.css','utf8');
new vm.Script(js,{filename:'assets/app.js'});
assert.match(html,/Content-Security-Policy/,'CSP must be present');
assert.match(html,/assets\/app\.js\?v=/,'versioned script required');
assert.match(html,/assets\/styles\.css\?v=/,'versioned stylesheet required');
assert.match(js,/VERIFIED_BINANCE_PAIRS/,'explicit asset mapping required');
assert.match(js,/const symbol=verifiedPair\(c\)/,'coin details must use verified pair');
assert.doesNotMatch(js,/const symbol=c\.symbol\.toUpperCase\(\)\.replace\(/,'ticker-based derivation forbidden');
assert.match(js,/Date\.now\(\)-liveLastMessage<15000/,'stale live prices must be rejected');
assert.match(css,/:root/,'styles must load');
console.log('CRYPTOSCOPE static smoke checks passed');
