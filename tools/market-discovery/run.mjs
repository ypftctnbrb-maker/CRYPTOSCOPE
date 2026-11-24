import { writeFile, readFile } from 'node:fs/promises';
import ccxt from 'ccxt';
import { instrument, inventory, request } from './discovery.mjs';
import { venues } from './venues.mjs';
import { sockets } from './ws.mjs';

const packageInfo = JSON.parse(await readFile(new URL('./node_modules/ccxt/package.json', import.meta.url)));
const key = market => JSON.stringify([market.type, market.id]);
const scopesFor = (result, type) => result.filter(scope => type === 'spot' ? scope.scope === 'spot' :
  scope.scope !== 'spot');

function compare(direct, reference, type) {
  const directScopes = scopesFor(direct, type);
  const ccxtScope = reference.find(scope => scope.scope === type);
  const a = new Set(directScopes.flatMap(scope => scope.markets.map(key)));
  const b = new Set(ccxtScope.markets.map(key));
  const complete = directScopes.every(scope => scope.status === 'complete') && ccxtScope.status === 'complete';
  return {
    type, status: complete ? 'complete' : 'observed-only',
    direct: directScopes.every(scope => scope.status === 'complete') ? a.size : null,
    ccxt: ccxtScope.count,
    onlyDirect: complete ? [...a].filter(item => !b.has(item)).sort().map(JSON.parse) : null,
    onlyCcxt: complete ? [...b].filter(item => !a.has(item)).sort().map(JSON.parse) : null,
  };
}

async function queryCcxt(name, evidence) {
  const exchange = new ccxt[name]({ enableRateLimit: true, timeout: 12000, maxRetriesOnFailure: 0 });
  if (name === 'bybit') exchange.options.fetchMarkets.types = ['spot', 'linear', 'inverse'];
  if (name === 'okx') exchange.options.fetchMarkets.types = ['spot', 'swap'];
  exchange.fetchImplementation = async (url, options) => {
    const observation = { url, method: options.method, retrievedAt: new Date().toISOString(), http: null };
    evidence.push(observation);
    try {
      const response = await fetch(url, options);
      observation.http = response.status;
      return response;
    } catch (error) {
      observation.error = error.cause?.code || error.message;
      throw error;
    }
  };
  let markets = [], failure;
  try {
    await exchange.loadMarkets();
    markets = Object.values(exchange.markets);
  } catch (error) {
    failure = error.message;
  }

  const reference = ['spot', 'perp'].map(type => inventory(type, markets
    .filter(market => type === 'spot' ? market.spot : market.swap)
    .map(market => instrument(name, type, name === 'bitfinex' ? market.id.replace(/^t/, '') :
      name === 'hyperliquid' && type === 'perp' ? market.info?.name ?? market.id : market.id, {
      ccxtId: market.id,
      base: market.base ?? null, quote: market.quote ?? null, settle: market.settle ?? null,
      active: market.active ?? null, contractSize: market.contractSize ?? null,
      precision: { ...market.precision, mode: exchange.precisionMode },
      linear: market.linear ?? null, inverse: market.inverse ?? null,
      unifiedSymbol: market.symbol, provenance: 'CCXT loadMarkets',
    })), failure));

  const probes = Object.fromEntries(await Promise.all(['spot', 'perp'].map(async type => {
    const symbol = markets.find(market => market.active && market.base === 'BTC' &&
      (type === 'spot' ? market.spot : market.swap && market.linear) &&
      market.quote === (name === 'hyperliquid' ? 'USDC' : name === 'bitfinex' ? 'USD' : 'USDT'))?.symbol
      ?? markets.find(market => market.active && market.base === 'BTC' && (type === 'spot' ? market.spot : market.swap))?.symbol;
    const websocket = sockets[name][type]();
    const control = { symbol: symbol ?? null, metrics: {} };
    const methods = { fetchTrades: [symbol, undefined, 2], fetchOHLCV: [symbol, '1m', undefined, 2],
      ...(type === 'perp' && { fetchOpenInterest: [symbol], fetchFundingRate: [symbol] }) };
    for (const [method, args] of Object.entries(methods)) {
      if (!symbol || !exchange.has[method]) {
        control.metrics[method] = { status: 'not-run', reason: symbol ? 'CCXT capability not advertised' : 'BTC symbol unavailable' };
        continue;
      }
      try {
        const response = await exchange[method](...args);
        const item = Array.isArray(response) ? response.at(-1) : response;
        const valid = method === 'fetchTrades' ? Number.isFinite(item?.price) && Number.isFinite(item?.amount)
          : method === 'fetchOHLCV' ? Number.isFinite(item?.[4])
          : method === 'fetchOpenInterest' ? [item?.openInterestAmount, item?.openInterestValue].some(Number.isFinite)
          : Number.isFinite(item?.fundingRate);
        control.metrics[method] = { status: valid ? 'observed' : 'no-usable-data',
          count: Array.isArray(response) ? response.length : undefined,
          timestamp: item?.timestamp ?? item?.[0] ?? null };
      } catch (error) {
        control.metrics[method] = { status: 'unavailable', error: error.message };
      }
    }
    return [type, { ...control, websocket: await websocket }];
  })));
  return { reference, probes };
}

async function directControls(name, direct, json) {
  const entries = [];
  if (name === 'hyperliquid') {
    const spot = direct.find(scope => scope.scope === 'spot')?.markets.find(market =>
      market.base === 'UBTC' && market.quote === 'USDC');
    const results = await Promise.all(['BTC', spot?.id].map(async coin => {
      if (!coin) return { status: 'not-run', reason: 'UBTC/USDC not resolved' };
      try {
        const result = await json('https://api.hyperliquid.xyz/info', { type: 'recentTrades', coin });
        const trade = result.find(item => item.coin === coin && Number.isFinite(item.time));
        return { coin, status: trade ? 'observed' : 'no-usable-data', timestamp: trade?.time ?? null };
      } catch (error) {
        return { coin, status: 'unavailable', error: error.message };
      }
    }));
    entries.push(['perpTrades', results[0]], ['spotTrades', results[1]]);
  }
  if (name === 'mexc') {
    try {
      const result = await json('https://contract.mexc.com/api/v1/contract/ticker?symbol=BTC_USDT');
      const data = result.data;
      const valid = result.success && data?.symbol === 'BTC_USDT' && Number.isFinite(data.holdVol);
      entries.push(['perpOpenInterest', { status: valid ? 'observed' : 'no-usable-data',
        contracts: valid ? data.holdVol : null, timestamp: valid ? data.timestamp : null }]);
    } catch (error) {
      entries.push(['perpOpenInterest', { status: 'unavailable', error: error.message }]);
    }
  }
  return Object.fromEntries(entries);
}

async function discover(name) {
  const http = [], ccxtHttp = [];
  const json = request(http);
  const [direct, result] = await Promise.all([
    venues[name](json),
    queryCcxt(name, ccxtHttp).catch(error => ({
      reference: ['spot', 'perp'].map(type => inventory(type, [], error.message)), probes: {},
    })),
  ]);
  const comparison = ['spot', 'perp'].map(type => compare(direct, result.reference, type));
  return { name, direct, ...result, comparison, directControls: await directControls(name, direct, json), http, ccxtHttp };
}

const selected = process.argv.slice(2);
if (selected.some(name => !Object.hasOwn(venues, name))) throw Error('Unknown venue');
const names = selected.length ? selected : Object.keys(venues);
const results = [];
for (let offset = 0; offset < names.length; offset += 2) {
  const batch = names.slice(offset, offset + 2);
  const settled = await Promise.allSettled(batch.map(discover));
  results.push(...settled.map((result, index) => result.status === 'fulfilled' ? result.value :
    { name: batch[index], error: result.reason.message }));
}
const report = { completedAt: new Date().toISOString(), node: process.version,
  ccxt: { packageVersion: packageInfo.version, runtimeVersion: ccxt.version, license: packageInfo.license }, results };
await writeFile('report.json', JSON.stringify(report, null, 2) + '\n');
for (const result of results) {
  if (result.error) console.log(result.name, 'unavailable:', result.error);
  else console.log(result.name, result.comparison.map(({ type, status, direct, ccxt, onlyDirect, onlyCcxt }) =>
    ({ type, status, direct, ccxt, onlyDirect: onlyDirect?.length ?? null, onlyCcxt: onlyCcxt?.length ?? null })));
}
