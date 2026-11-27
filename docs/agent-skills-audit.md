# Repository agent skills audit

Issue #96 authorizes an audit and repository-local installation. The four entries under `.agents/skills/` are original CRYPTOSCOPE instructions informed by the pinned sources below. Each entry is Markdown with a name and description. None requires a new dependency, invokes another skill by name, or installs a tool. The website and its dependency manifests are outside the change.

| Candidate | What was reviewed | Decision |
| --- | --- | --- |
| [obra/superpowers systematic-debugging](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills/systematic-debugging) | MIT. Root-cause, defense-in-depth, and condition-based waiting references. The entry refers to two other Superpowers skills. The directory also includes shell and TypeScript examples. | Adapt the root-cause and one-hypothesis workflow with focused local RED/GREEN and exact-SHA evidence. Leave the upstream scripts and companion skills outside this installation. |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser/tree/3f43a2affd9944298104b7bb39d5f241aef85e91) | Apache-2.0. The skill directs users to a CLI plus Chromium install. The npm postinstall resolves a native package or downloads a release binary. The Rust CLI has its own locked dependency tree. | Use the existing Playwright/Chromium fixture workflow. A CLI adoption would require separate review of binary provenance, dependencies, and installation behavior. |
| [mattpocock/skills handoff, grill-me, research](https://github.com/mattpocock/skills/tree/6f7f7831a625f040a8e06a0e7954826b87ce775a/skills) | MIT. Handoff is text-only and covers temporary notes and redaction. Grill-me refers to the grilling skill. Research calls for a background research agent. | Adapt handoff for GitHub evidence and queue markers. Leave the questioning and delegation workflows out. |
| [anthropics/skills frontend-design and skill-creator](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills) | Both directories carry Apache-2.0 licenses. Frontend-design is a text guide. Skill-creator includes Python scripts, subprocess calls to `claude -p`, and a browser viewer with external resources. | Adapt the design guide to the approved CRYPTOSCOPE specification. Leave the skill-creator harness outside this installation. |
| [vercel-labs/skills find-skills](https://github.com/vercel-labs/skills/tree/e7fd0e9e52f029fe87729d8185cb8caf7049f678/skills/find-skills) | MIT. The text directs users to unpinned `npx skills` discovery and install commands, including a global noninteractive example. | Keep candidate selection and review explicit. Exclude automatic discovery and installation. |

The review covered the candidate instructions and the runtime surfaces used to make the adoption decisions. No upstream scripts, packages or native binaries were executed. Excluded runtime dependency trees were outside the audit.

## Verification

The base was `638f725c9856c6e73dd149f856339f0fdf8150bb`. Before adding the entries, `test "$(find .agents/skills -name SKILL.md 2>/dev/null | wc -l)" -eq 4` exited 1. With the entries installed it exited 0. A Python structural check exited 0 and found exactly four skill directories, each with a single regular, non-executable `SKILL.md`, matching frontmatter names, and descriptions. Native Codex discovery remains unverified. The CLI failed during initialization with a read-only state filesystem, before reporting any skills.

The main-based task branch passed `node tests/smoke.cjs`, `node tests/behavior-chart-symbol.cjs`, `node tests/behavior-live.cjs`, and `node tests/behavior-market-retry.cjs` (each exit 0).

To exercise the mobile browser workflow on a candidate containing the venue catalogue, the following command exited 0 at `f5f6dba4130c87c1c30bab72719cc2fbb222e6f0` using Chromium 156.0.8078.79. The run used fixtures and checked all venue scopes, native Hyperliquid IDs, spot/perpetual price and CVD candles, partial REST history, instrument switching, and socket cleanup.

```sh
CATALOGUE_WIDTH=390 CHROME_BIN=/usr/bin/chromium NODE_PATH=/workspace/i66-probe/tools/browser-api-probe/node_modules node tests/browser-venue-catalogue.cjs
```
