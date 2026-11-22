import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { startMock } from './server.mjs';

test('Chromium observes real loopback HTTP and WebSocket behavior for every fixture', async t => {
  const mock = await startMock({ pagePort: 0, apiPort: 0, unitMs: 25 });
  t.after(mock.stop);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const unexpected = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname !== '127.0.0.1') unexpected.push(request.url());
  });
  await page.goto(mock.pageOrigin);
  const data = await page.evaluate(async ({ apiOrigin }) => {
    const { plan, execute } = await import('/probe.mjs');
    const { scenarios } = await import('/fixtures.mjs');
    const options = { timeoutMs: 600, observationMs: 700, pauseMs: 25 };
    const metadata = { browser: 'Chromium', os: 'Linux', region: 'fixture', network: 'loopback' };
    const results = {};
    for (const id of Object.keys(scenarios)) {
      results[id] = [];
      for (const row of plan(id, 'spot', 1, metadata)) {
        results[id].push(await execute(row, apiOrigin, 'spot', options));
      }
    }
    results.futures = [];
    for (const row of plan('rest-ok', 'futures', 1, metadata)) {
      results.futures.push(await execute(row, apiOrigin, 'futures', options));
    }
    return results;
  }, { apiOrigin: mock.apiOrigin });
  const get = id => data[id][0];
  assert.deepEqual(unexpected, []);
  assert.equal(data['rest-ok'].filter(row => row.status === 'ПРОЙДЕНО').length, 4);
  assert.equal(data['rest-ok'].filter(row => row.status === 'НЕ ЗАПУЩЕНО').length, 2);
  assert.equal(data.futures.filter(row => row.status === 'ПРОЙДЕНО').length, 6);
  assert.equal(get('rest-timeout').errorClass, 'timeout');
  assert.equal(get('rest-451-readable').httpStatus, 451);
  for (const id of ['rest-451-no-cors', 'rest-no-cors']) {
    assert.equal(get(id).status, 'НЕОДНОЗНАЧНО');
    assert.equal(get(id).reason, 'fetch-rejected');
    assert.equal(get(id).httpStatus, undefined);
  }
  assert.equal(get('rest-opaque').reason, 'opaque-response');
  const ws = get('ws-normal');
  assert.equal(ws.status, 'ПРОЙДЕНО');
  assert.ok(ws.T_open <= ws.T_first && ws.T_first <= ws.T_ack && ws.T_ack <= ws.T_trade);
  assert.ok(ws.observedMs >= 650 && ws.messagesPerSecond > 0 && ws.maxPauseMs > 0);
  assert.equal(get('ws-no-trades').status, 'ПРОЙДЕНО');
  assert.equal(get('ws-no-trades').T_trade, null);
  assert.equal(get('ws-no-trades').T_ack, 'not-in-protocol');
  assert.equal(get('ws-no-ack').errorClass, 'no-ack');
  assert.equal(get('ws-silent').errorClass, 'no-message');
  for (const code of [1000, 1001, 1011]) assert.equal(get('ws-close-' + code).closeCode, code);
  assert.equal(get('ws-drop').closeCode, 1006);
  assert.equal(get('ws-drop').wasClean, false);
  assert.equal(get('ws-drop').recovery.recovered, true);
  assert.equal(get('ws-cold-fallback').recovery.recovered, false);
  assert.equal(get('ws-cold-fallback').coldFallback.status, 'ПРОЙДЕНО');
  assert.equal(get('ws-duplicates-gaps').duplicateIds, 1);
  assert.equal(get('ws-duplicates-gaps').gapEvents, 1);
});

test('browser form executes a mock trial and exports JSON and CSV', async t => {
  const mock = await startMock({ pagePort: 0, apiPort: 0 });
  t.after(mock.stop);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.goto(mock.pageOrigin);
  await page.selectOption('#scenario', 'rest-opaque');
  await page.fill('#repeats', '1');
  for (const name of ['browser', 'os', 'region', 'network']) await page.fill('#' + name, 'test-' + name);
  await page.click('#start');
  await page.getByText('Запуск завершён', { exact: true }).waitFor();
  assert.match(await page.locator('#results').innerText(), /НЕОДНОЗНАЧНО/);
  for (const format of ['json', 'csv']) {
    const download = page.waitForEvent('download');
    await page.click('#' + format);
    const result = await download;
    assert.equal(result.suggestedFilename(), 'browser-api-probe.' + format);
    assert.match(await readFile(await result.path(), 'utf8'), /opaque-response/);
  }
});
