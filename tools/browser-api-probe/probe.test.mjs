import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, wsPlan } from './fixtures.mjs';
import { defaults, execute, plan, statuses } from './probe.mjs';
import { toCsv, toJson } from './exports.mjs';
import { startMock } from './server.mjs';

test('planned trials include skipped rows and each endpoint, with bounded defaults', () => {
  assert.deepEqual(defaults, { timeoutMs: 10000, observationMs: 60000, pauseMs: 1500, repeats: 30 });
  const rows = plan('rest-ok', 'spot', 30, { browser: 'manual', region: 'test' });
  assert.equal(rows.length, 180);
  assert.equal(rows.filter(row => row.status === statuses.skip).length, 180);
  assert.equal(rows[179].iteration, 30);
  assert.throws(() => plan('rest-ok', 'spot', 31, {}), /Invalid suite/);
});

test('exports retain errors, ambiguous and pending trials and escape CSV metadata', () => {
  const rows = [
    { status: statuses.error, httpStatus: 451, region: '=1+1' },
    { status: statuses.unclear, reason: 'opaque-response' },
    { status: statuses.skip, reason: 'pending', network: 'two,"fields"' },
  ];
  assert.deepEqual(JSON.parse(toJson(rows)), rows);
  const csv = toCsv(rows);
  for (const row of rows) assert.ok(csv.includes(row.status));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"two,""fields"""'));
});

test('server fixtures expose explicit cross-origin headers and distinct HTTP failures', async t => {
  const mock = await startMock({ pagePort: 0, apiPort: 0 });
  t.after(mock.stop);
  const api = (scenario, endpoint = 'ticker') => fetch(mock.apiOrigin + '/rest/' + endpoint +
    '?scenario=' + scenario + '&instrument=spot');
  const ok = await api('rest-ok');
  assert.deepEqual(await ok.json(), fixture('ticker'));
  assert.equal(ok.headers.get('access-control-allow-origin'), mock.pageOrigin);
  const hidden = await api('rest-451-no-cors');
  assert.equal(hidden.status, 451);
  assert.equal(hidden.headers.has('access-control-allow-origin'), false);
  const noCors = await api('rest-no-cors');
  assert.equal(noCors.status, 200);
  assert.equal(noCors.headers.has('access-control-allow-origin'), false);
  assert.equal((await api('rest-ok', 'oi')).status, 404);
  const page = await fetch(mock.pageOrigin);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self' http:\/\/127\.0\.0\.1:/);
});

test('client refuses external targets before any request', async () => {
  const [row] = plan('rest-ok', 'spot', 1, {});
  await assert.rejects(execute(row, 'https://example.invalid:1234', 'spot'), /Only the loopback/);
});

test('transport drop fixture closes TCP and never sends close code 1006', () => {
  assert.ok(wsPlan('ws-drop', 'initial').some(([, event]) => event.drop));
  assert.ok(wsPlan('ws-drop', 'retry').every(([, event]) => !event.drop));
  for (const code of [1000, 1001, 1011]) {
    assert.equal(wsPlan('ws-close-' + code, 'initial').at(-1)[1].close, code);
  }
});
