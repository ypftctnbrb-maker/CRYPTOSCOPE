import { request } from './venue-discovery.mjs';
import { venues } from './venue-discovery-sources.mjs';

export const venueNames = { bybit: 'Bybit', hyperliquid: 'Hyperliquid', okx: 'OKX', bitfinex: 'Bitfinex', mexc: 'MEXC' };
const identity = market => JSON.stringify([market.venue, market.type, market.id]);

export function reconcileScopes(previous, received, retrievedAt) {
  const scopes = new Map(previous.map(scope => [scope.scope, scope]));
  if (received.some(scope => scope.scope === 'perp') && !received.some(scope => scope.scope === 'perp-dex-list')) {
    const observed = new Set(received.map(scope => scope.scope));
    for (const name of scopes.keys()) {
      if (name.startsWith('perp:') && !observed.has(name)) scopes.delete(name);
    }
    scopes.delete('perp-dex-list');
  }
  for (const next of received) {
    const prior = scopes.get(next.scope);
    if (next.status === 'complete') {
      scopes.set(next.scope, { ...next, retrievedAt });
      continue;
    }
    const markets = new Map();
    for (const market of [...(prior?.markets ?? []), ...(prior?.unknownMarkets ?? [])]) {
      markets.set(identity(market), { ...market, stale: true, observedAt: market.observedAt ?? prior.retrievedAt });
    }
    for (const market of [...(next.markets ?? []), ...(next.unknownMarkets ?? [])]) {
      markets.set(identity(market), { ...market, observedAt: retrievedAt });
    }
    scopes.set(next.scope, { ...next, markets: [...markets.values()], unknownMarkets: [],
      retrievedAt: prior?.retrievedAt ?? retrievedAt, attemptedAt: retrievedAt });
  }
  return [...scopes.values()];
}

export function searchCatalogue(catalogue, query, { venue = '', type = '', offset = 0, limit = 50 } = {}) {
  const terms = query.trim().toLowerCase().split(/\s+/);
  const matches = new Map();
  for (const [name, scopes] of Object.entries(catalogue)) {
    if (venue && venue !== name) continue;
    for (const scope of scopes) {
      for (const market of [...scope.markets, ...(scope.unknownMarkets ?? [])]) {
        if (type && type !== market.type) continue;
        const haystack = [market.id, market.base, market.quote, market.settle, name, market.type].join(' ').toLowerCase();
        if (terms.every(term => haystack.includes(term))) {
          matches.set(identity(market), { ...market, observedAt: market.observedAt ?? scope.retrievedAt });
        }
      }
    }
  }
  return { total: matches.size, markets: [...matches.values()].slice(offset, offset + limit) };
}

export async function refreshCatalogue(onVenue) {
  const json = request([]);
  const names = Object.keys(venues);
  for (let offset = 0; offset < names.length; offset += 2) {
    await Promise.all(names.slice(offset, offset + 2).map(async name => {
      let scopes;
      try {
        scopes = await venues[name](json);
      } catch (error) {
        scopes = [{ scope: 'venue', status: 'unavailable', markets: [], error: error.message }];
      }
      onVenue(name, scopes, new Date().toISOString());
    }));
  }
}
