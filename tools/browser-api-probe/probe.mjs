import { instruments, restEndpoints, scenarios } from './fixtures.mjs';

export const defaults = { timeoutMs: 10000, observationMs: 60000, pauseMs: 1500, repeats: 30 };
export const statuses = { pass: 'ПРОЙДЕНО', error: 'ОШИБКА', skip: 'НЕ ЗАПУЩЕНО', unclear: 'НЕОДНОЗНАЧНО' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const numeric = value => typeof value === 'number' ? Number.isFinite(value) :
  typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));

function valid(endpoint, data) {
  if (endpoint === 'candles') return Array.isArray(data) && data.length > 0 &&
    data.every(row => row && ['time', 'open', 'high', 'low', 'close', 'volume'].every(k => numeric(row[k])));
  if (endpoint === 'trades') return Array.isArray(data) && data.length > 0 &&
    data.every(row => row && ['id', 'time', 'price', 'quantity'].every(k => numeric(row[k])) && ['buy', 'sell'].includes(row.side));
  const keys = { time: ['serverTime'], ticker: ['price'], oi: ['value', 'time'], funding: ['value', 'time'] };
  return Boolean(data && keys[endpoint]?.every(k => numeric(data[k])));
}

function mockUrl(origin, path, params) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port ||
      base.username || base.password || base.href !== base.origin + '/') {
    throw new TypeError('Only the loopback fixture origin is allowed');
  }
  const url = new URL(path, base);
  url.search = new URLSearchParams(params).toString();
  return url;
}

async function rest(origin, endpoint, scenario, instrument, timeoutMs) {
  const start = performance.now();
  const record = (status, detail) => ({ status, elapsedMs: performance.now() - start, ...detail });
  if (instrument === 'spot' && ['oi', 'funding'].includes(endpoint)) {
    return record(statuses.skip, { reason: 'not-applicable-to-spot' });
  }
  const url = mockUrl(origin, '/rest/' + endpoint, { scenario, instrument });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const opaque = scenario === 'rest-opaque';
    const response = await fetch(url, { mode: opaque ? 'no-cors' : 'cors',
      credentials: 'omit', cache: 'no-store', redirect: opaque ? 'follow' : 'error', signal: controller.signal });
    if (response.type === 'opaque') return record(statuses.unclear, { reason: 'opaque-response' });
    if (!response.ok) return record(statuses.error, { errorClass: 'http', httpStatus: response.status });
    const data = await response.json();
    return valid(endpoint, data) ? record(statuses.pass, { httpStatus: response.status, data }) :
      record(statuses.error, { errorClass: 'invalid-payload', httpStatus: response.status });
  } catch (error) {
    if (controller.signal.aborted) return record(statuses.error, { errorClass: 'timeout' });
    if (error instanceof SyntaxError) return record(statuses.error, { errorClass: 'invalid-json' });
    return record(statuses.unclear, { reason: 'fetch-rejected', observed: error.name });
  } finally {
    clearTimeout(timer);
  }
}

function observe(origin, scenario, attempt, options) {
  const url = mockUrl(origin, '/ws', { scenario, attempt });
  url.protocol = 'ws:';
  return new Promise(resolve => {
    const start = performance.now();
    const elapsed = () => performance.now() - start;
    const expectsAck = scenarios[scenario].ack;
    const times = { T_open: null, T_ack: expectsAck ? null : 'not-in-protocol', T_first: null, T_trade: null };
    const tally = { messages: 0, trades: 0, duplicateIds: 0, gapEvents: 0, invalidFrames: 0 };
    const ids = new Set();
    let largestId = null, lastMessage = null, maxPauseMs = 0, timer, finished = false, transportError = false;
    const ws = new WebSocket(url);
    function finish(status, detail) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const total = elapsed();
      const observedMs = times.T_open === null ? 0 : total - times.T_open;
      if (times.T_open !== null) maxPauseMs = Math.max(maxPauseMs, total - (lastMessage ?? times.T_open));
      ws.close();
      resolve({ attempt, status, ...detail, ...times, ...tally, observedMs, maxPauseMs, transportError,
        messagesPerSecond: observedMs > 0 ? tally.messages * 1000 / observedMs : null });
    }
    timer = setTimeout(() => finish(statuses.error, { errorClass: 'open-timeout' }), options.timeoutMs);
    ws.onopen = () => {
      times.T_open = elapsed();
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (times.T_first === null) return finish(statuses.error, { errorClass: 'no-message' });
        if (expectsAck && times.T_ack === null) return finish(statuses.error, { errorClass: 'no-ack' });
        if (tally.invalidFrames) return finish(statuses.error, { errorClass: 'invalid-frame' });
        if (tally.duplicateIds || tally.gapEvents) return finish(statuses.error, { errorClass: 'sequence-anomaly' });
        finish(statuses.pass, { reason: tally.trades ? 'observation-complete' : 'no-trades-observed' });
      }, options.observationMs);
    };
    ws.onmessage = ({ data }) => {
      const now = elapsed();
      times.T_first ??= now;
      maxPauseMs = Math.max(maxPauseMs, now - (lastMessage ?? times.T_open));
      lastMessage = now;
      tally.messages++;
      let message;
      try { message = JSON.parse(data); } catch { tally.invalidFrames++; return; }
      if (message?.kind === 'ack' && expectsAck) times.T_ack ??= now;
      if (message?.kind !== 'trade') return;
      if (!Number.isSafeInteger(message.id)) { tally.invalidFrames++; return; }
      times.T_trade ??= now;
      tally.trades++;
      if (ids.has(message.id)) tally.duplicateIds++;
      else if (largestId !== null && message.id > largestId + 1) tally.gapEvents++;
      ids.add(message.id);
      largestId = largestId === null ? message.id : Math.max(largestId, message.id);
    };
    ws.onerror = () => { transportError = true; };
    ws.onclose = ({ code, wasClean }) => {
      const normal = wasClean && (code === 1000 || code === 1001);
      finish(normal ? statuses.unclear : statuses.error, { closeCode: code, wasClean,
        ...(normal ? { reason: 'normal-close-before-observation-end' } : { errorClass: 'ws-close' }) });
    };
  });
}

export function plan(scenario, instrument, repeats, metadata) {
  if (!Object.hasOwn(scenarios, scenario) || !Object.hasOwn(instruments, instrument) ||
      !Number.isInteger(repeats) || repeats < 1 || repeats > defaults.repeats) throw new TypeError('Invalid suite');
  const config = scenarios[scenario];
  const endpoints = config.endpoint === '*' ? restEndpoints : [config.endpoint ?? 'stream'];
  return Array.from({ length: repeats }, (_, i) => endpoints.map(endpoint => ({
    mode: 'mock', scenario, instrument: instruments[instrument].id, instrumentType: instruments[instrument].type,
    endpoint, iteration: i + 1, utc: new Date().toISOString(), ...metadata, status: statuses.skip, reason: 'pending',
  }))).flat();
}

export async function execute(row, origin, instrument, options = defaults) {
  const { reason, ...metadata } = row;
  const utc = new Date().toISOString();
  const scenario = row.scenario;
  const settings = { ...defaults, ...options };
  if (scenarios[scenario].transport === 'rest') {
    return { ...metadata, utc, timeoutMs: settings.timeoutMs,
      ...await rest(origin, row.endpoint, scenario, instrument, settings.timeoutMs) };
  }
  const initial = await observe(origin, scenario, 'initial', settings);
  const result = { ...metadata, utc, timeoutMs: settings.timeoutMs, observationMs: settings.observationMs,
    ...initial, recovery: { status: statuses.skip, reason: 'not-required' },
    coldFallback: { status: statuses.skip, reason: 'not-required' } };
  if (['ws-drop', 'ws-cold-fallback'].includes(scenario)) {
    await delay(settings.pauseMs);
    const retry = await observe(origin, scenario, 'retry', settings);
    result.recovery = { ...retry, recovered: retry.status === statuses.pass && retry.T_trade !== null };
    if (!result.recovery.recovered) {
      result.coldFallback = await rest(origin, 'ticker', 'rest-ok', instrument, settings.timeoutMs);
    }
  }
  return result;
}
