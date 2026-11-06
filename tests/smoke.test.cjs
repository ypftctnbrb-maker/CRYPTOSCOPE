/* Run: node tests/smoke.test.cjs */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('assets/app.js','utf8');
const locale=fs.readFileSync('assets/localization.js','utf8');
const html=fs.readFileSync('index.html','utf8');
for(const [name,source] of [['app.js',app],['localization.js',locale]])new vm.Script(source,{filename:name});
assert(html.indexOf('assets/localization.js')<html.indexOf('assets/app.js'),'i18n must load before app');
const languages=['ru','en'];
assert.equal((html.match(/<option value="(?:ru|en|es|zh|de|fr|pt|ar|hi|ja)"/g)||[]).length,2,'only two supported languages must be selectable');
for(const code of languages)assert(new RegExp('(?:"|\\\')'+code+'(?:"|\\\')\\s*:').test(locale)||locale.includes('translations.'+code),'missing locale '+code);
assert(locale.includes('window.CSI18N'),'unified API missing');
assert(!locale.includes('new MutationObserver'),'i18n must not depend on DOM mutation observer');
assert(app.includes('window.CSI18N.apply()'),'render/localization integration missing');
console.log('PASS: JS syntax, script order, 2 supported locales, explicit i18n integration');
