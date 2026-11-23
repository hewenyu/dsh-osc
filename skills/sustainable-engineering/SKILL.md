---
name: sustainable-engineering
description: Use when a repository changed by humans and AI agents must stay maintainable for years. Covers bootstrapping AGENTS.md, docs/, and .agents/notes/ in a new or messy repo; recording design decisions with rejected alternatives; adding word budgets, ratchet baselines, and CI gates; shipping a non-trivial feature or refactor without adding entropy; reviewing a PR or auditing repo health for decay; and turning an escaped bug into a permanent guardrail. Works with any language or stack.
---

# Sustainable Engineering

Keep a long-lived repository maintainable while many sessions, human and agent, change it. The method separates current facts from decision rationale, gives every fact one home, keeps always-loaded instructions small, and turns recurring lessons into executed checks. It is adapted from the practices of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and stated here without stack assumptions.

## Why repositories collapse

1. A new session has no memory of past requirements, so it infers intent from code.
2. It optimizes locally, bypassing conventions it cannot see.
3. It does not know which approaches already failed, so it reintroduces them.
4. Each patch adds a branch, a copy, or a global; nobody dares refactor; the next session infers worse intent from worse code.

The loop breaks only when the missing context lives in the repository, in a place each session reads, and when violations fail a check instead of waiting for a careful reviewer. Checks enforce what is mechanically checkable; architecture boundaries and test strength still rely on review and project-specific gates.

## The model

| Home | Holds | Never holds |
|---|---|---|
| `AGENTS.md` (root and subtrees; `CLAUDE.md` symlinks to it) | Standing orders, one to three lines each, each linking its home | Stories, examples, procedures, restated detail |
| `docs/` | How the system works now: architecture, module contracts, guidelines, cookbooks, postmortems | History, rationale, plans, status annotations |
| `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md` | Why a decision was made, and what was rejected | Current-state reference |
| Checks (scripts, linters, tests, CI) | Every rule that can be checked mechanically | Rules nobody runs |

Tests guard the present. Notes guard the future. Postmortems turn each escape into both.

## Rules

1. **One home per fact.** Before writing a rule or fact, search for it; if it exists, link it. Two copies drift. [Details](references/information-architecture.md).
2. **Docs state current facts outside `docs/postmortem/` and changelogs; notes state why.** Keep "previously", "we decided", and plans out of current-state docs.
3. **Write an Agent Note only for non-trivial decisions** (new capability, dependency, interface, data format, process rule, or choosing between real alternatives). Typos, renames, and local fixes are exempt. [Threshold and format](references/agent-notes.md).
4. **Every note has `## Alternatives considered`.** A decision without what it beat gets re-proposed.
5. **No central `INDEX.md` for notes.** The path is the index; a shared index file conflicts across parallel branches.
6. **Budget always-loaded text.** Standing documents have word ceilings; when over, relocate first, condense second, raise last with a justification.
7. **Promote the second identical review comment to a check**, and freeze legacy violations with a ratchet: new findings fail, the baseline only shrinks, and `--base` fails any loosening. [Details](references/mechanical-enforcement.md).
8. **Prove every guard fails.** Introduce the regression, watch the check go red, revert.
9. **Apply the five defensive habits:** explicit correctness over timing; one source of truth and named owners; extension through registered seams; change face equals review face; falsifiable evidence through the real entry path. [Details](references/defensive-habits.md).
10. **Released formats are append-only.** Add a version and an adjacent migration; never edit what shipped. [Details](references/evolution-and-incidents.md).
11. **Write prose as contracts, not transcripts.** Name exact things; delete reasoning narration, test walkthroughs, and review history from comments and docs.

## Workflow A: bootstrap governance

Use when a repository has no `AGENTS.md`, or has one that grew into a wall. Most future sessions will not trigger this skill: put every standing behavior a session must follow into `AGENTS.md`.

1. Audit first: run the health table in [review-and-audit.md](references/review-and-audit.md) to choose the starting rung. **Risk overrides rung:** an active incident runs Workflow D now; a pattern actively causing defects gets a ratchet rule on Day 1.
2. Follow the matching rung of [adoption-ladder.md](references/adoption-ladder.md). Day 1 takes 15 minutes: `AGENTS.md` from [templates/AGENTS.md](templates/AGENTS.md), `ln -s AGENTS.md CLAUDE.md`, `.agents/notes/` with [the notes README](templates/agent-notes-README.md), and one note for the decision most at risk of being undone.
3. Brownfield: never rewrite everything. Move rationale into notes, rewrite history as current state, replace duplicated rules with links, and `--init` a ratchet baseline instead of fixing all legacy violations first.
4. Fill templates only with facts you can verify in the repository. Delete placeholders you cannot fill.
5. Wire the scripts into CI and make each fail once on purpose.

## Workflow B: ship a non-trivial change without adding entropy

1. **Load context.** Read root and subtree `AGENTS.md` for the paths you will touch. Search notes: `rg -l -i "<term>" .agents/notes/{implemented,rejected,proposed} | xargs head -n 3`, then open the matches. Do not re-propose a rejected option without new evidence that beats its recorded reason.
2. **Decide where it lives.** New behavior registers at an existing extension point near its owner; state has one named owner. If the change needs a new seam, format version, or dependency, that is a decision: open or update a note.
3. **Separate faces.** Moves, renames, and formatting go in their own commit or PR; behavior changes go in the next.
4. **Write evidence first where possible.** A test through the real entry path that fails without the change; mock only network, clock, or model boundaries.
5. **Implement.** Keep comments to non-obvious contracts.
6. **Update in the same change:** module README or `docs/` for changed behavior; the owning note (move `proposed/` to `implemented/` and rewrite in present tense); the `AGENTS.md` line if a standing rule changed.
7. **Verify narrowly, report honestly.** Run the narrowest checks that cover the changed paths plus the governance scripts; show each new guard failing on an invalid case; report only commands actually run. CI owns the exhaustive matrix.

## Workflow C: review a change or audit a repository

1. Read the requirements before the diff: map changed paths to their `AGENTS.md`, defensive patterns, guidelines, and notes.
2. Apply the blocking checks in [review-and-audit.md](references/review-and-audit.md).
3. For a repository audit, score the twelve health signals and report each finding with its evidence command, owning rule, and the smallest adoption rung that fixes it.

## Workflow D: turn an escaped bug into a permanent guardrail

1. Fix the bug with a regression test through the real entry path; confirm it fails with the bug restored.
2. If the bug is subtle, systemic, and costly to rediscover, write `docs/postmortem/yyyy-mm-dd-slug.md` from [the template](templates/postmortem.md): executive summary, timeline with wrong hypotheses, root cause, why each safety net missed it.
3. Add guardrails for the class, not only the instance: a rule in `AGENTS.md` or defensive patterns that links the postmortem, and a mechanical gate (lint rule, ratchet rule, CI check) when the class is checkable. Verify each fails on the bug.
4. If the fix changes a design decision, update or supersede the owning note.

## Tools

Zero-dependency Node.js (>= 18) scripts. Run them from this skill's directory with `--root <repo>`, or copy them into the target repository's `scripts/governance/`. Each supports `--help` and `--version`; exit 0 is ok, 1 a violation, 2 a usage or configuration error.

| Script | Enforces |
|---|---|
| [verify-doc-budgets.mjs](scripts/verify-doc-budgets.mjs) | Word ceilings; CJK characters count as words; `--base` fails a raised ceiling |
| [verify-agent-notes.mjs](scripts/verify-agent-notes.mjs) | Note paths, status, non-empty required sections, no index; `--base` freezes `archived/` and `rejected/` |
| [ratchet-baseline.mjs](scripts/ratchet-baseline.mjs) | Fingerprinted legacy baseline for regex or linter findings; `--base` fails loosening; no add command |
| [verify-md-links.mjs](scripts/verify-md-links.mjs) | Relative Markdown links and heading anchors resolve |

Templates in [templates/](templates/): root and docs `AGENTS.md`, notes README, note lifecycles, postmortem, budget manifest, ratchet config, hooks, CI workflow, CODEOWNERS, PR template.

## References

Load only the one the task needs.

| Load | When |
|---|---|
| [information-architecture.md](references/information-architecture.md) | Writing or restructuring `AGENTS.md` or `docs/`; doc review; budgets |
| [agent-notes.md](references/agent-notes.md) | Writing, moving, archiving, or reviewing a decision note |
| [mechanical-enforcement.md](references/mechanical-enforcement.md) | Adding a gate, ratchet, hook, CI job, or generated artifact |
| [defensive-habits.md](references/defensive-habits.md) | Designing or reviewing code structure, state, extension, tests |
| [evolution-and-incidents.md](references/evolution-and-incidents.md) | Versioning formats or migrations; writing a postmortem |
| [adoption-ladder.md](references/adoption-ladder.md) | Choosing how much governance to install |
| [review-and-audit.md](references/review-and-audit.md) | Reviewing a PR or auditing repository health |
