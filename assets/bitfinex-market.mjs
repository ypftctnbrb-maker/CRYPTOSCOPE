import { candle, finite, rest, snapshot, subscribe, trade } from './public-market.mjs';

const host = 'https://api-pub.bitfinex.com/v2/';
const ws = 'wss://api-pub.bitfinex.com/ws/2';
const publicJson = rest();

export function bitfinexAdapter(instrument, getJson = publicJson) {
  const perp = instrument.type === 'perp';
  const symbol = 't' + instrument.id;
  const source = 'Bitfinex ' + instrument.type + ' · ' + symbol;
  // Trading quantities on the derivative feed are kept in native contract units.
  const unit = perp ? 'контрактов' : instrument.base ?? instrument.id.split(':')[0];
  const candleKey = 'trade:5m:' + symbol;
  const marketCandle = ([time, open, close, high, low, volume]) => candle(time, open, high, low, close, volume);
  const marketTrade = ([id, time, amount, price]) => trade(id, time, price, Math.abs(amount), amount > 0 ? 'Buy' : 'Sell');

  function stream(subscription, receive, disconnect) {
    let channel;
    return subscribe(ws, { event: 'subscribe', ...subscription }, frame => {
      if (frame?.event === 'error' || frame?.event === 'info' && [20051, 20060].includes(frame.code)) return disconnect();
      if (frame?.event === 'subscribed' && frame.channel === subscription.channel &&
          (subscription.symbol ? frame.symbol === symbol : frame.key === candleKey)) channel = frame.chanId;
      if (Array.isArray(frame) && channel != null && frame[0] === channel) receive(frame);
    }, disconnect);
  }

  let statusRequest;
  function status(signal) {
    statusRequest ??= getJson(host + 'status/deriv?keys=' + encodeURIComponent(symbol), signal).then(rows =>
      rows.find(row => row[0] === symbol));
    return statusRequest;
  }
  return {
    source, volumeUnit: unit, priceStep: null,
    async getCandles(signal) {
      const rows = await getJson(host + 'candles/' + candleKey + '/hist?limit=120', signal);
      return snapshot(source, unit, rows.filter(Array.isArray).map(marketCandle), 'candles');
    },
    async getTrades(signal) {
      const rows = await getJson(host + 'trades/' + symbol + '/hist?limit=100', signal);
      return snapshot(source, unit, rows.filter(Array.isArray).map(marketTrade), 'trades');
    },
    async getOI(signal) {
      if (!perp) return { source, value: null, timestamp: null };
      const row = await status(signal);
      return { source, value: [23, 24].includes(row?.length) ? finite(row[row.length === 23 ? 17 : 18]) : null,
        timestamp: finite(row?.[1]), unit };
    },
    async getFunding(signal) {
      if (!perp) return { source, value: null, timestamp: null };
      const row = await status(signal);
      return { source, value: [23, 24].includes(row?.length) ? finite(row[row.length === 23 ? 11 : 12]) : null,
        timestamp: finite(row?.[1]), unit: 'ratio' };
    },
    streamCandles(onCandle, disconnect) {
      return stream({ channel: 'candles', key: candleKey }, ([, row]) => {
        if (!Array.isArray(row) || Array.isArray(row[0])) return;
        const value = marketCandle(row);
        if (value && value.time * 1000 >= Date.now() - 600000) onCandle(value, Date.now());
      }, disconnect);
    },
    streamTrades(onTrades, disconnect) {
      return stream({ channel: 'trades', symbol }, ([, kind, row]) => {
        if (kind !== 'te' || !Array.isArray(row)) return;
        const value = marketTrade(row);
        if (value) onTrades([value]);
      }, disconnect);
    },
  };
}
