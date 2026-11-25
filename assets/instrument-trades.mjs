const candleMs = 300000;
const staleMs = 15000;

const signedVolume = trade => trade.side === 'Buy' ? trade.quantity : -trade.quantity;

function addTrade(bar, trade) {
  bar.close += signedVolume(trade);
  bar.high = Math.max(bar.high, bar.close);
  bar.low = Math.min(bar.low, bar.close);
  bar.last = trade.time;
  bar.delta = bar.close - bar.open;
  bar.cumulative = bar.close;
}

function newBar(time, open, segment, first) {
  return { time, open, high: open, low: open, close: open, segment, first };
}

function compareTrades(a, b) {
  // Preserve the venue's frame order for timestamps shared by multiple executions.
  return a.time - b.time;
}

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
    let openBuckets = new Map();
    let closedBars = [];
    function barsForOpenBuckets() {
      let previous = closedBars.at(-1)?.close ?? 0;
      return [...openBuckets.values()].map(({ bar }) => {
        const result = { ...bar, open: previous, high: previous + bar.high, low: previous + bar.low,
          close: previous + bar.close, cumulative: previous + bar.close };
        previous = result.close;
        return result;
      });
    }
    render({ state: 'waiting', segment });
    close = adapter.streamTrades(trades => {
      if (stopped || current !== generation || !close) return;
      const now = clock.Date.now();
      let updated = false;
      for (const trade of [...trades].sort(compareTrades)) {
        if (trade.time <= Math.max(previousEnd, now - staleMs) || trade.time > now + 1000) continue;
        const candle = Math.floor(trade.time / candleMs) * candleMs;
        if (segment && (trade.time < segment.start || candle < segment.candle - candleMs)) continue;
        // Restart when no verified adjacent candle can connect the segment.
        if (!segment || candle > segment.candle + candleMs) {
          segment = { start: trade.time, candle, delta: 0, cumulative: 0, latest: trade.time };
          ids = new Map();
          openBuckets = new Map();
          closedBars = [];
        } else if (candle > segment.candle) {
          const finalized = barsForOpenBuckets().filter(bar => bar.time < candle - candleMs);
          for (const bar of finalized) openBuckets.delete(bar.time);
          closedBars = [...closedBars, ...finalized].slice(-118);
          segment = { ...segment, candle };
          for (const [id, bucket] of ids) if (bucket < candle - candleMs) ids.delete(id);
        }
        if (ids.has(trade.id)) continue;
        ids.set(trade.id, candle);
        let bucket = openBuckets.get(candle);
        if (!bucket) {
          bucket = { bar: newBar(candle, 0, segment.start, trade.time), trades: [] };
          openBuckets.set(candle, bucket);
        }
        bucket.trades.push(trade);
        if (trade.time < bucket.bar.last) {
          bucket.trades.sort(compareTrades);
          bucket.bar = newBar(candle, 0, segment.start, bucket.trades[0].time);
          for (const entry of bucket.trades) addTrade(bucket.bar, entry);
        } else addTrade(bucket.bar, trade);
        segment.latest = Math.max(segment.latest, trade.time);
        updated = true;
      }
      if (!updated) return;
      const bars = [...closedBars, ...barsForOpenBuckets()];
      const last = bars.at(-1);
      segment = { ...segment, bars, delta: last.delta, cumulative: last.close };
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

// REST trade windows only prove the volume in the returned sample.
// An empty bucket has no observations, so the next observed bucket starts a new segment.
export function tradeHistory(trades) {
  const seen = new Set();
  const buckets = [];
  for (const trade of [...trades].sort(compareTrades)) {
    if (seen.has(trade.id)) continue;
    seen.add(trade.id);
    const time = Math.floor(trade.time / candleMs) * candleMs;
    const previous = buckets.at(-1);
    if (previous?.time !== time) {
      const adjacent = previous?.time === time - candleMs;
      buckets.push(newBar(time, adjacent ? previous.close : 0,
        adjacent ? previous.segment : trade.time, trade.time));
    }
    addTrade(buckets.at(-1), trade);
  }
  return buckets;
}
