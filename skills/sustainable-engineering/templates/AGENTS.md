# AGENTS.md

<!-- Root standing orders: rules every agent and contributor needs in every session. One to three lines per rule, each linking the document that owns the detail. Most sessions never load the sustainable-engineering skill, so every behavior a session must follow lives here. Create the CLAUDE.md alias with: ln -s AGENTS.md CLAUDE.md. Word ceiling: scripts/governance/doc-budgets.manifest.json. Links inside comments are not checked; move each into the text once its target exists. Delete this comment. -->

<Project name> is <one sentence: what it is and who uses it>. Read [docs/architecture.md](docs/architecture.md) before changing `<src dir>/`; follow [docs/AGENTS.md](docs/AGENTS.md) when writing documentation.

## Repository layout

```
<src>/        <one-line responsibility>
<tests>/      <one-line responsibility>
docs/         current-state documentation (docs/AGENTS.md)
.agents/notes/ decision records: why, and what was given up (.agents/notes/README.md)
scripts/      gates and generators
```

## Commands

```sh
<install command>
<focused test command, e.g. one file or one test name>
<full test command>          # CI runs this; locally only on request or for cross-cutting changes
<lint / typecheck command>
node scripts/governance/verify-doc-budgets.mjs
node scripts/governance/verify-agent-notes.mjs
node scripts/governance/verify-md-links.mjs
node scripts/governance/ratchet-baseline.mjs   # once the ratchet is adopted (Growing team)
```

## Before designing a change

- **Search decision memory first.** `rg -l -i "<module or concept>" .agents/notes/{implemented,rejected,proposed} | xargs head -n 3`, then read the matching notes. Never re-propose a rejected option without new evidence that beats its recorded reason ([format](.agents/notes/README.md)).
- **Mock only external boundaries** (network, clock, model API). Verify external state through the real entry path: the shipped CLI, server, or loader, not a hand-assembled object.

## Conventions

- **One home per fact.** State a rule once, in its owning document, and link to it elsewhere ([tiers](docs/AGENTS.md)).
- **Docs describe the current system; notes hold the why.** Rationale and rejected alternatives go in an [Agent Note](.agents/notes/README.md), not in `docs/` or code comments.
- **Write an Agent Note only for non-trivial decisions.** Mechanical and local edits are exempt ([threshold](.agents/notes/README.md)).
- **Extend through registered seams.** New behavior registers with `<registry / plugin point / interface>`; do not add business branches to `<central dispatcher/manager>`.
- **Shared state has one named owner.** No new module-level singletons or global "current/active" state.
- **Keep the change face equal to the review face.** Moves, renames, and formatting land separately from behavior changes.
- **Released formats are append-only.** Add a new version and an adjacent migration; never edit a released schema, migration, or fixture. <!-- Link the versioning policy once it exists: ([policy](docs/<persistence-or-api-versioning>.md)) -->
- **No new legacy violations.** `ratchet-baseline` rejects new findings; fix a finding completely, then `--prune`. Never hand-edit the baseline upward.
- <Stack rule, e.g. "Strict typing: no `any` without a comment explaining why narrowing is infeasible.">
- <Error-handling rule, e.g. "Fail loudly on misconfiguration at load time; never silently skip a missing referent.">

## Before finishing a change

- Run the narrowest check that would fail for this change's regression; CI owns the exhaustive matrix.
- Prove each new or changed guard rejects an invalid case (negative control): break it, watch it fail, revert.
- Update the README, API docs, and owning Agent Note in the same change as the behavior.
- Self-review against the rules above for the area you touched. <!-- Growing team / Scale: add "and [docs/defensive-patterns.md](docs/defensive-patterns.md), [docs/core-guidelines.md](docs/core-guidelines.md)" once those files exist. -->

## Editing these instructions

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md`. Keep each rule self-contained and link its home. When over budget, move detail to its owning document before raising the ceiling.
