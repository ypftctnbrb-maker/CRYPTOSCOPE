# CRYPTOSCOPE — handoff for Codex
Updated: 2026-11-20. Status: working brief; verify every assertion against current GitHub HEAD.

## Goal
Build and stabilize CRYPTOSCOPE, a free, public, Russian-language crypto-market analytics website. Deliver reliable live market data and usable mobile charts before expanding scope. A later NEWS module and a future 4.0 visualization are not release blockers for 3.0.

## Product requirements
- Live BTC price; searchable coin list and coin detail with candles, volume, CVD, open interest and funding where valid.
- "Все монеты": market cap >= USD 200m; "Монеты с потенциалом": USD 20m–200m, with evidence-based liquidity/volume/OI and other screening signals. Never manufacture missing indicators.
- Favorites and gainers/losers; responsive mobile interface; Russian UI.
- Missing data must be shown as missing ("—"), not misleading zeroes. Clearly label freshness and provenance.
- Planned after live-data stability: synchronized price and aggregate CVD, exchange-level CVD traces, Delta 1h/4h, CVD 24h, Buy/Sell 24h, Taker Buy %; do not copy Coinfuty's design.
- 4.0 (dark professional UI, 3D market map, capital flows) begins only after stable 3.0.

## Current handoff snapshot (verify, do not assume merged)
- Repository: https://github.com/ypftctnbrb-maker/CRYPTOSCOPE
- PR #52 (draft): fix missing OI/funding displayed as zero; HEAD 1584470379be683d487afa08fa276ace286d661c, based on a non-main integration branch. Independent live API and Safari evidence is still missing.
- PR #53 (draft): sandbox TradingView fallback iframe; compatibility needs testing.
- PR #54 (draft): strengthen smoke assertions against sandbox attribute decoys; full smoke/browser evidence not established here.
- Existing workflow .github/workflows/checks.yml runs Node 22 smoke, chart-symbol, live, and market-retry tests on push/PR. This is a configuration observation, NOT proof that checks passed.
- Previous audit verdict for 3.0: INSUFFICIENT EVIDENCE / NOT READY, especially live Binance and Safari/iPhone. Re-evaluate against latest commits and CI.

## Priority order
P0: Determine actual current main SHA, open PRs, base/head SHA, CI and deployed Pages SHA; distinguish what is running from what is only proposed. Do not treat draft PR code as deployed.
P1: On an isolated branch, fix the smallest reproducible blocker supported by a failing regression test. Prefer data correctness, websocket liveness/reconnect, partial CoinGecko data, or deployment/browser test gates, as evidence dictates.
P2: Independently verify live Binance/CoinGecko responses, error and stale-data behavior, mobile browser and Safari/WebKit. If the environment cannot perform these, report UNVERIFIED instead of claiming PASS.
P3: Improve accessibility, CSP/SRI, sandbox fallback, localized strings and UI consistency without widening an unrelated PR.
P4: Only after stable release, expand CVD analytics, NEWS, and future 4.0 planning.

## Mandatory engineering and reporting rules
1. Read repository instructions, workflow files and tests before edits; inspect exact current SHA and PR overlap.
2. One PR = one concern. Branch from the correct verified base. Never overwrite another PR's work.
3. First add/reproduce a failing test, then implement the fix, rerun. Include exact commands, exit codes, test counts, SHA, and `git diff --stat`.
4. Clearly separate ЗАПУЩЕНО (personally executed), ПРОЧИТАНО (inspected only), and ГИПОТЕЗА (unverified).
5. Avoid misleading green statuses before fresh data. Use safe DOM rendering (escape untrusted HTML); preserve CSP/SRI and secure third-party iframe sandboxing.
6. Do not merge PRs, deploy, modify branch protections, or publish without explicit release authorization. Stop on conflicts and report exact files/hunks.
7. Keep code maintainable, prefer <=200 lines per source file where practical; preserve keyboard access and >=44px touch targets.
8. Do not claim Safari, live APIs, GitHub Actions, or public Pages were tested unless independently executed and recorded.

## First Codex assignment
Read this HANDOFF.md and all repository instructions. Inspect main and open PRs (#52–#54 at minimum), then choose one narrow, confirmed outstanding defect not already fixed in an open PR. Create a regression test demonstrating failure, fix it in a separate branch, run applicable tests, and open a DRAFT pull request. If no reproducible defect is found, open a documentation-only issue with evidence rather than speculative changes. Report exact SHA, diff stat, commands, exit codes, and remaining verification gaps. Do not merge or deploy.

## Collaboration protocol
GitHub Issues = scoped assignments and acceptance criteria. PRs = proposed implementation and test evidence. ChatGPT reviews repository state and CI; Codex must explicitly pick up an assigned issue/task in its own environment. Merely writing an issue or this file does NOT automatically launch Codex. An actual task trigger (supported integration or automation) must be configured and tested separately.
