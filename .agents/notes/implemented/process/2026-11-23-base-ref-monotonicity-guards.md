# Agent Note: Merge-base comparison, not review alone, guards gates against loosening

Status: implemented

## Problem

A gate can be loosened by editing its own inputs, and every script still exits 0: an agent bumps a count in `ratchet.baseline.json`, deletes the baseline and runs `--init` again, drops a rule and re-adopts it with `--init-rule`, adds an `exclude` glob, raises a ceiling in the budget manifest, or edits a rejected or archived note. In a repository changed mostly by agents, often with no human reviewer on each change, "reviewers reject baseline growth" is not enforced by anything. Comparing with the base branch tip instead of the merge-base also blames a stale branch for commits that landed on the base after it branched.

## Decision

`ratchet-baseline.mjs`, `verify-doc-budgets.mjs`, and `verify-agent-notes.mjs` accept `--base <ref>`. Each rejects an option-shaped ref, resolves it with `git rev-parse --verify --end-of-options <ref>^{commit}`, and compares with `git merge-base <oid> HEAD`:

- `ratchet-baseline.mjs` reads the config and baseline at the merge-base with `git show` and fails when a recorded rule gains a fingerprint or count, leaves the config or the baseline, changes its pattern, flags, `multiline`, or `external` setting, loses an `include` glob, gains an `exclude` glob, or turns on `allowEmpty`, and when the config gains a top-level `exclude` glob. Every configured rule is recorded even with no findings, and a retired rule stays in the config as `{ "id", "retired": "<reason>" }` with an empty baseline entry, so `--prune` never erases adoption history.
- `verify-doc-budgets.mjs` fails when a ceiling rose or a budgeted entry left the manifest, unless `--allow-ceiling-change` is passed; the CI templates pass it only for pull requests labelled `governance-override`.
- `verify-agent-notes.mjs` fails on any modification or deletion under `archived/` and any modification under `rejected/`, reading `git diff --name-status --no-renames -z`.

The workflow templates bind `github.base_ref` and `github.event.before` to environment variables and pass them to the scripts as data. `templates/CODEOWNERS` assigns `scripts/governance/`, `AGENTS.md`, `CLAUDE.md`, and the workflow to an owner team, because `--base` cannot stop a change that edits the checker itself.

## Alternatives considered

- **Review only (the status quo).** Rejected: the review checklist already listed "baseline count increased", and the evaluations reproduced each loosening path with every check green; agent-only repositories have no reviewer to apply it.
- **A `Governance-Override:` commit trailer pointing at a process note.** Rejected: any agent can write a trailer, so it moves the decision into the same unreviewed change. A pull-request label is applied outside the diff by someone with triage rights, and CODEOWNERS requires an owner's approval.
- **Compare with the base branch tip.** Rejected: on a branch cut before the base archived a note or tightened a ceiling, the tip comparison reports those base-side changes as this branch's violations.
- **Allow pattern edits on a recorded rule.** Rejected: a narrower pattern is the quietest loosening. A changed rule is adopted under a new id while the old one is retired, and both are visible in the config diff.

## Consequences

- Loosening a recorded rule, a ceiling, or a frozen note fails CI on every pull request; `tests/scripts.test.mjs` reproduces each path from the evaluations as a negative control.
- Adopting a brand-new rule still records whatever debt exists when it is adopted; that only ever adds protection.
- Retiring a rule and adopting a replacement in the same change can carry more debt than the retired rule had; CODEOWNERS review of the config is the remaining guard.
- `--base` needs the base history in the checkout (`fetch-depth: 0` in the workflow templates) and exits 2 when the ref cannot be resolved.
