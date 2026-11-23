# Review and repository-health audit

Checklists for workflow C: reviewing one change, and auditing a whole repository for decay. Both read the requirements before the code: map the changed paths to their owning rules, open those rules, then judge the diff against them. Judging from memory of the rules is how violations pass review.

## Reviewing a change

### Before reading the diff

1. Establish the real base and head; list changed paths (`git diff --name-status <base>...<head>`).
2. Read the root `AGENTS.md`, any subtree `AGENTS.md` on the changed paths, and the defensive patterns and core guidelines for the touched areas.
3. Search Agent Notes for the touched modules: `rg -l -i "<module>" .agents/notes/{implemented,rejected,proposed} | xargs head -n 3`. A change that contradicts an implemented note needs a new note, not silence. Disagreement with a note is a design discussion, not an automatic veto.

### Blocking checks

| Check | Failure looks like |
|---|---|
| Change face | Behavior edits hidden in a move, rename, or reformat; unrelated drive-by changes |
| Docs match code | Config, defaults, errors, or public behavior changed without the README or API docs in the same diff |
| Decision memory | A non-trivial decision with no note; a proposed note not moved and rewritten to present tense when implemented; a missing or invented `## Alternatives considered` |
| One source of truth | A second copy of a fact, config default, or state; a new global singleton; derived state updated before the commit point |
| Seams | A business branch added to a central dispatcher instead of a registration |
| Released formats | An edit to a released schema, migration, or fixture instead of an additive successor |
| Evidence | No test that fails on the intended regression; assertions on self-reports; mocks of the thing under test; claims without the commands run |
| Negative controls | A new or changed gate or test never shown failing on an invalid case |
| Ratchet | A baseline entry added, a count increased, a rule dropped, or a glob loosened (`ratchet-baseline --base` fails these in CI; [CODEOWNERS](../templates/CODEOWNERS) covers edits to the checker itself) |
| Budget compliance | A standing rule silently deleted to stay under a word ceiling; a relocated rule that left no link; a raised ceiling without a justification |
| Prose | Reasoning transcripts in comments, history in current-state docs, restated catalogs, metaphors instead of exact names |

### Questions that find what checklists miss

- What is the required behavior behind each new option, field, adapter, state machine, or compatibility path? Which current consumer needs it?
- Trace both sides of every changed interface: errors, cancellation, ownership, disposal.
- Follow every denial or validation to the operation that executes it; can a direct caller bypass it?
- Do limits (bytes, items, time) apply to the complete final result, including wrappers?

## Auditing repository health

Score each row 0 (absent), 1 (partial), 2 (enforced by a check). Totals: under 8 means start at Day 1 of [adoption-ladder.md](adoption-ladder.md); 8 to 16 means Week 1 or Growing team; above 16 means maintain and prune. Critical invariants are vetoes, not points: an active incident, data corruption, or a main path with no real-entry test is fixed first, whatever the total ([risk overrides rung](adoption-ladder.md)).

| # | Signal | How to measure |
|---|---|---|
| 1 | Root `AGENTS.md` exists, dense, links its homes | Read it; word count; lines without links that need them |
| 2 | `CLAUDE.md` and other agent filenames resolve to `AGENTS.md` | `ls -l CLAUDE.md` |
| 3 | Facts and rationale separated | `rg -n -i -e 'we decided' -e 'we chose' -e previously -e 'no longer' docs/` |
| 4 | Agent Notes exist with alternatives | `verify-agent-notes.mjs`; count notes per class |
| 5 | No central index file | `find . -iname 'INDEX.md' -not -path '*/node_modules/*'` |
| 6 | Word budgets on standing docs | `verify-doc-budgets.mjs --list` |
| 7 | Links resolve | `verify-md-links.mjs` |
| 8 | Recurring review rules are gates | Compare the last 20 review comments with the gate list |
| 9 | Legacy debt ratcheted, baseline shrinking | `ratchet-baseline.mjs --list`; `git log -p` on the baseline |
| 10 | Tests through real entry paths | Is there at least one test that starts the shipped binary, server, or loader? |
| 11 | Released formats append-only | Any edits to old migrations or fixtures in `git log`? |
| 12 | Postmortems produce guardrails | Each postmortem lists a test, rule, and gate |

### Decay signals to report

- Duplicated rules that disagree between files.
- An `AGENTS.md` over budget, or with stories and examples.
- Repeated agent "corrections" in history that undo each other (a decision with no note).
- Central files every feature edits (dispatcher, router, constants table) with high churn: `git log --format= --name-only | sort | uniq -c | sort -rn | head`.
- Tests that mock the module they test; coverage high while production incidents recur.
- Hooks routinely bypassed; CI red on the main branch for days.

Report findings with the evidence command, the owning rule, and the smallest rung of the adoption ladder that fixes each.
