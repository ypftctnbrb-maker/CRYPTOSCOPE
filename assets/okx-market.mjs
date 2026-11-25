const host = 'https://www.okx.com/api/v5/';
const socketHost = 'wss://ws.okx.com:8443/ws/v5/business';
let retryAt = 0;

function positive(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

async function publicJson(url, signal) {
  if (Date.now() < retryAt) throw Object.assign(Error('OKX REST rate limited'), { retryAt });
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (response.status === 429) {
    const after = response.headers.get('Retry-After');
    const now = Date.now();
    const deadline = /^\d+$/.test(after ?? '') ? now + Number(after) * 1000 : Date.parse(after);
    retryAt = Math.max(now + 30000, Number.isFinite(deadline) ? Math.min(deadline, now + 120000) : 0);
    throw Object.assign(Error('OKX REST rate limited'), { retryAt });
  }
  if (!response.ok) throw Error('OKX HTTP ' + response.status);
  return response.json();
}

export async function resolveOkxContract(instrument, signal, getJson = publicJson) {
  if (instrument.type === 'spot' || instrument.contractSizeUnit) return instrument;
  const query = new URLSearchParams({ instType: 'SWAP', instId: instrument.id });
  const result = await getJson(host + 'public/instruments?' + query, signal);
  const row = result.code === '0' && result.data?.find(item => item.instId === instrument.id);
  if (!row || !positive(row.ctVal) || ![instrument.base, instrument.quote].includes(row.ctValCcy)) {
    throw Error('OKX contract specification unavailable');
  }
  return { ...instrument, contractSize: row.ctVal, contractSizeUnit: row.ctValCcy,
    precision: { ...instrument.precision, price: row.tickSz } };
}

export function okxAdapter(instrument, getJson = publicJson) {
  if (instrument.venue !== 'okx' || !['spot', 'perp'].includes(instrument.type)) throw Error('Unsupported instrument');
  const spot = instrument.type === 'spot';
  const instId = instrument.id;
  const source = 'OKX ' + (spot ? 'spot' : 'swap') + ' · ' + instId;
  const contractSize = spot ? 1 : positive(instrument.contractSize);
  const volumeUnit = spot ? instrument.base : instrument.contractSizeUnit;
  const supportedUnit = volumeUnit && [instrument.base, instrument.quote].includes(volumeUnit);

  function trade(row) {
    const price = positive(row.px), size = positive(row.sz), time = positive(row.ts);
    const quantity = size * contractSize;
    if (!supportedUnit || !Number.isFinite(quantity) || quantity <= 0 || !price || !time ||
        typeof row.tradeId !== 'string' || !row.tradeId || !['buy', 'sell'].includes(row.side)) return null;
    return { id: row.tradeId, price, quantity, time, side: row.side === 'buy' ? 'Buy' : 'Sell' };
  }

  function candle(row) {
    if (!Array.isArray(row)) return null;
    const [time, open, high, low, close] = row.slice(0, 5).map(positive);
    const rawVolume = row[5];
    const volume = Number(rawVolume) * contractSize;
    if (!supportedUnit || !contractSize || !time || !open || !high || !low || !close ||
        rawVolume == null || rawVolume === '' || !Number.isFinite(volume) || volume < 0) return null;
    return { time: time / 1000, open, high, low, close, volume };
  }

  async function query(path, parameters, signal = new AbortController().signal) {
    const result = await getJson(host + path + '?' + new URLSearchParams({ instId, ...parameters }), signal);
    if (result.code !== '0' || !Array.isArray(result.data)) {
      throw Error('OKX ' + result.code + ': ' + result.msg);
    }
    return result.data;
  }

  function stream(channel, onRows, onDisconnect) {
    const socket = new WebSocket(socketHost);
    let heartbeat;
    socket.onopen = () => {
      socket.send(JSON.stringify({ op: 'subscribe', args: [{ channel, instId }] }));
      heartbeat = setInterval(() => {
        if (socket.readyState === 1) socket.send('ping');
      }, 15000);
    };
    socket.onmessage = ({ data }) => {
      if (data === 'pong') return;
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message?.event === 'error' || message?.event === 'notice') return onDisconnect();
      if (message?.arg?.channel === channel && message.arg.instId === instId && Array.isArray(message.data)) {
        onRows(message.data);
      }
    };
    socket.onerror = socket.onclose = onDisconnect;
    return () => {
      clearInterval(heartbeat);
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    };
  }

  return {
    source, volumeUnit: supportedUnit ? volumeUnit : null, priceStep: positive(instrument.precision?.price),
    async getCandles(signal) {
      const rows = await query('market/candles', { bar: '5m', limit: '120' }, signal);
      const candles = rows.map(candle).filter(Boolean).reverse();
      return { source, timestamp: candles.at(-1)?.time * 1000 || null, unit: volumeUnit, candles };
    },
    async getTrades(signal) {
      const rows = await query('market/history-trades', { limit: '100' }, signal);
      const distinct = new Map();
      for (const row of rows) {
        const result = row?.instId === instId && trade(row);
        if (result) distinct.set(result.id, result);
      }
      const trades = [...distinct.values()];
      return { source, timestamp: trades.length ? Math.max(...trades.map(row => row.time)) : null, unit: volumeUnit, trades };
    },
    async getOI(signal) {
      if (spot) return { source, value: null, timestamp: null };
      const [row] = await query('public/open-interest', { instType: 'SWAP' }, signal);
      return { source, value: row?.oiCcy === '0' ? 0 : positive(row?.oiCcy), timestamp: positive(row?.ts), unit: instrument.base };
    },
    async getFunding(signal) {
      if (spot) return { source, value: null, timestamp: null };
      const [row] = await query('public/funding-rate-history', { limit: '1' }, signal);
      const rate = row?.realizedRate;
      return { source, value: rate && Number.isFinite(Number(rate)) ? Number(rate) : null,
        timestamp: positive(row?.fundingTime), unit: 'ratio' };
    },
    streamCandles(onCandle, onDisconnect) {
      return stream('candle5m', rows => {
        for (const row of rows) {
          const result = candle(row);
          if (result) onCandle(result, Date.now());
        }
      }, onDisconnect);
    },
    streamTrades(onTrades, onDisconnect) {
      return stream('trades-all', rows => {
        const trades = rows.filter(row => row?.instId === instId).map(trade).filter(Boolean);
        if (trades.length) onTrades(trades);
      }, onDisconnect);
    },
  };
}
