<!-- Copy to .github/pull_request_template.md. Delete lines that do not apply; do not answer them with "N/A". -->

## What changes for users or callers

<One paragraph. If nothing observable changes, say "No behavior change" and why the change is needed.>

## Change face

- [ ] This PR carries only the lines its stated change needs (moves, renames, and formatting are in a separate PR or commit).
- [ ] Migrations and released formats are additive: no released schema, migration, or fixture was edited.

## Evidence

- Commands run locally (only the ones actually run):
  - `<focused test or check>`
- Negative control for each new or changed guard: <how you made it fail, then reverted>.
- Performance-sensitive path: <before/after numbers, environment, input size> or "not touched".

## Decision record

- Agent Note: <link to the note this PR adds or updates, or "exempt: mechanical/local change">.
- Docs updated in this PR: <README / architecture / module docs touched, or "none affected">.
