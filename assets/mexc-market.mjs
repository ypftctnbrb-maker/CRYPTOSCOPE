import { candle, finite, rest, snapshot, subscribe, trade } from './public-market.mjs';
import { decodeMexc } from './mexc-protobuf.mjs';

const spotHost = 'https://api.mexc.com/api/v3/';
const perpHost = 'https://contract.mexc.com/api/v1/contract/';
const perpWs = 'wss://contract.mexc.com/edge';
const spotWs = 'wss://wbs-api.mexc.com/ws';
const spotJson = rest();
const perpJson = rest();

export function mexcAdapter(instrument, getJson) {
  const spot = instrument.type === 'spot';
  const symbol = instrument.id;
  const source = 'MEXC ' + instrument.type + ' · ' + symbol;
  const unit = spot ? instrument.base : 'контрактов';
  const precision = finite(instrument.precision?.price);
  const priceStep = precision === null ? null : spot ? 10 ** -precision : precision;
  const json = getJson ?? (spot ? spotJson : perpJson);
  const spotQuery = (route, signal, parameters = {}) =>
    json(spotHost + route + '?' + new URLSearchParams({ symbol, ...parameters }), signal);
  async function perpQuery(route, signal) {
    const result = await json(perpHost + route, signal);
    if (!result.success || result.code !== 0) throw Error('MEXC ' + result.code);
    return result.data;
  }

  const marketTrade = row => row && trade(row.i, row.t, row.p, row.v, { 1: 'Buy', 2: 'Sell' }[row.T]);
  function streamSpot(channel, receive, disconnect) {
    return subscribe(spotWs, { method: 'SUBSCRIPTION', params: [channel] }, frame => {
      if (frame?.code != null && frame.code !== 0) return disconnect();
      const value = decodeMexc(frame, channel, symbol);
      if (value) receive(value);
    }, disconnect, { method: 'PING' });
  }
  function streamPerp(topic, receive, disconnect, parameters = {}) {
    return subscribe(perpWs, { method: 'sub.' + topic, param: { symbol, ...parameters } }, frame => {
      if (frame?.channel === 'rs.error') return disconnect();
      if (frame?.channel === 'push.' + topic && frame.symbol === symbol) receive(frame.data, frame.ts);
    }, disconnect, { method: 'ping' });
  }

  return {
    source, volumeUnit: unit, priceStep,
    async getCandles(signal) {
      if (spot) {
        const rows = await spotQuery('klines', signal, { interval: '5m', limit: '120' });
        return snapshot(source, unit, rows.map(row => candle(...row.slice(0, 6))), 'candles');
      }
      const data = await perpQuery('kline/' + symbol + '?interval=Min5', signal);
      return snapshot(source, unit, data.time.map((time, index) =>
        candle(time * 1000, data.open[index], data.high[index], data.low[index], data.close[index], data.vol[index])
      ).slice(-120), 'candles');
    },
    async getTrades(signal) {
      if (spot) {
        const rows = await spotQuery('trades', signal, { limit: '100' });
        const result = snapshot(source, unit, rows.map(row => trade(row.id, row.time, row.price, row.qty,
          row.isBuyerMaker === true ? 'Sell' : row.isBuyerMaker === false ? 'Buy' : null)), 'trades');
        if (rows.some(row => row.id == null)) result.coverageNote = 'Часть сделок REST без ID, дедупликация невозможна';
        return result;
      }
      const rows = await perpQuery('deals/' + symbol, signal);
      return snapshot(source, unit, rows.map(marketTrade), 'trades');
    },
    async getOI(signal) {
      if (spot) return { source, value: null, timestamp: null };
      const row = await perpQuery('ticker?symbol=' + symbol, signal);
      return { source, value: row.symbol === symbol ? finite(row.holdVol) : null, unit, timestamp: finite(row.timestamp) };
    },
    async getFunding(signal) {
      if (spot) return { source, value: null, timestamp: null };
      const row = await perpQuery('funding_rate/' + symbol, signal);
      return { source, value: row.symbol === symbol ? finite(row.fundingRate) : null, unit: 'ratio', timestamp: finite(row.timestamp) };
    },
    streamCandles(onCandle, disconnect) {
      if (spot) return streamSpot('spot@public.kline.v3.api.pb@' + symbol + '@Min5', row => {
        const value = row.candle && candle(...row.candle);
        if (value && row.timestamp > 0) onCandle(value, row.timestamp);
      }, disconnect);
      return streamPerp('kline', (row, timestamp) => {
        if (row?.symbol !== symbol || row.interval !== 'Min5') return;
        const value = candle(row.t * 1000, row.o, row.h, row.l, row.c, row.q);
        if (value && timestamp > 0) onCandle(value, timestamp);
      }, disconnect, { interval: 'Min5' });
    },
    streamTrades(onTrades, disconnect) {
      const receive = rows => {
        const trades = (Array.isArray(rows) ? rows : [rows]).map(marketTrade).filter(Boolean);
        if (trades.length) onTrades(trades);
      };
      return spot ? streamSpot('spot@public.aggre.deals.v3.api.pb@100ms@' + symbol,
        row => { if (row.trades) receive(row.trades); }, disconnect) : streamPerp('deal', receive, disconnect);
    },
  };
}
