# Agent Notes

<!-- Copy to .agents/notes/README.md. Edit the class table to your project; pass the same set to verify-agent-notes with --classes. Delete this comment. -->

An Agent Note records a decision that affects this codebase: why it was made and what was given up, the parts code and `docs/` cannot carry. `docs/` states how the system works now; notes state why it works that way.

## When to write one

Write or update a note in the same change only for lasting rationale that code, tests, and docs do not explain:

| Write a note | Skip the note |
|---|---|
| A new capability, module, dependency, or public interface | Typo, formatting, rename with no behavior change |
| A data format, wire protocol, or persistence change | A local bug fix whose cause is obvious from the diff |
| Choosing between real alternatives, or rejecting a tempting one | Local UI tweaks, copy edits, dependency bumps |
| A process or tooling rule (new gate, workflow, policy) | Following an existing note's decision |

Updating the note that already owns a decision satisfies the rule; do not create a duplicate.

## Layout

`{lifecycle}/{class}/yyyy-mm-dd-topic.md`. The date is when the topic was first proposed. The path is the index: there is no `INDEX.md`, so parallel branches never conflict on one file. Before designing, search the live lifecycles and read titles and status lines first:

```sh
rg -l -i "<module or concept>" .agents/notes/{implemented,rejected,proposed} | xargs head -n 3
```

Titles name the chosen option and the one it beat ("SQLite, not Redis, for local job state") so this search finds both.

- `proposed/` — reviewed before building; may use future tense.
- `implemented/` — shipped; present tense; kept current when paths, names, or defaults move.
- `rejected/` — declined; kept only while it prevents a tempting mistake.
- `archived/` — frozen history; never edited; not current authority.

| Class | Covers |
|---|---|
| `feature` | A new user- or model-facing capability |
| `bug-fix` | A defect or a gap a postmortem surfaced |
| `simplification` | Removing code or surface without adding capability |
| `architecture` | Structure of the shipped source |
| `process` | Tooling, gates, workflow, policy around the code |
| `testing` | Test infrastructure and strategy |

## Format

Line 1 `# Agent Note: <title>`, line 3 `Status: proposed | implemented | rejected — <reason>`. The body opens with `## Problem`. Headings and the Status line stay in English so the verifier can read them; section bodies may use any language. Every note has `## Alternatives considered`: each genuine alternative and why it lost. A decision without what it beat gets re-proposed.

- proposed: Problem, Proposal, Alternatives considered, Acceptance criteria, Risks
- implemented: Problem, Decision, Alternatives considered, Consequences
- rejected: the proposal frozen, with the verdict on the Status line

## Transitions

- proposed → implemented: move the file, set `Status: implemented`, rewrite Proposal as a present-tense Decision, fold Acceptance criteria and Risks into Consequences.
- proposed → rejected: move the file, add the reason to the Status line, change nothing else.
- Reversing a decision: write a new note and cross-link both; never edit a note into a different decision.
- implemented → archived: move unchanged, add `Archived: yyyy-mm-dd` below the Status line, then freeze.

`node scripts/governance/verify-agent-notes.mjs` enforces the layout and format.
