import { readFile, writeFile } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node export-browser-catalogue.mjs report.json output.json');
const report = JSON.parse(await readFile(input, 'utf8'));
const catalogue = Object.fromEntries(report.results.filter(result => result.direct).map(result => [
  result.name,
  result.direct.map(({ scope, status, count, markets, unknownMarkets, error }) => ({
    scope, status, count, error,
    retrievedAt: result.http?.filter(entry => entry.http === 200).map(entry => entry.retrievedAt).sort().at(-1)
      ?? report.completedAt,
    markets: markets.map(({ venue, type, id, base, quote, settle, active, precision, inverse, linear, contractSize, assetIds }) =>
      ({ venue, type, id, base, quote, settle, active, precision, inverse, linear, contractSize, assetIds })),
    unknownMarkets: unknownMarkets ?? [],
  })),
]));
await writeFile(output, JSON.stringify({ source: 'official public REST', completedAt: report.completedAt, catalogue }) + '\n');
