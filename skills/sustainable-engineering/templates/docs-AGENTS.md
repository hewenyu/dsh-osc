# AGENTS.md — Documentation standard

<!-- Copy to docs/AGENTS.md and create its alias with: ln -s AGENTS.md docs/CLAUDE.md (every directory with an AGENTS.md gets one). Adjust the tier table to the documents your repository actually has. Delete this comment. -->

This file defines where each kind of fact lives and how documentation is written. It applies to `docs/`, package READMEs, and the root `AGENTS.md`; [Agent Notes](../.agents/notes/README.md) follow their own format.

## One home per fact

| Tier | Job | Does not belong there |
|---|---|---|
| Root `AGENTS.md` | Standing orders needed in every session, one to three lines each, linking their home | Stories, examples, procedures, anything restated from a linked home |
| Subtree `AGENTS.md` | Orders specific to that subtree | Repo-wide rules the root already carries |
| `architecture.md` | Map of components, data flow, seams, and extension points | Type definitions, per-module detail, decision rationale |
| Module/package README | That module's contract: config, behavior, limits, extension points | Other modules' concerns, restated API docs |
| `core-guidelines.md` | Numbered design rules that hold regardless of feature | Business-domain rules |
| `defensive-patterns.md` | Review rules per artifact, each stating the defect it prevents | Rationale history |
| `cookbook/` | Step-by-step how-tos with verify steps | Design rationale |
| `postmortem/` | Incident write-ups: the only tier for war stories | — |
| `.agents/notes/` | Decision rationale and rejected alternatives | Current-state reference |
| Generated reference | Catalogs produced from source and freshness-checked | Hand edits |

Placement: bugs → postmortems; rationale → Agent Notes; procedures → cookbook; module contracts → READMEs; standing orders → root `AGENTS.md` with a link.

## Writing rules

- **Document current state.** No "previously", "now", "no longer", or "new in v2" outside postmortems, notes, and changelogs.
- **Link instead of restating.** Search for a distinctive phrase before adding a rule; if it exists, link it.
- **Do not hand-copy what a generator or the source owns** (API lists, config tables, file inventories).
- **No status annotations** ("implemented!", "TODO: future") in prose; status rots.
- **No reasoning transcripts.** Keep the resulting contract; delete the path used to derive it.
- **Name the exact thing.** Prefer the function, file, field, or command over a metaphor.
- **Reserve emphasis** for the clause that changes behavior.

## Word budgets

`scripts/governance/doc-budgets.manifest.json` sets ceilings; `verify-doc-budgets` rejects excess. When it fails: relocate content to its owning tier, then condense, and raise the ceiling only with a justification in the PR.
