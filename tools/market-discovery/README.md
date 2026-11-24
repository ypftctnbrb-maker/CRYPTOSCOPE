# Market discovery

Isolated probe for Bybit, Hyperliquid, OKX, Bitfinex and MEXC. It does not require API keys and is outside the Pages allowlist.

```sh
cd tools/market-discovery
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run discover
# Run only the first two venues
npm run discover -- bybit hyperliquid
```

Use Node 24. A run writes `report.json` with normalized active instruments, per-scope completeness, comparison IDs, request timestamps, HTTP statuses and BTC probes. A separate observation file preserves the measured run without its full catalogue arrays. The CLI exit code reports whether the probe wrote its report. Check the report for per-scope errors and probe failures.

The lockfile pins MIT-licensed CCXT npm package 4.5.94. Its exported runtime version is 4.5.93. The comparison uses `loadMarkets()`, scoped to spot and perpetual markets, and adds no CCXT retry. Direct calls use a 12-second deadline and one retry on a 429 whose Retry-After fits a five-second budget. Longer cooldowns and exhausted retries are reported. Bybit derivative cursors stop at exhaustion, a repeated cursor or 25 pages. Spot is unpaginated. Hyperliquid enumerates each builder DEX returned by `perpDexs`. The CCXT reference kept its default limit of ten builder DEXes, which covered the ten observed. CCXT throttling is enabled. No vendor rate-limit stress test was performed.

The comparison uses venue, market type and native instrument ID. Hyperliquid perpetual names are reconciled using CCXT raw metadata, with its numeric ID retained separately. Spot uses the venue's wire identifier and token IDs, preserving same-name assets. Bitfinex's wire prefix is removed for set comparison. A null value denotes unavailable metadata. Bitfinex's official configuration exposes pair membership, without per-pair status and tick sizes in these responses. Hyperliquid spot membership is interpreted as listed unless explicitly delisted. Hyperliquid perpetual price precision depends on venue rules and mark price, and is left null in the direct catalogue. No ticker-only join across venues is attempted.

## Observed on November 24, 2026 UTC

| Venue | Spot direct / CCXT | Perp direct / CCXT | BTC REST trades / candles | BTC perp OI / funding | BTC trade WS spot / perp |
|---|---:|---:|---|---|---|
| Bybit | 499 / 499 | 924 / 924 | Both via CCXT | Both via CCXT | Frame / frame |
| Hyperliquid | 356 / 352 | 357 / 357 | Trades direct, candles via CCXT | Both via CCXT | Frame / frame |
| OKX | 1250 / 1250 | 550 / 550 | Both via CCXT | Both via CCXT | Frame / frame |
| Bitfinex | 196 / 196 | 94 / 94 | Both via CCXT | Both via CCXT | Frame / frame |
| MEXC | 1634 / 1634 | 1175 / 1175 | Both via CCXT | OI direct, funding via CCXT | Binary envelope / frame |

Hyperliquid spot IDs present only in official REST are `@129`, `@18`, `@189` and `@43`. All other compared ID sets matched in this run. Bybit perp comprised 902 linear and 22 inverse contracts. MEXC spot excluded 63 inactive or disallowed entries. All recorded REST requests returned HTTP 200. Hyperliquid's CCXT trade method requested a user address, so the control used the public `recentTrades` route for BTC and UBTC/USDC (`@142`). MEXC CCXT did not advertise OI. The public contract ticker returned `holdVol` in contracts.

Direct WS probes require a matching trade frame. MEXC spot evidence only identifies the protobuf channel envelope. Decoding and checking prices, quantities and timestamps remains open. One frame confirms reachability from this environment. It leaves long-running stability, gaps, delivery latency, reconnect behaviour, physical Safari and CORS unverified. CCXT Pro was not used.

For the next adapter stage, use CCXT for the observed normalized REST routes. Keep venue REST discovery as the coverage reference and use public direct routes for Hyperliquid trades and MEXC OI. Normalize and validate MEXC spot protobuf before evaluating that feed for CVD.

Official API references [Bybit](https://bybit-exchange.github.io/docs/v5/market/instrument), [Hyperliquid](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [OKX](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments), [Bitfinex](https://docs.bitfinex.com/reference/rest-public-conf), [MEXC](https://mexcdevelop.github.io/apidocs/spot_v3_en/).

## Browser integration

The homepage links to `instruments.html`. It searches all known instrument IDs in the packaged official REST snapshot, with separate venue and market filters and paginated results. Refresh keeps previous records for failed scopes and replaces the entire scope after a complete response. Unknown activity and stale records remain distinguishable. The snapshot is served from Pages and the last browser refresh is stored locally when storage is available. Regenerate the snapshot from an actual discovery run:

```sh
node export-browser-catalogue.mjs report.json ../../assets/venue-catalogue.json
```

The Bybit detail view requests 5m candles, recent trades, OI and funding by native market ID. Candle WS updates replace the live bar and reconnect through a REST snapshot. The CVD value is a signed sum of deduplicated REST trades in the returned snapshot. Spot and linear trade size use base units. Inverse sizes use quote units. A continuous trade CVD requires a separate validation of replay and gap detection. The existing Binance page remains available independently. Other venues have catalogue coverage only. MEXC spot protobuf has yet to be decoded.

If a deployed Pages origin cannot read a venue's REST due to CORS, the shipped snapshot remains available. A possible free transport is a Cloudflare Worker on `workers.dev` with a fixed route allowlist per exchange, public reads only, bounded timeouts and short response caching, and CORS limited to the Pages origin. It needs an independent quota, accessibility and deployment decision.
