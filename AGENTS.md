# AGENTS.md

This repository publishes the `sustainable-engineering` Agent Skill. The skill's own rules apply here: read [SKILL.md](skills/sustainable-engineering/SKILL.md) before changing anything under `skills/`.

## Layout

```
skills/sustainable-engineering/
  SKILL.md       entry point; always loaded when the skill triggers
  references/    one topic per file, loaded on demand
  templates/     copy-paste starters for target repositories
  scripts/       zero-dependency Node.js checks
tests/           script tests: passing cases and negative controls
.agents/notes/   decision records for this repository
.github/         CI and this repository's word-budget manifest
.claude-plugin/  Claude Code marketplace entry
```

## Commands

```sh
node --test tests/
node skills/sustainable-engineering/scripts/verify-doc-budgets.mjs --manifest .github/doc-budgets.manifest.json
node skills/sustainable-engineering/scripts/verify-md-links.mjs --exclude 'skills/*/templates/**'
node skills/sustainable-engineering/scripts/verify-agent-notes.mjs
```

## Conventions

- **`SKILL.md` stays between 900 and 1,500 words** and holds rules, workflows, and pointers; depth goes to one `references/` file. The budget manifest enforces the ceiling.
- **One home per fact across references.** Before adding content, search the other references; link instead of restating.
- **Stack-agnostic.** Examples use more than one language; cite [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as provenance, never as a requirement.
- **Scripts are standalone** `.mjs` files using only `node:` built-ins, Node.js 18+, with `--help` and exit codes 0 ok, 1 violation, 2 usage ([rationale](.agents/notes/implemented/architecture/2026-11-23-standalone-zero-dependency-scripts.md)).
- **Every script change adds a passing test and a negative-control test** in `tests/scripts.test.mjs`, run in a temporary directory that the test removes.
- **Templates must pass the scripts.** Tests load the note templates, budget manifest, and ratchet config; keep them valid.
- **`README.md` is Chinese first with an English summary.** Install paths in it are user-facing contracts; verify them against each agent's documentation when changing them.
- **Prose rules** from [information-architecture.md](skills/sustainable-engineering/references/information-architecture.md) apply: current state, exact names, no reasoning transcripts.

## Editing these instructions

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md`.
