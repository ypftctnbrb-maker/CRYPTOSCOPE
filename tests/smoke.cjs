// Static regression checks for a browser-only deployment. Run: node tests/smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const js = fs.readFileSync('assets/app.js','utf8');
const css = fs.readFileSync('assets/styles.css','utf8');
new vm.Script(js,{filename:'assets/app.js'});
assert.match(html,/Content-Security-Policy/,'CSP must be present');
for (const page of fs.readdirSync('.').filter(file => file.endsWith('.html'))) {
  const source = fs.readFileSync(page, 'utf8');
  for (const [, attrs] of source.matchAll(/<script\b([^>]*)>/gi)) {
    const src = attrs.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!src) continue;
    const url = new URL(src[1] ?? src[2] ?? src[3], 'https://site.invalid/');
    assert.equal(url.origin, 'https://site.invalid', page + ': executable script must be local: ' + url.href);
  }
  assert.match(source, /script-src 'self';/, page + ': CSP must limit executable scripts to the site');
}
assert.match(html,/assets\/app\.js\?v=/,'versioned script required');
assert.match(html,/assets\/styles\.css\?v=/,'versioned stylesheet required');
assert.match(js,/VERIFIED_BINANCE_PAIRS/,'explicit asset mapping required');
assert.match(js,/const symbol=verifiedPair\(c\)/,'coin details must use verified pair');
assert.doesNotMatch(js,/const symbol=c\.symbol\.toUpperCase\(\)\.replace\(/,'ticker-based derivation forbidden');
assert.match(js,/Date\.now\(\)-liveLastMessage<15000/,'stale live prices must be rejected');
assert.match(js,/lastMarketAttempt=Date\.now\(\)/,'market attempts must be tracked');
assert.match(js,/marketRetryAt=Date\.now\(\)\+Math\.min\(900000/,'failed market fetches must back off');
assert.match(js,/cell\.textContent=usd\(displayPrice\(c\)\)/,'stale live quotes must revert to fallback price');
assert.match(js,/cell\.classList\.toggle\('live-price',Number\.isFinite\(price\)\)/,'stale live price styling must be cleared');
assert.match(css,/:root/,'styles must load');
console.log('CRYPTOSCOPE static smoke checks passed');
