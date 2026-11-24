const sleepDefault = delay => new Promise(resolve => setTimeout(resolve, delay));

export function instrument(venue, type, id, fields = {}) {
  if (typeof id !== 'string' || !id) throw Error('Missing instrument ID');
  return {
    venue, type, id, base: null, quote: null, settle: null, active: null,
    precision: null, contractSize: null, linear: null, inverse: null,
    exchangeTimestamp: null, ...fields,
  };
}

export function inventory(scope, rows, error = null) {
  const unique = new Map();
  const comparable = ({ provenance, exchangeTimestamp, ...fields }) => JSON.stringify(fields);
  for (const market of rows) {
    const key = JSON.stringify([market.venue, market.type, market.id]);
    if (unique.has(key) && comparable(unique.get(key)) !== comparable(market)) {
      error ||= 'Conflicting duplicate market ID';
    }
    unique.set(key, market);
  }
  const all = [...unique.values()];
  const unknownMarkets = all.filter(market => market.active === null);
  const unknownCount = unknownMarkets.length;
  const markets = all.filter(market => market.active === true);
  const status = error ? (rows.length ? 'partial' : 'unavailable') : unknownCount ? 'partial' : 'complete';
  return {
    scope, status, count: status === 'complete' ? markets.length : null,
    observedActiveCount: status === 'unavailable' ? null : markets.length,
    duplicateCount: rows.length - all.length, unknownCount,
    inactiveCount: all.filter(market => market.active === false).length, error, markets, unknownMarkets,
  };
}

export async function collect(scope, page) {
  const rows = [];
  const cursors = new Set();
  let cursor;
  try {
    do {
      if (cursors.has(cursor) || cursors.size >= 25) throw Error('Repeated cursor or pagination limit');
      cursors.add(cursor);
      const response = await page(cursor);
      if (!Array.isArray(response.rows)) throw Error('Expected a market array');
      rows.push(...response.rows);
      cursor = response.next;
    } while (cursor);
    return { ...inventory(scope, rows), pages: cursors.size };
  } catch (error) {
    return { ...inventory(scope, rows, error.message), pages: cursors.size };
  }
}

export function request(evidence, { fetch = globalThis.fetch, sleep = sleepDefault } = {}) {
  return async (url, body) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      const record = { url, body: body ?? null, attempt, retrievedAt: new Date(started).toISOString(), http: null };
      evidence.push(record);
      try {
        const response = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: { accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(12000),
        });
        record.http = response.status;
        record.serverDate = response.headers.get('Date');
        record.retryAfter = response.headers.get('Retry-After');
        if (!response.ok) {
          await response.body?.cancel();
          const raw = record.retryAfter;
          const delay = raw === null ? 1000 : /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
          if (response.status === 429 && attempt === 1 && Number.isFinite(delay) && delay <= 5000) {
            await sleep(Math.max(250, delay));
            continue;
          }
          throw Error('HTTP ' + response.status);
        }
        return await response.json();
      } catch (error) {
        record.error = error.cause?.code || error.message;
        throw error;
      } finally {
        record.elapsedMs = Date.now() - started;
      }
    }
  };
}

export function bybit(json) {
  return Promise.all(['spot', 'linear', 'inverse'].map(category => collect(category, async cursor => {
    const query = new URLSearchParams({ category });
    // Bybit spot is unpaginated. Derivatives use cursor and explicit page size.
    if (category !== 'spot') query.set('limit', '1000');
    if (cursor) query.set('cursor', cursor);
    const url = 'https://api.bybit.com/v5/market/instruments-info?' + query;
    const response = await json(url);
    if (response.retCode !== 0) throw Error('Bybit ' + response.retCode + ': ' + response.retMsg);
    const spot = category === 'spot';
    const rows = response.result.list.filter(row => spot || /Perpetual$/.test(row.contractType));
    return {
      rows: rows.map(row => instrument('bybit', spot ? 'spot' : 'perp', row.symbol, {
        base: row.baseCoin, quote: row.quoteCoin, settle: row.settleCoin || null,
        active: row.status ? row.status === 'Trading' : null,
        precision: { price: row.priceFilter?.tickSize ?? null,
          amount: row.lotSizeFilter?.qtyStep ?? row.lotSizeFilter?.basePrecision ?? null, mode: 'tick-size' },
        linear: spot ? null : category === 'linear', inverse: spot ? null : category === 'inverse',
        exchangeTimestamp: response.time ?? null, provenance: url,
      })),
      next: response.result.nextPageCursor,
    };
  })));
}
