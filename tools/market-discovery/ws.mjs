function probe(url, subscription, identify, { binary = false } = {}) {
  return () => new Promise(resolve => {
    const started = Date.now();
    let socket;
    const timer = setTimeout(() => finish('unavailable', 'No matching trade frame within 10s'), 10000);
    function finish(status, evidence) {
      clearTimeout(timer);
      if (socket) {
        socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
      }
      resolve({ url, subscription, status, evidence,
        startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started });
    }
    try {
      socket = new WebSocket(url);
      if (binary) socket.binaryType = 'arraybuffer';
      socket.onopen = () => socket.send(JSON.stringify(subscription));
      socket.onmessage = ({ data }) => {
        try {
          const frame = typeof data === 'string' ? JSON.parse(data) : data;
          const evidence = identify(frame);
          if (evidence) finish(evidence.status ?? 'observed', evidence);
        } catch { /* Ignore unsolicited frames. */ }
      };
      socket.onerror = event => finish('unavailable', event.message || 'WebSocket transport error');
      socket.onclose = event => finish('unavailable', 'WebSocket closed ' + event.code);
    } catch (error) {
      finish('unavailable', error.message);
    }
  });
}

const bybit = type => probe('wss://stream.bybit.com/v5/public/' + type,
  { op: 'subscribe', args: ['publicTrade.BTCUSDT'] },
  frame => frame.topic === 'publicTrade.BTCUSDT' && frame.data?.length ? { timestamp: frame.data.at(-1).T } : null);
const hyperliquid = coin => probe('wss://api.hyperliquid.xyz/ws',
  { method: 'subscribe', subscription: { type: 'trades', coin } },
  frame => frame.channel === 'trades' && frame.data?.some(trade => trade.coin === coin) ? { timestamp: frame.data.find(trade => trade.coin === coin).time, coin } : null);
const okx = instId => probe('wss://ws.okx.com:8443/ws/v5/public',
  { op: 'subscribe', args: [{ channel: 'trades', instId }] },
  frame => frame.arg?.instId === instId && frame.data?.length ? { timestamp: frame.data.at(-1).ts } : null);
const bitfinex = symbol => probe('wss://api-pub.bitfinex.com/ws/2',
  { event: 'subscribe', channel: 'trades', symbol },
  frame => Array.isArray(frame?.[2]) && ['te', 'tu'].includes(frame[1]) ? { timestamp: frame[2][1] } : null);
const mexcSpotChannel = 'spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT';

export const sockets = {
  bybit: { spot: bybit('spot'), perp: bybit('linear') },
  hyperliquid: { spot: hyperliquid('@142'), perp: hyperliquid('BTC') },
  okx: { spot: okx('BTC-USDT'), perp: okx('BTC-USDT-SWAP') },
  bitfinex: { spot: bitfinex('tBTCUSD'), perp: bitfinex('tBTCF0:USTF0') },
  mexc: {
    spot: probe('wss://wbs-api.mexc.com/ws', { method: 'SUBSCRIPTION', params: [mexcSpotChannel] },
      frame => frame instanceof ArrayBuffer && new TextDecoder().decode(frame).includes(mexcSpotChannel)
        ? { status: 'binary-envelope-only', bytes: frame.byteLength } : null, { binary: true }),
    perp: probe('wss://contract.mexc.com/edge', { method: 'sub.deal', param: { symbol: 'BTC_USDT' } },
      frame => frame.channel === 'push.deal' && frame.symbol === 'BTC_USDT' && frame.data
        ? { timestamp: (Array.isArray(frame.data) ? frame.data.at(-1) : frame.data)?.t ?? frame.ts } : null),
  },
};
