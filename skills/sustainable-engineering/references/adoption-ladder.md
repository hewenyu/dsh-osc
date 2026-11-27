# Adoption ladder

Adopt governance in the order that pays back fastest. Each rung is useful on its own; stop at the rung that matches the project's size and risk. Do not install the whole system on day one: ceremony without a problem to solve is its own decay.

Scripts below are copied from this skill's `scripts/` into the target repository's `scripts/governance/`; templates come from `templates/`. Each script prints its version with `--version`; compare it with the skill's copy when upgrading.

**Risk overrides rung.** The ladder governs optional governance, not incident response. An active incident runs Workflow D (fix, regression test, postmortem, guardrail) immediately at any rung. A pattern actively causing defects gets one ratchet rule the same day, even on Day 1. Pull forward only what the risk needs, not the rest of its rung.

## Day 1 (15 minutes, solo or brownfield)

Goal: every new agent session starts with the right rules, and decisions stop evaporating.

1. Create a root `AGENTS.md` from [templates/AGENTS.md](../templates/AGENTS.md). Fill in only: one-paragraph orientation, layout, the commands you actually use, and the five to ten rules you have already repeated to an agent more than once. Delete placeholder rules you cannot fill truthfully.
2. Create `CLAUDE.md` containing a single line: `@AGENTS.md`.
3. `mkdir -p .agents/notes/{proposed,implemented,rejected}` and copy [templates/agent-notes-README.md](../templates/agent-notes-README.md) to `.agents/notes/README.md`. Class folders are created when the first note needs one.
4. Write the first note about the decision you most fear an agent will undo (the database choice, the "no ORM" rule, the reason for the odd retry logic), using [templates/agent-note-implemented.md](../templates/agent-note-implemented.md). Link it from the matching `AGENTS.md` rule.

Skip for now, unless risk overrides the rung: budgets, hooks, CI, ratchets, postmortems.

## Week 1 (an hour or two)

Goal: the words stay small and the notes stay well-formed without anyone remembering to check.

1. Copy `verify-doc-budgets.mjs`, `verify-agent-notes.mjs`, and `verify-md-links.mjs` to `scripts/governance/`.
2. Add [templates/doc-budgets.manifest.json](../templates/doc-budgets.manifest.json) to `scripts/governance/` with ceilings about 10% above current word counts (`--list` shows them). Remove entries for files you do not have. A file already above the [reference range](information-architecture.md#word-budgets) (a 5,000-word root `AGENTS.md`) is relocated first; then its ceiling is set 10% above the reduced count.
3. Run all three in CI ([templates/github-actions-governance.yml](../templates/github-actions-governance.yml); its ratchet step stays skipped until a baseline exists). Make each fail once on purpose (exceed a ceiling, delete an `## Alternatives considered`, break a link) to confirm it is wired.
4. Start `docs/architecture.md` as a one-page map: components, data flow, extension points. Copy [templates/docs-AGENTS.md](../templates/docs-AGENTS.md) to `docs/AGENTS.md`.
5. Brownfield: move rationale paragraphs out of existing docs into notes, and rewrite history phrases ("we used to") as current state.

## Growing team (2 to 10 regular contributors, or several parallel agents)

Goal: recurring review comments become checks; legacy debt stops growing.

1. Copy `ratchet-baseline.mjs` and [templates/ratchet.config.json](../templates/ratchet.config.json). Add rules for the two or three patterns review keeps catching. Run `--init` once, commit the baseline; CI then runs the check with `--base`.
2. Copy [templates/CODEOWNERS](../templates/CODEOWNERS) to `.github/CODEOWNERS` and require owner review, so changes to `scripts/governance/**`, `AGENTS.md`, and the workflow cannot loosen a gate unreviewed.
3. Install local hooks ([templates/lefthook.yml](../templates/lefthook.yml)): staged lint, whitespace, notes format. Keep them under a few seconds.
4. Add the PR template ([templates/pull-request-template.md](../templates/pull-request-template.md)): change face, evidence with commands run, negative controls, note link.
5. Write `docs/defensive-patterns.md` from the five habits in [defensive-habits.md](defensive-habits.md), keeping only rules your project has actually violated.
6. Add subtree `AGENTS.md` files where one area has rules nobody else needs (`frontend/AGENTS.md`, `migrations/AGENTS.md`), each named in the root layout section and budgeted.
7. Start postmortems for escapes that meet the subtle + systemic + costly bar.

## Scale (monorepo, many teams, long-lived releases)

Goal: the system enforces itself and keeps history immutable.

1. Numbered `docs/core-guidelines.md` so reviews cite rule IDs.
2. Generated catalogs (API, config, CLI help, schemas) with freshness checks; remove every hand-maintained copy.
3. Append-only enforcement for released formats and archived notes (`verify-agent-notes --base origin/main`, a similar check for `migrations/`); see [evolution-and-incidents.md](evolution-and-incidents.md).
4. Replace regex ratchet rules with parser-based scanners where false positives appear, keeping the same baseline contract.
5. Archive implemented notes that no longer guide work; delete rejected notes that no longer prevent a mistake.
6. A CI dependency graph that runs independent gates in parallel and reports each separately.
7. Bilingual docs, if needed, with a pairing check so translations cannot drift silently.

## Signals you are over-governing

- Notes for trivial edits. Tighten the threshold in the notes README.
- Hooks people bypass with `--no-verify`. Move the slow part to CI.
- An `AGENTS.md` rule nobody can explain. Delete it or link its rationale.
- A ceiling raised every month. The document is collecting content that belongs elsewhere; relocate.
- Ratchet rules whose baseline never shrinks. Keep the cap, since it still blocks new debt, and schedule cleanup. Retire a rule only when its invariant is obsolete, with a tombstone and a `process` note.
