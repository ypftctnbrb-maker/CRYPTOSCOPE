# CRYPTOSCOPE — Technical audit and refactoring plan

Status: baseline audit, not production acceptance. Date: 2026-11-06.

## Evidence from repository
- `index.html` is a single-page static document (~9.9 KB), containing hard-coded Russian user-facing strings.
- `assets/app.js` (~28 KB) combines market retrieval, Binance WebSocket integration, calculations, DOM rendering and translation triggers.
- `assets/localization.js` (~29 KB on main) uses post-render DOM text matching and MutationObserver. This is brittle when async market updates replace nodes.
- `assets/styles.css` (~12 KB) contains styling. No `README.md` exists on main at audit time.
- A refactor is in draft PR #4. Its JavaScript syntax was checked, but its browser behavior and complete translation coverage have NOT been verified.

## Architecture target
1. `src/data/`: CoinGecko and Binance adapters; explicit response schemas, timeouts, retries and rate-limit handling.
2. `src/domain/`: pure functions for price changes, CVD, filtering, liquidity and indicators. Never mix translations into calculations.
3. `src/i18n/`: one translation catalog per locale; semantic keys, pluralization, interpolation, fallback and locale-aware formatting.
4. `src/ui/`: rendering components consume domain data and `t(key,params)`; no hard-coded user-facing text.
5. `tests/`: unit tests for domain logic, localization completeness, and browser smoke tests.
6. CI: run checks on PRs; publish only after tests pass.

## Delivery sequence
**P0 — stability and test harness**
- Introduce npm scripts and repeatable CI checks without rewriting the deployed app.
- Test initial render, missing API responses, language persistence, market refresh and RTL.
- Establish a baseline for browser console errors and external API failures.

**P1 — localization**
- Inventory every user-facing literal in HTML and JavaScript.
- Replace post-render string substitution with explicit i18n calls at render sites.
- Provide complete `ru,en,es,zh,de,fr,pt,ar,hi,ja` dictionaries.
- Test static and dynamic states and each locale. Do not merge draft PR #4 until these pass.

**P2 — separation of concerns**
- Extract data adapters and pure calculations with fixture tests.
- Isolate chart lifecycle and WebSocket lifecycle from language switching.
- Use safe DOM APIs for external data and text.

**P3 — analytics and reliability**
- Add observable source timestamps and error states for each provider.
- Define explicit methodology and availability for CVD, OI, funding and liquidity.
- Validate mobile layout and accessibility.

## Merge policy
- Branch -> PR -> automated checks -> manual review -> merge -> deployed smoke test.
- A syntax check is not a functional test.
- No feature is marked complete without evidence of actual runtime verification.
- Keep a rollback path and avoid simultaneous direct writes to main.

## Known risks and open questions
- Main and draft PR can diverge because scheduled development tasks also modify the repository.
- Real-time feeds require rate-limit, disconnect and stale-data handling.
- Current deployment URL and browser functionality have not been independently verified in this audit.
- Existing localization is incomplete; PR #4 is an architectural first step, not a completed fix.
