# CRYPTOSCOPE 3.0 — Roadmap and release gates

## Mission
Build a multilingual, source-transparent crypto market intelligence platform. Never equate a research candidate or algorithmic alert with a guaranteed trading outcome.

## Current architecture (audit required)
The project currently serves static HTML/CSS/JS on GitHub Pages. Market listings use CoinGecko REST; a Binance websocket supplies a subset of spot quotes; selected details use Binance spot/futures APIs and charts. A static frontend cannot safely store private API credentials, run reliable 24/7 alert jobs, or guarantee market-wide historical coverage.

## Phase 0: verified baseline
- [ ] Verify public GitHub Pages deployment and mobile Safari/Chrome rendering.
- [ ] Test all API endpoints from actual browsers, including CORS, CSP, quotas and failures.
- [ ] Verify stale quote fallback updates displayed values, not just the status label.
- [ ] Run syntax, smoke and security checks in CI; inspect actual job results.
- [ ] Document supported exchanges, data delays and API limitations.

## Phase 1: trustworthy market data
- [ ] Define a canonical asset identifier and explicit exchange-symbol mappings.
- [ ] Build a backend data adapter with cache, retries, timeouts, rate limits and source timestamps.
- [ ] Show freshness and provenance for every quote and metric.
- [ ] Add outage/degraded-mode indicators and monitoring.
- [ ] Validate candles, volume, CVD, OI and funding independently.

## Phase 2: research screener
- [ ] Large caps >= $200m and emerging assets $20m–$200m.
- [ ] Separate observed metrics from unverified claims.
- [ ] Add liquidity, volume changes, development activity, supply/unlocks and holder concentration only when licensed/verifiable sources are available.
- [ ] Explain scoring, missing data and last updated time; avoid a fabricated composite score.

## Phase 3: advanced intelligence
- [ ] Document and backtest anomaly detection and market-structure signals.
- [ ] Include counter-evidence, invalidation conditions and confidence limitations.
- [ ] Add watchlists, opt-in alerts, audit trails and user controls.
- [ ] Provide news with original links and timestamps.

## Phase 4: product and operations
- [ ] Accessibility, responsive design, internationalization and PWA.
- [ ] Backend authentication and secrets management if accounts are introduced.
- [ ] Dependency scans, CSP review, automated testing, monitoring and incident response.
- [ ] Capacity, reliability and release rollback tests.

## Release gate
Do not label the product production-ready until real-browser end-to-end checks pass, market data freshness and fallback are verified, critical security issues are resolved, monitoring is operational, and user-facing limitations are documented.

## External dependencies
Paid APIs, server hosting, app-store accounts and contractual data rights require owner approval. Never claim they are already provisioned.
