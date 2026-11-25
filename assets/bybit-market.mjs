const host = 'https://api.bybit.com/v5/market/';
let retryAt = 0;

function rateLimit() {
  return Object.assign(Error('Bybit REST rate limited'), { retryAt });
}
const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) &&
  Number.isFinite(Number(value)) ? Number(value) : null;
const candle = (time, open, high, low, close, volume) => {
  const values = [time, open, high, low, close, volume].map(number);
  if (values.some(value => value === null) || values[5] < 0 || values.slice(0, 5).some(value => value <= 0)) return null;
  const [timestamp, ...prices] = values;
  return { time: timestamp / 1000, open: prices[0], high: prices[1], low: prices[2], close: prices[3], volume: prices[4] };
};

function normalizeTrade(id, size, timestamp, rate, side) {
  const quantity = number(size), time = number(timestamp), price = number(rate);
  return typeof id === 'string' && id && ['Buy', 'Sell'].includes(side) &&
    quantity > 0 && time > 0 && price > 0 ? { id, quantity, time, price, side } : null;
}

async function publicJson(url, signal) {
  if (Date.now() < retryAt) throw rateLimit();
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (response.status === 429) {
    const after = response.headers.get('Retry-After');
    const now = Date.now();
    const deadline = after && /^\d+$/.test(after) ? now + Number(after) * 1000 : Date.parse(after);
    retryAt = Math.max(retryAt, now + 30000, Number.isFinite(deadline) ? Math.min(deadline, now + 120000) : 0);
    throw rateLimit();
  }
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json();
}

export function bybitAdapter(instrument, getJson = publicJson) {
  if (instrument.venue !== 'bybit' || !['spot', 'perp'].includes(instrument.type)) throw Error('Unsupported instrument');
  const category = instrument.type === 'spot' ? 'spot' : instrument.inverse === true ? 'inverse' : 'linear';
  const symbol = instrument.id;
  const source = 'Bybit ' + category + ' · ' + symbol;
  const volumeUnit = category === 'inverse' ? instrument.quote : instrument.base;
  async function query(path, parameters, signal = new AbortController().signal) {
    const result = await getJson(host + path + '?' + new URLSearchParams({ category, symbol, ...parameters }), signal);
    if (result.retCode !== undefined && result.retCode !== 0) throw Error('Bybit ' + result.retCode + ': ' + result.retMsg);
    return { rows: result.result.list, timestamp: number(result.time) };
  }
  function stream(topic, onRows, onDisconnect) {
    const socket = new WebSocket('wss://stream.bybit.com/v5/public/' + category);
    let ping;
    socket.onopen = () => {
      socket.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
      ping = setInterval(() => socket.readyState === 1 && socket.send('{"op":"ping"}'), 20000);
    };
    socket.onmessage = ({ data }) => {
      try {
        const response = JSON.parse(data);
        if (response.op === 'subscribe' && response.success === false) onDisconnect();
        if (response.topic !== topic) return;
        if (Array.isArray(response.data)) onRows(response.data, response);
      } catch { /* Ignore malformed frames. */ }
    };
    socket.onerror = socket.onclose = onDisconnect;
    return () => {
      clearInterval(ping);
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    };
  }
  return {
    source, category, volumeUnit, priceStep: number(instrument.precision?.price),
    async getCandles(signal) {
      const { rows, timestamp } = await query('kline', { interval: '5', limit: '120' }, signal);
      return { source, timestamp, unit: volumeUnit, candles: rows.map(row => candle(...row)).filter(Boolean).reverse() };
    },
    async getTrades(signal) {
      const { rows, timestamp } = await query('recent-trade', { limit: '60' }, signal);
      const trades = new Map();
      for (const row of rows) {
        const trade = normalizeTrade(row.execId, row.size, row.time, row.price, row.side);
        if (trade) trades.set(trade.id, trade);
      }
      return { source, timestamp, unit: volumeUnit, trades: [...trades.values()].sort((a, b) => a.time - b.time) };
    },
    async getOI(signal) {
      if (category === 'spot') return { source, value: null, timestamp: null };
      const { rows } = await query('open-interest', { intervalTime: '5min', limit: '1' }, signal);
      return { source, value: number(rows[0]?.openInterest), timestamp: number(rows[0]?.timestamp),
        unit: category === 'inverse' ? instrument.quote : instrument.base };
    },
    async getFunding(signal) {
      if (category === 'spot') return { source, value: null, timestamp: null };
      const { rows } = await query('funding/history', { limit: '1' }, signal);
      return { source, value: number(rows[0]?.fundingRate), timestamp: number(rows[0]?.fundingRateTimestamp), unit: 'ratio' };
    },
    streamCandles(onCandle, onDisconnect) {
      return stream('kline.5.' + symbol, (rows, response) => {
        for (const row of rows) {
          const next = candle(row.start, row.open, row.high, row.low, row.close, row.volume);
          if (next) onCandle(next, number(row.timestamp ?? response.ts));
        }
      }, onDisconnect);
    },
    streamTrades(onTrades, onDisconnect) {
      return stream('publicTrade.' + symbol, rows => {
        const trades = rows.filter(row => row.s === symbol)
          .map(row => normalizeTrade(row.i, row.v, row.T, row.p, row.S)).filter(Boolean);
        if (trades.length) onTrades(trades);
      }, onDisconnect);
    },
  };
}
