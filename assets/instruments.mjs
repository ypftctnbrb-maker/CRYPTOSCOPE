import { venueNames, reconcileScopes, searchCatalogue, refreshCatalogue } from './venue-catalogue.mjs';
import { bybitAdapter } from './bybit-market.mjs';
import { trackTradeSegments } from './instrument-trades.mjs';

const element = id => document.getElementById('instrument-' + id);
const storageKey = 'cryptoscope-venue-catalogue-v1';
const pageSize = 50;
let catalogue = {}, offset = 0, selection;
const text = (tag, content) => Object.assign(document.createElement(tag), { textContent: content });
const timestamp = value => value && Number.isFinite(new Date(value).valueOf())
  ? new Date(value).toLocaleString('ru-RU') : 'время неизвестно';
const statusLabels = { complete: 'полный', partial: 'частичный', unavailable: 'недоступен' };
const show = (value, unit = '') => value == null ? '—' : value + (unit ? ' ' + unit : '');

function render() {
  const { total, markets } = searchCatalogue(catalogue, element('search').value, {
    venue: element('venue').value, type: element('type').value, offset, limit: pageSize,
  });
  element('count').textContent = 'Инструментов: ' + total + (total ? ' · ' + (offset + 1) + '–' + Math.min(total, offset + pageSize) : '');
  element('prev').disabled = offset === 0;
  element('next').disabled = offset + pageSize >= total;
  element('results').replaceChildren(...markets.map(market => {
    const label = [venueNames[market.venue], market.type, market.id,
      market.active === null ? 'статус неизвестен' : market.stale ? 'из сохранённого каталога' : ''].filter(Boolean).join(' · ');
    const button = text('button', label);
    button.type = 'button';
    button.addEventListener('click', () => open(market));
    const row = document.createElement('li');
    row.append(button);
    return row;
  }));
  element('coverage').replaceChildren(...Object.entries(catalogue).flatMap(([venue, scopes]) => scopes.map(scope =>
    text('li', [venueNames[venue], scope.scope, statusLabels[scope.status], show(scope.count),
      timestamp(scope.retrievedAt), scope.attemptedAt && 'попытка ' + timestamp(scope.attemptedAt), scope.error].filter(Boolean).join(' · ')))));
}

async function refresh() {
  element('refresh').disabled = true;
  element('status').textContent = 'Обновление официальных REST-каталогов';
  try {
    await refreshCatalogue((venue, scopes, at) => {
      catalogue[venue] = reconcileScopes(catalogue[venue] ?? [], scopes, at);
      offset = 0;
      render();
    });
    try { localStorage.setItem(storageKey, JSON.stringify(catalogue)); } catch { /* Storage unavailable or full. */ }
    element('status').textContent = 'Состояние источников указано в покрытии каталогов';
  } finally {
    element('refresh').disabled = false;
  }
}

function stopSelection() {
  selection?.stop();
  selection = null;
}

function open(market) {
  stopSelection();
  element('detail').hidden = false;
  element('title').textContent = [venueNames[market.venue], market.type, market.id].join(' · ');
  element('metrics').replaceChildren();
  element('chart').hidden = true;
  if (market.venue !== 'bybit' || market.active !== true) {
    element('chart-status').textContent = 'Метрики этого инструмента недоступны · каталог от ' + timestamp(market.observedAt);
    return;
  }
  const adapter = bybitAdapter(market);
  const controller = new AbortController();
  const active = () => !controller.signal.aborted;
  let chart, resize, closeSocket, timer, delay = 1000;
  const status = message => { element('chart-status').textContent = adapter.source + ' · 5m · ' + message; };
  const tradeRow = text('li', '');
  element('metrics').append(tradeRow);
  const stopTrades = trackTradeSegments(adapter, ({ state, segment }) => {
    const label = 'CVD · ';
    if (state === 'waiting') {
      tradeRow.textContent = label + 'ожидание сделок · история до сегмента недоступна';
      return;
    }
    if (state === 'stale') {
      tradeRow.textContent = label + 'данные устарели · переподключение';
      return;
    }
    const amount = value => show(Number(value.toPrecision(12)), adapter.volumeUnit);
    tradeRow.textContent = label + 'LIVE · Δ 5m (' + timestamp(segment.candle) + ') ' + amount(segment.delta) +
      ' · сегмент с ' + timestamp(segment.start) + ' · ' + amount(segment.cumulative) + ' · сделка ' + timestamp(segment.latest);
  });
  selection = { market, stop() {
    stopTrades();
    tradeRow.textContent = 'CVD · обновление приостановлено';
    controller.abort();
    clearTimeout(timer);
    closeSocket?.();
    resize?.disconnect();
    chart?.remove();
  } };

  const metrics = [
    ['Последние сделки', adapter.getTrades, snapshot => snapshot.trades.length ? snapshot.trades.length : null],
    ['CVD снимка сделок', adapter.getTrades, snapshot => snapshot.trades.length
      ? show(snapshot.trades.reduce((sum, trade) => sum + (trade.side === 'Buy' ? trade.quantity : -trade.quantity), 0), snapshot.unit)
      : '—'],
    ['OI', adapter.getOI, snapshot => show(snapshot.value, snapshot.unit)],
    ['Funding', adapter.getFunding, snapshot => snapshot.value === null ? '—' : show(snapshot.value * 100, '%')],
  ];
  const requests = new Map();
  for (const [name, load, format] of metrics) {
    const row = text('li', name + ' · —');
    element('metrics').append(row);
    if (!requests.has(load)) requests.set(load, load(controller.signal));
    requests.get(load).then(snapshot => {
      if (active()) row.textContent = name + ' · ' + (format(snapshot) ?? '—') + ' · ' + timestamp(snapshot.timestamp);
    }).catch(() => { if (active()) row.textContent = name + ' · недоступно'; });
  }

  const step = adapter.priceStep;
  const host = element('chart');
  const volumeBar = row => ({ time: row.time, value: row.volume,
    color: row.close >= row.open ? 'rgba(54,213,160,.35)' : 'rgba(255,101,126,.35)' });
  let prices, volumes;
  function retry(retryAt = 0) {
    if (!active()) return;
    clearTimeout(timer);
    closeSocket?.();
    closeSocket = null;
    status('данные устарели · переподключение');
    timer = setTimeout(connect, Math.max(delay, retryAt - Date.now()));
    delay = Math.min(delay * 2, 30000);
  }
  async function connect() {
    try {
      const snapshot = await adapter.getCandles(controller.signal);
      if (!active()) return;
      if (!snapshot.candles.length) throw Error('No candles');
      if (!chart) {
        host.hidden = false;
        chart = window.LightweightCharts.createChart(host, { width: host.clientWidth, height: 300 });
        prices = chart.addCandlestickSeries(step > 0 ? { priceFormat: { type: 'price', minMove: step } } : {});
        volumes = chart.addHistogramSeries({ priceScaleId: 'volume', priceFormat: { type: 'volume' } });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth }));
        resize.observe(host);
      }
      prices.setData(snapshot.candles);
      volumes.setData(snapshot.candles.map(volumeBar));
      chart.timeScale().fitContent();
      let lastTime = snapshot.candles.at(-1).time;
      let lastEvent = 0;
      const watch = () => {
        clearTimeout(timer);
        timer = setTimeout(retry, 30000);
      };
      status('история · ' + timestamp(snapshot.timestamp) + ' · объём: ' + show(snapshot.unit));
      closeSocket = adapter.streamCandles((candle, eventTime) => {
        if (!active() || candle.time < lastTime || !eventTime || eventTime <= lastEvent) return;
        if (candle.time > lastTime + 300) return retry();
        prices.update(candle);
        volumes.update(volumeBar(candle));
        lastTime = candle.time;
        lastEvent = eventTime;
        delay = 1000;
        status('LIVE · ' + timestamp(eventTime) + ' · объём: ' + show(snapshot.unit));
        watch();
      }, () => retry());
      watch();
    } catch (error) {
      if (active()) retry(error.retryAt);
    }
  }
  status('загрузка');
  connect();
}

for (const [name, label] of Object.entries(venueNames)) element('venue').append(new Option(label, name));
for (const id of ['search', 'venue', 'type']) element(id).addEventListener('input', () => { offset = 0; render(); });
element('prev').addEventListener('click', () => { offset -= pageSize; render(); });
element('next').addEventListener('click', () => { offset += pageSize; render(); });
element('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (!selection) return;
  if (document.hidden) {
    const { market } = selection;
    stopSelection();
    selection = { market, stop() {} };
    element('chart-status').textContent = 'Обновление приостановлено';
  } else open(selection.market);
});
window.addEventListener('pagehide', stopSelection);

try {
  const seed = await fetch('./assets/venue-catalogue.json', { cache: 'no-cache' });
  if (seed.ok) catalogue = (await seed.json()).catalogue;
} catch { /* Refresh remains available. */ }
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  for (const [venue, scopes] of Object.entries(saved ?? {})) {
    if (!Object.hasOwn(venueNames, venue) || !Array.isArray(scopes)) continue;
    const seedTime = catalogue[venue]?.[0]?.retrievedAt ?? '';
    if (scopes.some(scope => (scope.attemptedAt ?? scope.retrievedAt) >= seedTime)) catalogue[venue] = scopes;
  }
} catch { /* Fall back to the packaged REST snapshot. */ }
element('status').textContent = 'Сохранённые каталоги · проверьте время источника';
render();
