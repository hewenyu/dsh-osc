# Agent Note: Use @AGENTS.md import in CLAUDE.md, not a symlink

Status: implemented

## Problem

Repositories need one authoritative standing-order file (`AGENTS.md`) while remaining readable by Claude Code (`CLAUDE.md`), Codex, and Antigravity. A filesystem symlink (`CLAUDE.md -> AGENTS.md`) breaks on Windows checkouts without symlink support (`core.symlinks = false`), degrades to a plain text filename in zip/archive exports, and confuses tools or editors that treat symlinks inconsistently.

## Decision

Every directory that defines `AGENTS.md` pairs it with a regular file `CLAUDE.md` containing a single line:

```text
@AGENTS.md
```

Claude Code expands `@AGENTS.md` when loading `CLAUDE.md`, while Codex and Antigravity read `AGENTS.md` directly. This repository's root `CLAUDE.md`, `SKILL.md`, references, templates, READMEs, and adoption tests all use `@AGENTS.md` as the standard mechanism.

## Alternatives considered

- **Filesystem symlink (`ln -s AGENTS.md CLAUDE.md`), as in DeepSeek Harness.** Rejected as the default: fails or turns into a literal text pointer on Windows checkouts without developer-mode symlink privileges, breaks in archive downloads, and adds OS-specific conditionals to scripts and tests.
- **Duplicate rules in both `AGENTS.md` and `CLAUDE.md`.** Rejected: violates one home per fact; two copies inevitably drift.
- **Omit `CLAUDE.md` and rely only on `AGENTS.md`.** Rejected: older Claude Code versions and workflows expecting `CLAUDE.md` would silently skip standing orders.

## Consequences

- `AGENTS.md` remains the sole editable source of standing orders; `CLAUDE.md` is a one-line cross-platform pointer that works identically on macOS, Linux, Windows, and archive downloads.
- `CODEOWNERS` continues to protect both `/AGENTS.md` and `/CLAUDE.md` so an unreviewed change cannot turn `CLAUDE.md` into a second diverging copy.
- `verify-md-links.mjs` scans `CLAUDE.md` as a regular Markdown file (zero links, passes) and still retains its symlink-skipping behavior for repositories that contain symlinks elsewhere.
