'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = () => require('../assets/referrals.js');
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  let keys;
  return { get length() { return data.size; }, key: i => (keys ||= [...data.keys()])[i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { keys = undefined; data.set(key, String(value)); } };
}
function trackerInBrowser(crypto) {
  const module = { exports: {} };
  const context = { module, require: () => require('../assets/config.js'), crypto };
  vm.runInNewContext(fs.readFileSync('assets/referrals.js', 'utf8'), context);
  return module.exports.createTracker;
}

test('clicks persist across documents when crypto.randomUUID is unavailable', () => {
  const storage = memoryStorage();
  const makeFirst = trackerInBrowser(undefined), makeSecond = trackerInBrowser({});
  const first = makeFirst(storage), second = makeSecond(storage);
  first.count('header'); second.count('header'); second.count('coin');
  assert.deepEqual(JSON.parse(JSON.stringify(makeFirst(storage).counts())), { header: 2, coin: 1 });
});

test('crypto without randomUUID still persists clicks using available browser facilities', () => {
  const storage = memoryStorage();
  const create = trackerInBrowser({ getRandomValues: array => array.fill(123) });
  create(storage).count('footer');
  assert.deepEqual(JSON.parse(JSON.stringify(create(storage).counts())), { footer: 1 });
});

test('one canonical configuration supplies every safe, disclosed referral block', () => {
  const { REF_BINGX } = require('../assets/config.js');
  const { block, placements, RISK } = core();
  assert.equal(new URL(REF_BINGX).protocol, 'https:');
  for (const placement of placements) {
    const html = block(placement, '<img onerror="bad">', 'bitcoin');
    assert.ok(html.includes('href="' + REF_BINGX + '"'));
    assert.match(html, /target="_blank" rel="sponsored noopener noreferrer"/);
    assert.ok(html.includes('data-placement="' + placement + '"'));
    assert.ok(html.includes('Реферальная ссылка'));
    assert.ok(html.includes(RISK));
    assert.doesNotMatch(html, /<img/);
  }
  assert.throws(() => block('untrusted', 'test'), /placement/);
});

test('click counter persists separately by placement and ignores malformed/unknown counts', () => {
  const storage = memoryStorage({ 'cs-referral-clicks-v1': '{"header":3,"footer":-5,"unknown":42,"coin":"8"}' });
  const events = [];
  const tracker = core().createTracker(storage, data => events.push(data));
  tracker.count('header'); tracker.count('coin'); tracker.count('footer'); tracker.count('unknown');
  assert.deepEqual(tracker.counts(), { header: 4, coin: 1, footer: 1 });
  assert.deepEqual(core().createTracker(storage).counts(), { header: 4, coin: 1, footer: 1 });
  assert.deepEqual(events, [{ exchange: 'bingx', placement: 'header' },
    { exchange: 'bingx', placement: 'coin' }, { exchange: 'bingx', placement: 'footer' }]);
});

test('two already-open tabs retain each other\'s clicks and refresh displayed totals', () => {
  const storage = memoryStorage();
  const first = core().createTracker(storage), second = core().createTracker(storage);
  first.count('header'); second.count('footer'); first.count('header'); second.count('header');
  for (const tracker of [first, second, core().createTracker(storage)]) {
    assert.deepEqual(tracker.counts(), { header: 3, footer: 1 });
  }
});

test('overlapping writes from two tabs retain both increments of the same placement', () => {
  const storage = memoryStorage();
  const first = core().createTracker(storage), second = core().createTracker(storage);
  const write = storage.setItem;
  let overlap = true;
  storage.setItem = (key, value) => {
    if (overlap) { overlap = false; second.count('coin'); }
    write(key, value);
  };
  first.count('coin');
  assert.deepEqual(core().createTracker(storage).counts(), { coin: 2 });
  assert.deepEqual(first.counts(), { coin: 2 });
  assert.deepEqual(second.counts(), { coin: 2 });
});

test('cached UI totals preserve 5000 shards without rescanning 20000 unrelated keys on each click', () => {
  const initial = {};
  for (let i = 0; i < 20000; i++) initial['other:' + i] = 'unrelated';
  for (let i = 0; i < 5000; i++) initial['cs-referral-clicks-v2:old-' + i] = '{"header":1}';
  const storage = memoryStorage(initial), key = storage.key, get = storage.getItem;
  let enumerated = 0, reads = 0;
  storage.key = i => { enumerated++; return key(i); };
  storage.getItem = k => { reads++; return get(k); };
  const tracker = core().createTracker(storage, undefined, true);
  assert.equal(tracker.counts().header, 5000);
  enumerated = reads = 0;
  for (let i = 0; i < 100; i++) { tracker.count('header'); assert.equal(tracker.counts().header, 5001 + i); }
  assert.equal(enumerated, 0, 'unchanged records must not trigger another full key scan');
  assert.equal(reads, 0, 'local clicks do not reread persisted records');
  const changed = 'cs-referral-clicks-v2:old-10';
  storage.setItem(changed, '{"header":5,"coin":2}');
  tracker.refresh(changed);
  assert.deepEqual(tracker.counts(), { header: 5104, coin: 2 });
  assert.equal(enumerated, 0, 'a storage event refreshes only its own record');
  assert.equal(reads, 1);
});

test('broken storage or analytics never throws or stops navigation', () => {
  const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const tracker = core().createTracker(storage, () => { throw Error('offline'); });
  assert.doesNotThrow(() => tracker.count('table'));
  assert.deepEqual(tracker.counts(), { table: 1 });
});

for (const unreadable of ['cs-referral-clicks-v1', 'cs-referral-clicks-v2:blocked']) {
  test('one unreadable record does not discard readable counts or force repeated scans: ' + unreadable, () => {
    const storage = memoryStorage({ 'cs-referral-clicks-v1': '{"header":1}',
      'cs-referral-clicks-v2:valid': '{"coin":2}', 'cs-referral-clicks-v2:blocked': '{"table":3}' });
    const get = storage.getItem, key = storage.key;
    let enumerated = 0;
    storage.getItem = k => { if (k === unreadable) throw Error('record unavailable'); return get(k); };
    storage.key = i => { enumerated++; return key(i); };
    const tracker = core().createTracker(storage, undefined, true);
    const expected = unreadable.endsWith('v1') ? { coin: 2, table: 3 } : { header: 1, coin: 2 };
    assert.deepEqual(tracker.counts(), expected);
    const firstScan = enumerated;
    assert.deepEqual(tracker.counts(), expected);
    assert.equal(enumerated, firstScan, 'partial readable snapshot remains cached');
    tracker.count('footer');
    assert.deepEqual(tracker.counts(), { ...expected, footer: 1 });
  });
}

test('primary/keyboard and middle clicks count once; other links and buttons do not', () => {
  const { REF_BINGX } = require('../assets/config.js');
  const counts = [];
  const handle = core().clickHandler({ count: p => counts.push(p) });
  const anchor = { dataset: { referral: 'bingx', placement: 'header' }, getAttribute: () => REF_BINGX };
  const event = (type, button, node = anchor) => ({ type, button, target: { closest: () => node } });
  handle(event('click', 0)); handle(event('auxclick', 1));
  handle(event('auxclick', 2)); handle(event('click', 1)); handle(event('click', 0, null));
  handle(event('click', 0, { ...anchor, getAttribute: () => 'https://example.org' }));
  assert.deepEqual(counts, ['header', 'header']);
});

test('referral URL is not hand-copied into runtime or tests', () => {
  const { REF_BINGX } = require('../assets/config.js');
  for (const file of fs.readdirSync('assets').filter(name => /\.js$/.test(name) && name !== 'config.js')) {
    assert.ok(!fs.readFileSync('assets/' + file, 'utf8').includes(REF_BINGX), file);
  }
});
