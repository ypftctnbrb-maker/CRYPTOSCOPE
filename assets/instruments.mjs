import { mountMarketSphere } from './market-sphere.mjs';
import { venueNames, reconcileScopes, searchCatalogue, refreshCatalogue } from './venue-catalogue.mjs';
import { bybitAdapter } from './bybit-market.mjs';
import { okxAdapter, resolveOkxContract } from './okx-market.mjs';
import { hyperliquidAdapter } from './hyperliquid-market.mjs';
import { bitfinexAdapter } from './bitfinex-market.mjs';
import { mexcAdapter } from './mexc-market.mjs';
import { candleStyle, chartStyle, createCvdChart, groupPriceBars, movingAverage } from './instrument-charts.mjs';
import { trackTradeSegments, tradeHistory } from './instrument-trades.mjs';

const element = id => document.getElementById('instrument-' + id);
const sphere = mountMarketSphere(element('sphere'), element('sphere-logo'));
const storageKey = 'cryptoscope-venue-catalogue-v1';
const pageSize = 50;
const adapters = { bybit: bybitAdapter, okx: okxAdapter, hyperliquid: hyperliquidAdapter,
  bitfinex: bitfinexAdapter, mexc: mexcAdapter };
let catalogue = {}, offset = 0, selection, selectedKey, timeframe = 5, redrawPrice;
let favoritesOnly = false;
const favoritesKey = 'cryptoscope-instrument-favorites-v1';
let favorites = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(favoritesKey));
  if (Array.isArray(saved)) favorites = new Set(saved.filter(value => typeof value === 'string'));
} catch { /* Favorites are session-only when storage is unavailable. */ }

const marketKey = market => JSON.stringify([market.venue, market.type, market.id]);
const text = (tag, content) => Object.assign(document.createElement(tag), { textContent: content });
const timestamp = value => value && Number.isFinite(new Date(value).valueOf())
  ? new Date(value).toLocaleString('ru-RU') : 'время неизвестно';
const statusLabels = { complete: 'полный', partial: 'частичный', unavailable: 'недоступен' };
const show = (value, unit = '') => value == null ? '—' : value + (unit ? ' ' + unit : '');

function render() {
  const source = favoritesOnly ? Object.fromEntries(Object.entries(catalogue).map(([venue, scopes]) =>
    [venue, scopes.map(scope => ({ ...scope, markets: scope.markets.filter(market => favorites.has(marketKey(market))),
      unknownMarkets: (scope.unknownMarkets ?? []).filter(market => favorites.has(marketKey(market))) }))])) : catalogue;
  const { total, markets } = searchCatalogue(source, element('search').value, {
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
    button.dataset.marketKey = marketKey(market);
    button.setAttribute('aria-pressed', String(button.dataset.marketKey === selectedKey));
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
  redrawPrice = undefined;
}

async function open(market) {
  stopSelection();
  sphere.select(market);
  selectedKey = marketKey(market);
  updateFavorite();
  element('ohlc').textContent = 'O — · H — · L — · C —';
  element('volume').textContent = '—';
  element('summary').textContent = 'Ожидание цены и объёма выбранного рынка.';
  element('btc').textContent = '—';
  element('btc-source').textContent = 'Котировка появится при выборе рынка BTC';
  for (const button of element('results').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.marketKey === selectedKey));
  }
  element('detail').hidden = false;
  element('title').textContent = [venueNames[market.venue], market.type, market.id].join(' · ');
  element('metrics').replaceChildren();
  const history = element('history');
  history.hidden = true;
  element('history-rows').replaceChildren();
  element('chart').hidden = true;
  element('cvd-chart').hidden = true;
  element('cvd-status').textContent = '—';
  if (!Object.hasOwn(adapters, market.venue) || market.active !== true) {
    element('chart-status').textContent = 'Метрики этого инструмента недоступны · каталог от ' + timestamp(market.observedAt);
    return;
  }
  const controller = new AbortController();
  const active = () => !controller.signal.aborted;
  selection = { market, stop: () => controller.abort() };
  let instrument = market;
  if (market.venue === 'okx' && market.type === 'perp' && !market.contractSizeUnit) {
    element('chart-status').textContent = 'OKX · загрузка спецификации контракта';
    try {
      instrument = await resolveOkxContract(market, controller.signal);
    } catch {
      if (active()) element('chart-status').textContent = 'OKX · спецификация контракта недоступна';
      return;
    }
    if (!active()) return;
  }
  const adapter = adapters[market.venue](instrument);
  let chart, resize, closeSocket, timer, delay = 1000;
  const status = message => { element('chart-status').textContent = adapter.source + ' · ' + (timeframe === 5 ? '5m' : timeframe + 'm из 5m · текущий интервал неполный') + ' · ' + message; };
  const cvd = createCvdChart(element('cvd-chart'), adapter.volumeUnit);
  const cvdStatus = element('cvd-status');
  const amount = (value, unit) => show(Number(value.toPrecision(12)), unit);
  const tradeRow = text('li', '');
  element('metrics').append(tradeRow);
  const historyRows = element('history-rows');
  history.hidden = false;
  let currentTrades;
  function loadHistory() {
    const request = adapter.getTrades(controller.signal);
    currentTrades = request;
    historyRows.replaceChildren(text('li', 'Загрузка ' + adapter.source));
    request.then(snapshot => {
      if (!active() || currentTrades !== request) return;
      const buckets = tradeHistory(snapshot.trades);
      cvd.setHistory(buckets);
      const rows = buckets.map(bucket => text('li', timestamp(bucket.time) +
        ' · Δ ' + amount(bucket.delta, snapshot.unit) + ' · CVD ' + amount(bucket.cumulative, snapshot.unit) +
        ' · сегмент с ' + timestamp(bucket.segment) + ' · сделки ' +
        timestamp(bucket.first) + ' — ' + timestamp(bucket.last)));
      historyRows.replaceChildren(text('li', adapter.source + ' · ' + timestamp(snapshot.timestamp)),
        ...(snapshot.coverageNote ? [text('li', snapshot.coverageNote)] : []),
        ...(rows.length ? rows : [text('li', 'Подтверждённых сделок нет')]));
    }).catch(() => {
      if (active() && currentTrades === request) historyRows.replaceChildren(text('li', adapter.source + ' · история недоступна'));
    });
    return request;
  }

  const tradesRequest = loadHistory();
  let reconnecting = false;
  const stopTrades = trackTradeSegments(adapter, ({ state, segment }) => {
    const label = 'CVD · ';
    if (state === 'waiting') {
      if (reconnecting) loadHistory();
      cvdStatus.textContent = adapter.source + ' · ожидание свежих сделок';
      tradeRow.textContent = label + 'ожидание сделок · история до сегмента недоступна';
      return;
    }
    if (state === 'stale') {
      reconnecting = true;
      cvdStatus.textContent = adapter.source + ' · данные устарели · переподключение';
      tradeRow.textContent = label + 'данные устарели · переподключение';
      return;
    }
    cvd.setLive(segment.bars);
    cvdStatus.textContent = adapter.source + ' · LIVE · сделка ' + timestamp(segment.latest) +
      ' · сегмент с ' + timestamp(segment.start);
    tradeRow.textContent = label + 'LIVE · Δ 5m (' + timestamp(segment.candle) + ') ' + amount(segment.delta, adapter.volumeUnit) +
      ' · сегмент с ' + timestamp(segment.start) + ' · ' + amount(segment.cumulative, adapter.volumeUnit) + ' · сделка ' + timestamp(segment.latest);
  });
  selection = { market, stop() {
    stopTrades();
    cvd.stop();
    cvdStatus.textContent = 'Обновление приостановлено';
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
  const requests = new Map([[adapter.getTrades, tradesRequest]]);
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
    color: row.close >= row.open ? 'rgba(131,169,149,.35)' : 'rgba(183,119,123,.35)' });
  let prices, volumes, average, rawBars = [], priceSource, priceTime, priceState = 'история';
  const displayPrice = value => value.toLocaleString('ru-RU', { maximumSignificantDigits: 9 });
  function paintPrice(fit) {
    if (!chart) return;
    const rows = groupPriceBars(rawBars, timeframe);
    prices.setData(rows);
    volumes.setData(rows.filter(row => row.volume != null).map(volumeBar));
    average.setData(movingAverage(rows, 7, timeframe * 60));
    if (fit) chart.timeScale().fitContent();
    status(priceState + ' · ' + timestamp(priceTime) + ' · объём: ' + show(priceSource));
    const last = rows.at(-1);
    element('ohlc').textContent = last
      ? ['O', 'H', 'L', 'C'].map((label, index) => label + ' ' + displayPrice(last[['open','high','low','close'][index]])).join(' · ')
      : 'O — · H — · L — · C —';
    element('volume').textContent = show(last?.volume, priceSource);
    const change = last?.open > 0 ? (last.close / last.open - 1) * 100 : null;
    element('summary').textContent = change === null ? 'Нет непрерывной выборки для этого интервала.'
      : 'Изменение внутри свечи: ' + displayPrice(change) + '% · ' + adapter.source + ' · ' + timestamp(priceTime);
    if (market.base === 'BTC' && last) {
      element('btc').textContent = displayPrice(last.close) + (market.quote ? ' ' + market.quote : '');
      element('btc-source').textContent = adapter.source + ' · ' + priceState + ' · ' + timestamp(priceTime);
    }
  }
  redrawPrice = () => paintPrice(true);
  function retry(retryAt = 0) {
    if (!active()) return;
    clearTimeout(timer);
    closeSocket?.();
    closeSocket = null;
    priceState = 'данные устарели · переподключение';
    status(priceState);
    element('summary').textContent = 'Последняя свеча устарела. Переподключение к ' + adapter.source + '.';
    if (market.base === 'BTC') element('btc-source').textContent = adapter.source + ' · данные устарели · ' + timestamp(priceTime);
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
        chart = window.LightweightCharts.createChart(host, { ...chartStyle, width: host.clientWidth, height: host.clientHeight });
        const priceFormat = step > 0 ? { type: 'price', minMove: step } : {
          type: 'custom', formatter: value => value.toLocaleString('ru-RU', { maximumSignificantDigits: 10 }),
        };
        prices = chart.addCandlestickSeries({ ...candleStyle, priceFormat });
        average = chart.addLineSeries({ color: '#c49bef', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'MA 7' });
        volumes = chart.addHistogramSeries({ priceScaleId: 'volume', priceFormat: { type: 'volume' } });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
        resize.observe(host);
      }
      rawBars = snapshot.candles.slice();
      priceSource = snapshot.unit;
      priceTime = snapshot.timestamp;
      priceState = 'история';
      paintPrice(true);
      let lastTime = snapshot.candles.at(-1).time;
      let lastEvent = 0;
      const watch = () => {
        clearTimeout(timer);
        timer = setTimeout(retry, 30000);
      };
      closeSocket = adapter.streamCandles((candle, eventTime) => {
        if (!active() || candle.time < lastTime || !eventTime || eventTime <= lastEvent) return;
        if (candle.time > lastTime + 300) return retry();
        if (candle.time === lastTime) rawBars[rawBars.length - 1] = candle;
        else {
          rawBars.push(candle);
          if (rawBars.length > 600) rawBars.shift();
        }
        priceTime = eventTime;
        priceState = 'LIVE';
        paintPrice(false);
        lastTime = candle.time;
        lastEvent = eventTime;
        delay = 1000;
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

function updateFavorite() {
  const button = element('favorite');
  const saved = favorites.has(selectedKey);
  button.disabled = !selectedKey;
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', saved ? 'Убрать из избранного' : 'Добавить в избранное');
  button.textContent = saved ? '★' : '☆';
}
element('favorite').addEventListener('click', () => {
  if (!selectedKey) return;
  if (favorites.has(selectedKey)) favorites.delete(selectedKey);
  else favorites.add(selectedKey);
  try { localStorage.setItem(favoritesKey, JSON.stringify([...favorites])); } catch { /* Session-only favorites. */ }
  updateFavorite();
  if (favoritesOnly) { offset = 0; render(); }
});
for (const name of ['all', 'favorites']) element(name).addEventListener('click', () => {
  favoritesOnly = name === 'favorites';
  element('all').setAttribute('aria-pressed', String(!favoritesOnly));
  element('favorites').setAttribute('aria-pressed', String(favoritesOnly));
  offset = 0;
  render();
});
element('timeframes').addEventListener('click', event => {
  const target = event.target.closest('button[data-minutes]');
  if (!target) return;
  timeframe = Number(target.dataset.minutes);
  for (const button of element('timeframes').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button === target));
  }
  redrawPrice?.();
});

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
if (document.body.hasAttribute('data-default-market')) {
  const { markets } = searchCatalogue(catalogue, 'BTCUSDT', { venue: 'bybit', type: 'spot', limit: 50 });
  const initial = markets.find(market => market.id === 'BTCUSDT' && market.active === true);
  if (initial) open(initial);
}
