# Evolution and the incident-to-guardrail loop

Two mechanisms let a project change for years without breaking what already shipped and without repeating its own mistakes: append-only evolution of released formats, and a closed loop that turns every escaped bug into a permanent guardrail.

## Append-only evolution

Released formats include persisted files, database schemas, wire protocols, public APIs, config files, and recorded test fixtures. Once released, a format version is history that real data depends on.

Rules:

- **Never move, overwrite, or delete a released version.** Add a successor: `v3` next to `v2`, migration `0042` after `0041`, fixture `session.v3.jsonl` beside `session.v2.jsonl`.
- **Migrate adjacently.** Each migration upgrades exactly one version to the next (`v2 → v3`); a reader of `v1` chains `v1 → v2 → v3`. A direct `v1 → v3` path duplicates logic and rots.
- **State what a predecessor implies.** Keeping `v2` readable does not promise downgrade or write support for `v2`; say which guarantees exist.
- **Bump the version only when needed.** If existing discriminators let old readers skip new data safely, a same-version additive change is cheaper; if old readers could misinterpret new data, bump.
- **Databases use a monotonic schema version** and forward-only migrations; never edit an applied migration file.
- **Keep historical fixtures.** Tests replay old-version data through the current reader to prove the migration chain still works.
- **Record each breaking change immediately** in an upgrade guide or changelog entry while the context is fresh.

The decision to evolve (why `v3`, what it replaced, which alternatives lost) is an Agent Note, see [agent-notes.md](agent-notes.md). The format's current schema is a `docs/` fact. The old schema stays in a historical-formats reference.

A CI check enforces append-only: it fails when a file under `migrations/` or `fixtures/released/` that exists at the merge-base is modified or deleted, and when two migrations share a sequence prefix (two parallel branches both added `0042`):

```sh
base=$(git merge-base origin/main HEAD) || exit 2
changes=$(git diff --name-status --no-renames "$base" -- migrations/ fixtures/released/) || exit 2
edited=$(printf '%s\n' "$changes" | grep -v -e '^A' -e '^$' || true)
dupes=$(ls migrations | sed -E 's/^([0-9]+).*/\1/' | sort | uniq -d)
if [ -n "$edited$dupes" ]; then printf 'released files edited:\n%s\nduplicate prefixes:\n%s\n' "$edited" "$dupes"; exit 1; fi
```

[`verify-agent-notes.mjs --base`](../scripts/verify-agent-notes.mjs) applies the same freeze to archived and rejected notes.

## The incident-to-guardrail loop

Tests guard the present; notes guard the future; postmortems connect the two. When a bug escapes to a user, a merged branch, or a release:

```
bug escapes
  → fix it
  → postmortem: mechanism + why every safety net missed it
  → guardrails: test (real entry path) + rule (AGENTS.md / defensive pattern) + gate (if checkable)
  → each guardrail verified red with the bug restored
  → rule links back to the postmortem
```

### When to write a postmortem

All three must hold:

- **Subtle**: the mechanism is non-obvious; a careful engineer would re-derive it the hard way.
- **Systemic**: it escaped through a gap in tests, tooling, or conventions, not a one-off typo.
- **Costly to rediscover**: it cost real debugging time and would again.

Otherwise, fix it with a regression test and move on.

### Structure

Write `docs/postmortem/yyyy-mm-dd-slug.md` (the date the bug was found; dates, unlike sequence numbers, do not collide across parallel branches) from [templates/postmortem.md](../templates/postmortem.md). The non-negotiable parts:

- **Executive summary** first: one paragraph covering what broke, root cause, why it escaped, and the lesson.
- **Timeline including wrong hypotheses** and what falsified them. These save the next investigator the same detour.
- **Why the safety nets missed it**: for each test tier, type check, lint, and review, the specific reason it did not fire. This section is where the guardrails come from.
- **Guardrails added**: each with its path and the statement that it was verified failing with the bug restored.

### What makes a guardrail permanent

| Guardrail | Lives in | Catches |
|---|---|---|
| Regression test through the real entry path | Test suite | This exact bug |
| Rule with a link to the postmortem | `AGENTS.md`, subtree `AGENTS.md`, or defensive patterns | The bug class, at authoring and review time |
| Mechanical gate | Lint rule, ratchet rule, CI script | The bug class, without relying on anyone reading the rule |

A postmortem that ends with "be more careful" has no guardrail. If no gate is possible, say why in the postmortem.

### Example from the source project

DeepSeek Harness postmortem 0001: a plugin's stray `export default` made the loader discard its dependency declaration. 178 unit tests and 100% line coverage were green because they mounted the plugin by hand, bypassing the loader. Guardrails: a keyless end-to-end test that boots the real profile through the real loader (verified red with the export restored), a `packages/AGENTS.md` rule on plugin export forms linking the postmortem, and a `docs/testing.md` rule that line coverage is not behavior coverage.

## Provenance

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) root `AGENTS.md` (adjacent migrations, never overwrite committed generations), `docs/postmortem/README.md`, and `docs/postmortem/0001-acp-default-export-drops-inject.md`.
