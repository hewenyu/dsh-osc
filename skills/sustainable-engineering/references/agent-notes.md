# Agent Notes: decision memory

An Agent Note records one decision: the problem, what was chosen, what was rejected and why, and what the choice costs. It is the memory a new agent session does not have. Without it, the next session reconstructs intent from code, misses the constraint, and re-proposes the option that was already rejected.

## When to write one

Write or update a note in the same change only for lasting rationale that code, tests, and `docs/` do not explain.

| Non-trivial: write or update a note | Trivial: no note |
|---|---|
| New capability, module, dependency, or public interface | Typos, formatting, renames with no behavior change |
| Data format, wire protocol, persistence, or migration | A local bug fix whose cause is evident from the diff |
| Choosing between genuine alternatives | Local UI or copy tweaks |
| Rejecting a tempting proposal | Version bumps that change nothing observable |
| New gate, workflow, or policy | Work that follows an existing note's decision |
| An agent repeatedly "corrects" the same thing the wrong way | |

The last row matters most in agent-heavy repositories. DeepSeek Harness wrote `2026-07-26-dependencies-over-hand-rolling.md` because agents inferred an unwritten "never add dependencies" rule and kept hand-rolling libraries; one note with rejected alternatives ended it.

Updating the note that already owns the decision satisfies the rule. Never create a second note for the same decision.

## Layout: the path is the index

```
.agents/notes/
  README.md                      format and rules (template: templates/agent-notes-README.md)
  proposed/{class}/yyyy-mm-dd-topic.md
  implemented/{class}/yyyy-mm-dd-topic.md
  rejected/{class}/yyyy-mm-dd-topic.md
  archived/{class}/yyyy-mm-dd-topic.md
```

- **Lifecycle** is the top folder; a note moves between folders as its status changes. A chosen design, with what it beat under Alternatives, goes in `implemented/`. A standalone `rejected/` note is for a proposal declined while the status quo stayed; never write both for one decision.
- **Class** is a closed set: `feature`, `bug-fix`, `simplification`, `architecture` (structure of shipped source), `process` (tooling and policy around the code), `testing`. `refactor` is deliberately absent: "does observable behavior change?" already sorts it. A fix that introduces a new seam or owner is `architecture`; `bug-fix` is for fixes inside the existing structure.
- **Date** is when the topic was first proposed. It never changes when the note moves. When recording an older decision whose date git history cannot recover, use today's date and state the reconstruction in `## Problem`; never invent a past date.
- **Title** names the chosen option and the one it beat ("SQLite, not Redis, for local job state"), so a search for either finds it.
- **No `INDEX.md`.** A central index duplicates what paths already encode, and every branch that adds a note edits the same file, so parallel branches and parallel agents conflict on it. Browse the folders, or `grep -r` / `rg`.
- Cross-references are relative Markdown links, never prose like "see the caching note", so a link checker can verify them.

## Format

Line 1 is `# Agent Note: <title>`, line 2 is blank, line 3 is the status, and the body opens with `## Problem` written so it stands without the solution. Headings and the Status line stay in English so the verifier can read them; section bodies may use any language. Every required section needs visible content: an HTML comment or a bare `TODO`/`TBD` fails.

| Lifecycle | Status line | Required sections |
|---|---|---|
| proposed | `Status: proposed` | Problem, Proposal, Alternatives considered, Acceptance criteria, Risks |
| implemented | `Status: implemented` | Problem, Decision, Alternatives considered, Consequences |
| rejected | `Status: rejected — <one-line reason>` | Problem, Proposal, Alternatives considered |
| archived | `Status: implemented` + `Archived: yyyy-mm-dd` | as implemented, frozen |

Templates: [proposed](../templates/agent-note-proposed.md), [implemented](../templates/agent-note-implemented.md), [rejected](../templates/agent-note-rejected.md). [`verify-agent-notes.mjs`](../scripts/verify-agent-notes.mjs) enforces all of the above.

### Alternatives considered is mandatory

Each genuine alternative gets one bold-led line and the concrete reason it lost. A decision recorded without what it beat invites re-litigation, which is the failure notes exist to prevent. Alternatives are recorded, never invented: if a decision truly had no contender, write the status quo as the alternative and say why it was insufficient.

### Status lines carry no dates

The filename holds the proposal date; version control holds everything else. A rejected note's reason is the one status with content, because the verdict is what a reader comes for.

## Lifecycle transitions

| Transition | What changes |
|---|---|
| proposed → implemented | Move the file. Set `Status: implemented`. Rewrite `## Proposal` as a present-tense `## Decision` describing what shipped. Fold Acceptance criteria and Risks into `## Consequences` or a present-tense `## Verification`. Delete plans. |
| proposed → rejected | Move the file. Add the reason to the Status line. Change nothing else; the proposal is frozen, and `--base` fails later edits. |
| implemented, facts drift | Update paths, names, defaults, and mechanisms in place in the same change that moves them. No change-history paragraphs. |
| implemented, decision reversed | Write a new note; cross-link both. Never edit a note into a different decision. |
| implemented → archived | When the decision is complete and unlikely to guide future work but has historical value: move it unchanged, add `Archived: yyyy-mm-dd` below the Status line, and freeze it. `verify-agent-notes --base <ref>` fails any later edit or deletion. |
| rejected, no longer tempting | Delete it. A rejected note earns its place only while it prevents a plausible mistake. |

Plan language ("should", "will", `## Plan`, `## Migration plan`, `## Acceptance criteria`) in an implemented note means the proposed → implemented rewrite was skipped; the verifier rejects those headings.

### Consolidation

A fully superseded implemented note may be merged into its current owner and deleted only when the owner preserves every unique rationale, alternative, consequence, and verification, and every inbound link is repaired. Partial supersession keeps both notes, cross-linked. Never rely on version-control history as the only copy of a rationale.

## Workflow inside a change

1. Before designing, search the live lifecycles and read titles and status lines first: `rg -l -i "<term>" .agents/notes/{implemented,rejected,proposed} | xargs head -n 3`. Open the notes that match; do not re-propose a rejected option without new evidence that beats its recorded reason. `archived/` is history, searched only on purpose.
2. For substantial future work, open a `proposed/` note and get it reviewed before building.
3. In the implementing change, move it to `implemented/` and rewrite it to present tense.
4. Link the note from the root `AGENTS.md` rule or module README that states the resulting rule, so the rule stays one line and the why stays one click away.

## Provenance

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `.agents/notes/README.md`, `.agents/notes/implemented/AGENTS.md`, and `scripts/verify-agent-note-format.ts`, which keep well over a thousand bilingual notes navigable under this scheme without an index.
