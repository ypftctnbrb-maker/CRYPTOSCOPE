import { bybit, collect, instrument, inventory } from './discovery.mjs';

const okxHost = 'https://www.okx.com';
const bitfinexHost = 'https://api-pub.bitfinex.com';
const hyperliquidUrl = 'https://api.hyperliquid.xyz/info';
const mexcSpot = 'https://api.mexc.com';
const mexcPerp = 'https://contract.mexc.com';

async function hyperliquid(json) {
  let tokens = new Map();
  const spot = await collect('spot', async () => {
    const body = { type: 'spotMeta' };
    const data = await json(hyperliquidUrl, body);
    tokens = new Map(data.tokens.map(token => [token.index, token]));
    return { rows: data.universe.map(row => {
      const [base, quote] = row.tokens.map(index => tokens.get(index));
      return instrument('hyperliquid', 'spot', row.index === 0 ? row.name : '@' + row.index, {
        base: base?.name ?? null, quote: quote?.name ?? null,
        assetIds: [base?.tokenId ?? null, quote?.tokenId ?? null],
        active: row.isDelisted === true ? false : true,
        precision: { price: null, amount: base?.szDecimals ?? null, mode: 'decimal-places' },
        provenance: { url: hyperliquidUrl, body },
      });
    }) };
  });
  const scopes = [spot];
  let dexes = [];
  try {
    const listed = await json(hyperliquidUrl, { type: 'perpDexs' });
    if (!Array.isArray(listed)) throw Error('Expected perp dex list');
    dexes = [...new Set(listed.filter(Boolean).map(dex => dex.name))];
  } catch (error) {
    scopes.push(inventory('perp-dex-list', [], error.message));
  }
  for (const dex of ['', ...dexes]) {
    scopes.push(await collect(dex ? 'perp:' + dex : 'perp', async () => {
      const body = { type: 'meta', ...(dex && { dex }) };
      const data = await json(hyperliquidUrl, body);
      const settle = tokens.get(data.collateralToken)?.name ?? (dex ? null : 'USDC');
      return { rows: data.universe.map(row => instrument('hyperliquid', 'perp', row.name, {
        base: row.name, settle, active: row.isDelisted !== true,
        precision: { price: null, amount: row.szDecimals ?? null, mode: 'decimal-places' },
        linear: true, inverse: false, provenance: { url: hyperliquidUrl, body },
      })) };
    }));
  }
  return scopes;
}

function okx(json) {
  return Promise.all(['SPOT', 'SWAP'].map(kind => collect(kind.toLowerCase(), async () => {
    const url = okxHost + '/api/v5/public/instruments?instType=' + kind;
    const result = await json(url);
    if (result.code !== '0') throw Error('OKX ' + result.code + ': ' + result.msg);
    return { rows: result.data.map(row => {
      const [base, quote] = row.instId.split('-');
      return instrument('okx', kind === 'SPOT' ? 'spot' : 'perp', row.instId, {
        base: row.baseCcy || base, quote: row.quoteCcy || quote, settle: row.settleCcy || null,
        active: row.state ? row.state === 'live' : null,
        precision: { price: row.tickSz || null, amount: row.lotSz || null, mode: 'tick-size' },
        contractSize: row.ctVal || null, contractSizeUnit: row.ctValCcy || null,
        linear: row.ctType ? row.ctType === 'linear' : null,
        inverse: row.ctType ? row.ctType === 'inverse' : null, provenance: url,
      });
    }) };
  })));
}

function bitfinex(json) {
  return Promise.all(['spot', 'perp'].map(type => collect(type, async () => {
    const url = bitfinexHost + '/v2/conf/pub:list:pair:' + (type === 'spot' ? 'exchange' : 'futures');
    const [pairs] = await json(url);
    return { rows: pairs.map(id => {
      const [rawBase, rawQuote] = id.includes(':') ? id.split(':') : id.match(/^(.{3})(.{3})$/)?.slice(1) ?? [];
      return instrument('bitfinex', type, id, {
        base: rawBase?.replace(/F0$/, '') ?? null, quote: rawQuote?.replace(/F0$/, '') ?? null,
        active: true, provenance: url,
      });
    }) };
  })));
}

function mexc(json) {
  return Promise.all([
    collect('spot', async () => {
      const url = mexcSpot + '/api/v3/exchangeInfo';
      const { symbols } = await json(url);
      return { rows: symbols.map(row => instrument('mexc', 'spot', row.symbol, {
        base: row.baseAsset, quote: row.quoteAsset,
        active: row.status == null || row.isSpotTradingAllowed == null ? null :
          String(row.status) === '1' && row.isSpotTradingAllowed === true,
        precision: { price: row.quoteAssetPrecision ?? null, amount: row.baseAssetPrecision ?? null, mode: 'decimal-places' },
        provenance: url,
      })) };
    }),
    collect('perp', async () => {
      const url = mexcPerp + '/api/v1/contract/detail';
      const result = await json(url);
      if (!result.success) throw Error('MEXC ' + result.code + ': ' + result.message);
      return { rows: result.data.filter(row => Number(row.futureType) === 1).map(row => {
        const linear = row.settleCoin && row.quoteCoin ? row.settleCoin === row.quoteCoin : null;
        return instrument('mexc', 'perp', row.symbol, {
          base: row.baseCoin, quote: row.quoteCoin, settle: row.settleCoin || null,
          active: row.state == null ? null : Number(row.state) === 0,
          precision: { price: row.priceUnit ?? null, amount: row.volUnit ?? null, mode: 'tick-size' },
          contractSize: row.contractSize ?? null, linear,
          inverse: row.settleCoin && row.baseCoin ? row.settleCoin === row.baseCoin : null, provenance: url,
        });
      }) };
    }),
  ]);
}

export const venues = { bybit, hyperliquid, okx, bitfinex, mexc };
