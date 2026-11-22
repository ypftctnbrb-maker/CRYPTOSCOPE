import { scenarios } from './fixtures.mjs';
import { defaults, execute, plan, statuses } from './probe.mjs';
import { toCsv, toJson } from './exports.mjs';

const element = id => document.getElementById(id);
let results = [], running = false, stopped = false;
for (const scenario of Object.keys(scenarios)) {
  const option = document.createElement('option');
  option.value = option.textContent = scenario;
  element('scenario').append(option);
}

function show(row, index) {
  const table = element('results');
  const tr = table.rows[index] ?? table.insertRow();
  const detail = row.errorClass ?? row.reason ?? (row.httpStatus ? 'HTTP ' + row.httpStatus : '');
  tr.replaceChildren(...[row.iteration, row.endpoint, row.status, detail].map(text => {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }));
}

element('settings').addEventListener('submit', async event => {
  event.preventDefault();
  if (running) return;
  const metadata = Object.fromEntries(['browser', 'os', 'network', 'region'].map(id => [id, element(id).value.trim()]));
  if (Object.values(metadata).some(value => !value)) {
    element('progress').textContent = 'Заполните технические сведения об испытании.';
    return;
  }
  const instrument = element('instrument').value;
  results = plan(element('scenario').value, instrument, Number(element('repeats').value), metadata);
  element('results').replaceChildren();
  results.forEach(show);
  running = true;
  stopped = false;
  element('start').disabled = true;
  element('stop').disabled = false;
  element('json').disabled = element('csv').disabled = false;
  try {
    const response = await fetch('/config.json', { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Mock configuration unavailable');
    const { apiOrigin } = await response.json();
    for (let i = 0; i < results.length && !stopped; i++) {
      element('progress').textContent = `Проверка ${i + 1} из ${results.length}`;
      results[i] = await execute(results[i], apiOrigin, instrument);
      show(results[i], i);
      if (!stopped && i + 1 < results.length) await new Promise(resolve => setTimeout(resolve, defaults.pauseMs));
    }
  } catch (error) {
    const index = results.findIndex(row => row.reason === 'pending');
    if (index >= 0) {
      results[index] = { ...results[index], utc: new Date().toISOString(), status: statuses.error,
        errorClass: 'runner', reason: error.message };
      show(results[index], index);
    }
    stopped = true;
  } finally {
    if (stopped) results.filter(row => row.reason === 'pending').forEach(row => { row.reason = 'stopped'; });
    results.forEach(show);
    element('progress').textContent = stopped ? 'Запуск завершён досрочно' : 'Запуск завершён';
    running = false;
    element('start').disabled = false;
    element('stop').disabled = true;
  }
});

element('stop').addEventListener('click', () => {
  stopped = true;
  element('stop').disabled = true;
  element('progress').textContent = 'Остановка после текущей проверки';
});

for (const [format, encode, type] of [['json', toJson, 'application/json'], ['csv', toCsv, 'text/csv']]) {
  element(format).addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([encode(results)], { type: type + ';charset=utf-8' }));
    const link = document.createElement('a');
    link.download = 'browser-api-probe.' + format;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
