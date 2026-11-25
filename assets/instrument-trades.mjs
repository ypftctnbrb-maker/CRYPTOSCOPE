const candleMs = 300000;
const staleMs = 15000;

export function trackTradeSegments(adapter, render, clock = globalThis) {
  let close, watchdog, retryTimer, stopped, segment, current;
  let previousEnd = 0;
  let delay = 1000;

  function disconnect() {
    clock.clearTimeout(watchdog);
    close?.();
    close = null;
  }

  function retry() {
    if (stopped || !close) return;
    previousEnd = segment?.latest ?? previousEnd;
    disconnect();
    render({ state: 'stale', segment });
    retryTimer = clock.setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30000);
  }

  function connect() {
    segment = null;
    const generation = {};
    current = generation;
    let ids = new Map();
    render({ state: 'waiting', segment });
    close = adapter.streamTrades(trades => {
      if (stopped || current !== generation || !close) return;
      const now = clock.Date.now();
      let updated = false;
      for (const trade of [...trades].sort((a, b) => a.time - b.time)) {
        if (trade.time <= Math.max(previousEnd, now - staleMs) || trade.time > now + 1000) continue;
        const candle = Math.floor(trade.time / candleMs) * candleMs;
        if (segment && (trade.time < segment.start || candle < segment.candle - candleMs)) continue;
        // Restart when no verified adjacent candle can connect the segment.
        if (!segment || candle > segment.candle + candleMs) {
          segment = { start: trade.time, candle, delta: 0, cumulative: 0, latest: trade.time };
          ids = new Map();
        } else if (candle > segment.candle) {
          segment = { ...segment, candle, delta: 0 };
          for (const [id, bucket] of ids) if (bucket < candle - candleMs) ids.delete(id);
        }
        if (ids.has(trade.id)) continue;
        ids.set(trade.id, candle);
        const signed = trade.side === 'Buy' ? trade.quantity : -trade.quantity;
        if (candle === segment.candle) segment.delta += signed;
        segment.cumulative += signed;
        segment.latest = Math.max(segment.latest, trade.time);
        updated = true;
      }
      if (!updated) return;
      delay = 1000;
      render({ state: 'live', segment });
      clock.clearTimeout(watchdog);
      watchdog = clock.setTimeout(retry, Math.min(staleMs, segment.latest + staleMs - now));
    }, () => {
      if (current === generation) retry();
    });
    watchdog = clock.setTimeout(retry, staleMs);
  }

  connect();
  return () => {
    stopped = true;
    disconnect();
    clock.clearTimeout(retryTimer);
  };
}
