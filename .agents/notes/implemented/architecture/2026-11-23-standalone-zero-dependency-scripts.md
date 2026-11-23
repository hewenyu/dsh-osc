# Agent Note: Ship governance tools as standalone zero-dependency Node scripts

Status: implemented

## Problem

The skill must give TypeScript, Python, Go, Rust, and Java repositories the same mechanical checks (word budgets, note format, ratchet baseline, link checking). A tool that requires a package install, a build step, or a specific language toolchain will not be adopted in a 15-minute first session, and an agent cannot reliably run it from an installed skill directory.

## Decision

Each tool in `skills/sustainable-engineering/scripts/` is one `.mjs` file that imports only `node:` built-ins and runs on Node.js 18 or later. Each file is self-contained: a user can copy one script into `scripts/governance/` without the others. Line 2 of every script is `// sustainable-engineering v1.0.0`, and `--version` prints it, so a vendored copy can be compared with the skill. Every script accepts `--help`, resolves paths against `--root` (default: the current directory), and exits 0 on success, 1 on violations, and 2 on usage, configuration, or environment errors (including a scan that finds no files, and a failing `git` as opposed to a directory that is not a repository), so CI can tell a broken rule from a broken setup.

`ratchet-baseline.mjs` scans with regular expressions, per line by default or across the whole file with `"multiline": true`, and accepts findings from any external linter through `--findings <json>` for rules declared `"external": true`. Every scanner feeds one contract: findings recorded per rule, file, and fingerprint of the whitespace-collapsed matched text, with exact counts. `mustMatch` and `mustNotMatch` samples self-test each regex rule on every run. `--init` refuses an existing baseline, `--init-rule` refuses a recorded rule, and no command adds allowances; `--prune --base <ref>` carries allowances only into files the change adds or renames. The cross-commit guard behind `--base` is recorded in [its own note](../process/2026-11-23-base-ref-monotonicity-guards.md).

`verify-md-links.mjs` parses a bounded Markdown subset (inline links with balanced parentheses and line breaks, reference definitions, ATX and Setext headings, github-slugger duplicate ids; front matter, fenced and indented code, and HTML comments ignored) rather than depending on a Markdown library.

`tests/scripts.test.mjs` runs every script as a subprocess in a temporary directory with a passing case and a deliberately invalid case, and checks that the shipped templates pass the scripts.

## Alternatives considered

- **Publish an npm package with a CLI.** Rejected: adds an install step and a supply-chain dependency for four small checks, and non-JavaScript repositories would need Node packaging they do not otherwise have.
- **One script per language ecosystem (Python, Go, Rust ports).** Rejected: four implementations of the same contract drift; Node is already present on most developer machines and CI images because agent CLIs require it.
- **Share a helper module between scripts.** Rejected: copying one script would then require copying the helper too. The glob and file-listing helpers are duplicated in `ratchet-baseline.mjs` and `verify-md-links.mjs` instead.
- **Parser-based ratchet fingerprints, as in DeepSeek Harness `baseline-inventory.ts`.** Rejected for the starter: a parser per language contradicts the stack-agnostic goal. `--findings` lets any parser-based linter feed the same baseline instead.
- **A Markdown parsing library for the link checker.** Rejected: it would be the only dependency in the toolset; the bounded subset is covered case by case in the tests.

## Consequences

- Any repository with Node.js 18+ can adopt the checks by copying files; nothing is installed.
- Regex rules match inside strings and comments; rule authors write patterns narrow enough for their codebase, prove them with `mustMatch`/`mustNotMatch`, or ratchet a parser-based linter's output through `--findings`.
- Markdown constructs outside the bounded subset (for example HTML block elements other than comments) are not parsed; a new construct needs a test in `tests/scripts.test.mjs`.
- The duplicated `git` helpers (work-tree detection, `--base` resolution) follow the same rule as the glob helper.
- The duplicated glob helper must be fixed in both scripts when it changes; the test suite exercises both.
