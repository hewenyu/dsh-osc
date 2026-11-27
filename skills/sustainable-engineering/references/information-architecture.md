# Information architecture and context budgets

How to lay out the words in a repository so that every agent session starts with the right rules in context, finds each fact in exactly one place, and never loads a 5,000-word instruction file.

## The three homes

| Home | Answers | Audience | Changes when |
|---|---|---|---|
| `AGENTS.md` (root + subtrees) | "What must I always do here?" | Every session, automatically loaded | A standing rule is added or retired |
| `docs/` | "How does the system work now?" | Developers, users, agents doing a task | The code's behavior changes |
| `.agents/notes/` | "Why is it built this way, and what was rejected?" | Future maintainers, new agent sessions | A non-trivial decision is made or reversed |

Facts and rationale are separated because they decay differently. A current-state fact is wrong the moment code changes and must be edited in place. A rationale stays true about the moment it was decided; mixing it into `docs/` buries current facts under history, and omitting it lets the next agent re-propose the rejected option. See [agent-notes.md](agent-notes.md) for the rationale home.

## AGENTS.md hierarchy

- **Root `AGENTS.md`**: standing orders only. Each rule is one to three lines and links the document that owns its detail. Typical sections: one-paragraph orientation, repository layout, commands, conventions, review rules, how to edit this file. Starter: [templates/AGENTS.md](../templates/AGENTS.md).
- **Subtree `AGENTS.md`** (`packages/AGENTS.md`, `docs/AGENTS.md`, `.agents/notes/implemented/AGENTS.md`): rules that apply only inside that directory. Never repeat a root rule in a subtree file. Claude Code loads nested files when working in that subtree; agents that only walk upward from where they start (Antigravity, Codex outside its startup path) do not, so the root file's layout section names each subtree `AGENTS.md` and says when to read it. Antigravity can also scope a rule with a glob-triggered `.agents/rules/*.md`.
- **`CLAUDE.md` imports `@AGENTS.md`** at every level that has an `AGENTS.md`: create a one-line `CLAUDE.md` containing `@AGENTS.md`. One source file serves Claude Code (reads `CLAUDE.md` and expands `@AGENTS.md`), Codex, and Antigravity (read `AGENTS.md`), without relying on filesystem symlinks that break across Windows checkouts, archive exports, and tools that do not follow links. For a tool that expects another name, such as Gemini CLI's `GEMINI.md`, point its context-file setting at `AGENTS.md` or use its file-import syntax. If a `CLAUDE.md` with different content already exists, merge its unique rules into `AGENTS.md` first, then replace it with `@AGENTS.md`.
- **Dense rule format.** Bold lead clause stating the rule, then the condition or exception, then a link: `**Shared state has one named owner.** No module-level singletons ([why](docs/defensive-patterns.md)).` The link carries the explanation so the always-loaded file stays small.

DeepSeek Harness keeps a root file of about 2,000 words over a 50-package monorepo by applying this format to roughly 40 rules.

## One home per fact

Every fact has one owning document, chosen by its kind; everywhere else links to it. A starter tier table is in [templates/docs-AGENTS.md](../templates/docs-AGENTS.md). Placement rules that cover most cases:

- Standing order → root `AGENTS.md`, with a link to its rationale.
- How the system works now → `docs/architecture.md` or the owning module README.
- Why, and what was given up → an Agent Note.
- Step-by-step procedure → `docs/cookbook/`.
- Design rules independent of features → `docs/core-guidelines.md`, numbered (`G.1`, `B.3`) so reviews can cite them.
- Review rules per artifact, each with the defect it prevents → `docs/defensive-patterns.md` (see [defensive-habits.md](defensive-habits.md)).
- A bug's story → `docs/postmortem/` (see [evolution-and-incidents.md](evolution-and-incidents.md)).
- Anything a generator can produce from source (API tables, CLI help, config catalogs) → generated file with a freshness check, never hand-written (see [mechanical-enforcement.md](mechanical-enforcement.md)). Until a generator exists, delete a drifted hand-copied catalog and link the source file that owns it (the route table, the config schema).

A document describes its own subject in detail and its direct children only by purpose; lower-level detail is a link to the child's owner. Duplicated rules drift: when two copies disagree, agents pick one at random.

## Prose rules

These keep documents short enough to be read and precise enough to be followed:

- **Current state only** outside postmortems, notes, and changelogs. "Previously", "now", "no longer", "new in v2" mark history in a current-state document.
- **Name the exact thing.** The function, file, field, command, or error code, not a metaphor or a vague noun ("the surface", "the layer").
- **No reasoning transcripts** in comments or docs. Keep the contract (behavior, failure, timing, ownership, consequence); delete the narration of how it was derived, test walkthroughs, and review history. This is the "chain-of-thought leakage" failure typical of agent-written code.
- **Comments state non-obvious contracts.** Do not restate what code says; do not explain distant behavior; link the rationale.
- **No status annotations** ("implemented!", "future: …") in prose or diagrams.
- **Reserve emphasis** for the clause that changes behavior.

### Slop checklist

Run this against any document an agent produced:

1. Duplicated rule: search a distinctive phrase; keep one home, link the rest.
2. History outside its tier.
3. Status annotations.
4. Hand-restated catalogs, API docs, or file inventories.
5. Reasoning transcript or test walkthrough.
6. The same rationale repeated beside sibling functions.
7. Paragraph walls carrying several rules.
8. Emphasis inflation.
9. Plan language ("should", "will", migration steps) in a shipped decision record.

## Word budgets

Standing documents get hard word ceilings in a manifest ([template](../templates/doc-budgets.manifest.json)) checked by [`verify-doc-budgets.mjs`](../scripts/verify-doc-budgets.mjs). Budget the documents that are loaded often or grow by accretion: root and subtree `AGENTS.md`, `architecture.md`, the notes README, any `SKILL.md`. Add each new subtree `AGENTS.md` to the manifest in the change that creates it. Reasonable starting ceilings: root `AGENTS.md` 1,200–2,000; subtree `AGENTS.md` 600; `architecture.md` 2,400. In CI, `--base` fails a raised ceiling or a removed entry unless the reviewed change passes `--allow-ceiling-change`.

When the check fails, in this order:

1. **Relocate** content that belongs in another tier; leave a one-line link.
2. **Condense** content that belongs here.
3. **Raise** the ceiling only when the content needs the space, with the justification in the pull request. A ceiling that is too low is a budget bug, not a reason to delete required rules: a standing rule leaves only by relocation, with a link left behind.

Keep roughly 5% headroom after any change so the next legitimate edit does not fail immediately. Ceilings are guardrails, not reduction targets.

## Provenance

Patterns from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): root and subtree `AGENTS.md`, the `CLAUDE.md` → `AGENTS.md` delegation (standardized here on `@AGENTS.md` import rather than a filesystem symlink), the tier table in `docs/AGENTS.md`, the slop checklist, and `scripts/verify-doc-budgets.ts`. The CJK-aware counting in this skill's script is an addition for Chinese and Japanese documentation.
