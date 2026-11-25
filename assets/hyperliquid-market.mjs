import { candle, finite, rest, snapshot, subscribe, trade } from './public-market.mjs';

const host = 'https://api.hyperliquid.xyz/info';
const ws = 'wss://api.hyperliquid.xyz/ws';
const publicJson = rest();

export function hyperliquidAdapter(instrument, getJson = publicJson) {
  const coin = instrument.id;
  const spot = instrument.type === 'spot';
  const source = 'Hyperliquid ' + instrument.type + ' · ' + coin;
  const unit = instrument.base;
  const dex = coin.includes(':') ? coin.split(':')[0] : '';
  const sizeDecimals = finite(instrument.precision?.amount);
  const priceStep = Number.isInteger(sizeDecimals) && sizeDecimals >= 0
    ? 10 ** -Math.max(0, (spot ? 8 : 6) - sizeDecimals) : null;
  const marketCandle = row => row?.s === coin && row.i === '5m' ? candle(row.t, row.o, row.h, row.l, row.c, row.v) : null;
  const marketTrade = row => row?.coin === coin
    ? trade(row.tid, row.time, row.px, row.sz, { B: 'Buy', A: 'Sell' }[row.side]) : null;
  const query = (body, signal) => getJson(host, signal, body);

  function stream(type, receive, disconnect) {
    return subscribe(ws, { method: 'subscribe', subscription: { type, coin, ...(type === 'candle' && { interval: '5m' }) } },
      frame => {
        if (frame?.channel === 'error') return disconnect();
        if (frame?.channel === type) receive(frame.data);
      }, disconnect, { method: 'ping' });
  }

  let contextRequest;
  function context(signal) {
    contextRequest ??= query({ type: 'metaAndAssetCtxs', ...(dex && { dex }) }, signal).then(([meta, contexts]) => {
      const index = meta.universe.findIndex(row => row.name === coin);
      return { row: contexts[index], timestamp: Date.now() };
    });
    return contextRequest;
  }

  return {
    source, volumeUnit: unit, priceStep,
    async getCandles(signal) {
      const endTime = Date.now();
      const rows = await query({ type: 'candleSnapshot', req: { coin, interval: '5m', startTime: endTime - 120 * 300000, endTime } }, signal);
      return snapshot(source, unit, rows.map(marketCandle), 'candles');
    },
    async getTrades(signal) {
      const rows = await query({ type: 'recentTrades', coin }, signal);
      return snapshot(source, unit, rows.map(marketTrade), 'trades');
    },
    async getOI(signal) {
      if (spot) return { source, value: null, timestamp: null };
      const { row, timestamp } = await context(signal);
      return { source, value: finite(row?.openInterest), timestamp, unit };
    },
    async getFunding(signal) {
      if (spot) return { source, value: null, timestamp: null };
      const { row, timestamp } = await context(signal);
      return { source, value: finite(row?.funding), timestamp, unit: 'ratio' };
    },
    streamCandles(onCandle, disconnect) {
      return stream('candle', row => {
        const value = marketCandle(row);
        if (value && value.time * 1000 >= Date.now() - 600000) onCandle(value, Date.now());
      }, disconnect);
    },
    streamTrades(onTrades, disconnect) {
      return stream('trades', rows => {
        const trades = Array.isArray(rows) ? rows.map(marketTrade).filter(Boolean) : [];
        if (trades.length) onTrades(trades);
      }, disconnect);
    },
  };
}
