export const instruments = {
  spot: { id: 'MOCK-SPOT', type: 'spot' },
  futures: { id: 'MOCK-PERP', type: 'futures-perpetual' },
};

export const restEndpoints = ['time', 'ticker', 'candles', 'trades', 'oi', 'funding'];
export const scenarios = {
  'rest-ok': { transport: 'rest', endpoint: '*' },
  'rest-timeout': { transport: 'rest', endpoint: 'ticker' },
  'rest-451-readable': { transport: 'rest', endpoint: 'ticker' },
  'rest-451-no-cors': { transport: 'rest', endpoint: 'ticker' },
  'rest-no-cors': { transport: 'rest', endpoint: 'ticker' },
  'rest-opaque': { transport: 'rest', endpoint: 'ticker' },
  'ws-normal': { transport: 'ws', ack: true },
  'ws-no-trades': { transport: 'ws', ack: false },
  'ws-no-ack': { transport: 'ws', ack: true },
  'ws-silent': { transport: 'ws', ack: false },
  'ws-close-1000': { transport: 'ws', ack: false },
  'ws-close-1001': { transport: 'ws', ack: false },
  'ws-close-1011': { transport: 'ws', ack: false },
  'ws-drop': { transport: 'ws', ack: false },
  'ws-cold-fallback': { transport: 'ws', ack: false },
  'ws-duplicates-gaps': { transport: 'ws', ack: false },
};

export function fixture(endpoint) {
  const t = 1700000000000;
  return ({
    time: { serverTime: t },
    ticker: { price: '100.25' },
    candles: [{ time: t, open: '100', high: '101', low: '99', close: '100.25', volume: '8' }],
    trades: [{ id: 1, time: t, price: '100.25', quantity: '2', side: 'buy' }],
    oi: { value: '150', time: t },
    funding: { value: '-0.0001', time: t },
  })[endpoint];
}

export function wsPlan(scenario, attempt) {
  const heartbeat = { kind: 'heartbeat' };
  const trade = id => ({ kind: 'trade', id, quantity: '2' });
  const live = [[1, heartbeat], [2, trade(1)], [4, trade(2)]];
  const close = Number(scenario.match(/^ws-close-(1000|1001|1011)$/)?.[1]);
  if (close) return [...live, [5, { close }]];
  if (scenario === 'ws-normal') return [...live.slice(0, 1), [1.5, { kind: 'ack' }], ...live.slice(1)];
  if (scenario === 'ws-silent') return [];
  if (scenario === 'ws-no-trades' || scenario === 'ws-no-ack') return [[1, heartbeat], [3, heartbeat]];
  if (scenario === 'ws-duplicates-gaps') return [[1, trade(1)], [2, trade(1)], [3, trade(3)]];
  if (scenario === 'ws-drop' && attempt === 'initial') return [[1, heartbeat], [3, { drop: true }]];
  if (scenario === 'ws-cold-fallback') return attempt === 'initial' ? [[2, { drop: true }]] : [[1, { drop: true }]];
  return live;
}
