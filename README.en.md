<div align="center">

# Sustainable Engineering

**Keep AI-assisted repositories maintainable for years without collapsing into slop.**

A stack-agnostic engineering governance Agent Skill for **Claude Code · Codex · Antigravity** and human teams<br/>
Distilled from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · Zero-dependency scripts · Battle-tested across 3 agents

[![Verify](https://github.com/hewenyu/dsh-osc/actions/workflows/verify.yml/badge.svg)](https://github.com/hewenyu/dsh-osc/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933)](skills/sustainable-engineering/scripts/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-2ea44f)](skills/sustainable-engineering/scripts/)
[![Skill](https://img.shields.io/badge/Skill-sustainable--engineering-8A2BE2)](skills/sustainable-engineering/SKILL.md)

[简体中文](README.md) · **English**

[Quick Start](#-30-second-quick-start) · [Why Repos Collapse](#-why-vibe-coded-repos-collapse) · [Mechanical Checks](#-not-just-prompts-zero-dependency-checks) · [The Model](#-the-four-home-model) · [Adoption Ladder](#-progressive-adoption) · [Contributing](#-contributing)

</div>

---

## ⚡ 30-Second Quick Start

### 1. Install in one command

```sh
npx skills add hewenyu/dsh-osc          # Install into current project (recommended)
npx skills add hewenyu/dsh-osc -g       # Install globally
```

<details>
<summary>Other install methods: Claude Code Marketplace / Codex / Antigravity / Manual</summary>

**Claude Code Plugin Marketplace**

```text
/plugin marketplace add hewenyu/dsh-osc
/plugin install sustainable-engineering@dsh-osc
```

**Codex & Antigravity (direct clone)**

```sh
DEST=~/.agents/skills             # Codex user global; use ~/.gemini/config/skills for Antigravity
( set -e; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  git clone --depth 1 https://github.com/hewenyu/dsh-osc.git "$TMP"
  mkdir -p "$DEST"; cp -R "$TMP/skills/sustainable-engineering" "$DEST/" )
```

- **Codex**: `~/.agents/skills/` (user global) or `.agents/skills/` (project); `~/.codex/skills/` is compatibility-only.
- **Antigravity**: `~/.gemini/config/skills/` (unified across App, CLI `agy`, and IDE) or `.agents/skills/` (project).
- **Manual**: Copy [skills/sustainable-engineering/](skills/sustainable-engineering/) into your agent's skills directory.

</details>

### 2. Ask your agent

- **Audit first**: *"Audit this repo's health using `sustainable-engineering` and tell me which adoption rung to start at."*
- **15-minute Day 1**: *"Bootstrap Day 1 `AGENTS.md` and `.agents/notes/` using `sustainable-engineering`."*
- **Ship safely**: *"Implement this feature following `sustainable-engineering` Workflow B: ..."*
- **Bug to guardrail**: *"This production bug is fixed — run Workflow D to write a postmortem and add a permanent guardrail."*

---

## 🔥 Why Vibe-Coded Repos Collapse

AI makes writing code fast, but without persistent decision memory and mechanical checks, repositories decay into unmaintainable one-off codebases:

| Collapse symptom | Why manual discipline fails | With Sustainable Engineering |
|---|---|---|
| `AGENTS.md` bloats to 5,000 words and gets ignored | More rules make every rule weaker | Hard **word budgets** keep standing orders dense (1–3 lines + link) |
| New sessions keep re-proposing already-rejected designs | Context resets every session | `.agents/notes/` mandates **`## Alternatives considered`**, searched before designing |
| 70 legacy `as any` or empty `catch` blocks stall new rules | Fixing all debt stops feature delivery | **Ratchet baseline** freezes legacy debt and fails only new violations |
| `docs/` fills with "previously", "(planned v2)", and stale tables | Readers stop trusting docs | **Facts vs. rationale split** + generated catalogs with freshness gates |
| Unit tests stay green while prod leaks orphaned processes | Mocks hide real boundaries | **Verify the world** through real entry paths + postmortem-to-guardrail loop |

> Scope honesty: automated scripts enforce what can be checked mechanically (budgets, note structure, links, ratchet monotonicity). Architecture boundaries and test assertion strength still depend on human review and project-specific gates.

---

## 🛠 Not Just Prompts: Zero-Dependency Checks

Ships with **4 standalone Node.js 18+ scripts** (zero external dependencies) you can run directly or copy into `scripts/governance/`:

```text
$ node scripts/governance/verify-doc-budgets.mjs --list
ok       277 / 600      46% AGENTS.md
ok      1406 / 1500     94% skills/sustainable-engineering/SKILL.md
OVER    2410 / 2000    121% docs/AGENTS.md   ← fails CI until relocated or condensed

$ node scripts/governance/ratchet-baseline.mjs --base origin/main
ratchet-baseline failed: 1 new finding(s)
  [no-ts-any-cast] src/worker/shutdown.ts:42  const p = proc as any

$ node scripts/governance/verify-agent-notes.mjs --base origin/main
verify-agent-notes failed:
  .agents/notes/implemented/architecture/2026-11-23-job-queue.md: missing non-empty "## Alternatives considered"
```

| Script | Enforces | Anti-bypass design |
|---|---|---|
| [`verify-doc-budgets.mjs`](skills/sustainable-engineering/scripts/verify-doc-budgets.mjs) | Word ceilings on standing docs (CJK-aware) | `--base` blocks silent ceiling increases or removed entries |
| [`verify-agent-notes.mjs`](skills/sustainable-engineering/scripts/verify-agent-notes.mjs) | Path layout, status, non-empty sections, no `INDEX.md` | `--base` uses `merge-base` to freeze `archived/` and `rejected/` |
| [`ratchet-baseline.mjs`](skills/sustainable-engineering/scripts/ratchet-baseline.mjs) | Freezes legacy debt; new findings fail; only shrinks | Multiline regex, external linter `--findings`, `git mv` move transfer, empty-scan guard, `--base` anti-loosening |
| [`verify-md-links.mjs`](skills/sustainable-engineering/scripts/verify-md-links.mjs) | Relative Markdown links & GitHub/CJK anchors | Multiline links, balanced parens, Setext/inline-code headings, empty-scan guard |

All scripts support `--help` and `--version`, with uniform exit codes: `0` pass, `1` violation, `2` usage/config error.

---

## 🧭 The Four-Home Model

> **Tests guard the present. Notes guard the future. Postmortems turn every escape into both.**

| Home | Holds | Never holds | Deep dive |
|---|---|---|---|
| `AGENTS.md` (root & subtrees; `CLAUDE.md` symlinks to it) | Standing orders, 1–3 lines each + links | Stories, tutorials, restated details | [information-architecture.md](skills/sustainable-engineering/references/information-architecture.md) |
| `docs/` | Current facts: architecture, defensive habits, cookbooks, postmortems | Rationale, plans, "previously" | [defensive-habits.md](skills/sustainable-engineering/references/defensive-habits.md) · [evolution-and-incidents.md](skills/sustainable-engineering/references/evolution-and-incidents.md) |
| `.agents/notes/{lifecycle}/{class}/` | Why non-trivial decisions were made & what was rejected | Current-state reference, global `INDEX.md` | [agent-notes.md](skills/sustainable-engineering/references/agent-notes.md) |
| Automated checks (Hooks / Scripts / CI) | Every recurring review lesson checkable by machine | Checks nobody runs | [mechanical-enforcement.md](skills/sustainable-engineering/references/mechanical-enforcement.md) · [review-and-audit.md](skills/sustainable-engineering/references/review-and-audit.md) |

---

## 🪜 Progressive Adoption

Every rung delivers standalone value. Stop at the rung matching your repository size (**risk overrides rung**: an active incident or bleeding defect class can pull forward Workflow D or a targeted ratchet on Day 1):

| Rung | Effort | What you adopt |
|---|---|---|
| **Day 1** | 15 min | Root `AGENTS.md` + `CLAUDE.md` symlink; `.agents/notes/`; first note for the decision most likely to be undone |
| **Week 1** | 1–2 hrs | Wire budgets, notes, and link checks into CI; prove each fails once; one-page `docs/architecture.md` |
| **Growing team** | Ongoing | Promote repeated review comments to checks; ratchet legacy debt; `CODEOWNERS`, local hooks, defensive patterns, postmortems |
| **Scale** | Ongoing | Numbered core guidelines, generated catalogs + freshness checks, append-only formats & archived notes, AST/linter ratchets |

See [adoption-ladder.md](skills/sustainable-engineering/references/adoption-ladder.md) and the [13 copy-paste templates](skills/sustainable-engineering/templates/).

---

## 🧪 Dogfooded & Tri-Agent Verified

This repository maintains itself with its own rules ([AGENTS.md](AGENTS.md), [.agents/notes/](.agents/notes/README.md)), ships **128 automated positive and negative-control tests** verified on Node 18 and 22+, and was stress-tested independently by **Claude Code**, **Codex**, and **Antigravity**.

## 🤝 Contributing

Read [AGENTS.md](AGENTS.md) before making changes, and run the full local checks before opening a PR:

```sh
node --test tests/*.test.mjs
node skills/sustainable-engineering/scripts/verify-doc-budgets.mjs --manifest .github/doc-budgets.manifest.json
node skills/sustainable-engineering/scripts/verify-md-links.mjs --exclude 'skills/*/templates/**'
node skills/sustainable-engineering/scripts/verify-agent-notes.mjs
```

## 🙏 Acknowledgements

- [**DeepSeek Harness**](https://github.com/deepseek-ai/deepseek-harness) — provenance of the `AGENTS.md` hierarchy, One Home Per Fact, Agent Notes lifecycle, word budgets, ratchet baselines, defensive habits, and testing principles, generalized here without stack lock-in.
- Linux.do community article [From the DSH source: how the DeepSeek Harness team maintains its project](https://linux.do/t/topic/2904342) — framing of facts-vs-causality separation and "tests guard the present, notes guard the future".

## 📄 License

[MIT](LICENSE)
