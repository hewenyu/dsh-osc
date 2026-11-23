# Mechanical enforcement: gates, ratchets, and negative controls

A rule that only lives in prose is followed until the first busy week or the first agent that did not load it. A rule wired into an executed check holds regardless of who or what writes the code.

## From review comment to gate

When the same review comment appears a second time, promote it. Agents do not remember the first time, so give the count a home: a `recurring-review` label, or a line in a `process` note.

1. **Write the rule once** in its home (`AGENTS.md` line, defensive pattern, or core guideline) with the defect it prevents.
2. **Ask whether it is mechanically checkable.** Prefer, in order: the type system or compiler; an existing linter rule; a small project script; a test that exercises the real entry path. Judgment-only rules stay in review checklists.
3. **Wire the check into an executed aggregate** (CI job, `make check`, `npm run check`). A script nobody runs is prose with extra steps.
4. **Prove it with a negative control** (below).
5. **If legacy code violates it, ratchet** (below) instead of fixing everything first or exempting whole directories.
6. **Allow narrow, named exceptions** (an exemption list with a reason per entry), never a global disable.

### Semantic bug classes: one owner, ratchet the raw call

A regex cannot prove that a `kill()` is followed by an awaited exit. Make the class structural: one named owner performs the operation correctly (`terminateProcessAndWait(child, deadline)`), its tests prove the semantics through the real entry path, and a ratchet rule bans the raw primitive (`\.kill\(`) outside that owner's file.

## The ratchet baseline

A new rule with 300 existing violations cannot wait for every fix. The ratchet records existing violations exactly, rejects every new one, and lets the record only shrink. [`ratchet-baseline.mjs`](../scripts/ratchet-baseline.mjs) implements it; `--help` lists every option, and [templates/ratchet.config.json](../templates/ratchet.config.json) has TypeScript, Python, Rust, and multi-language examples.

- **Fingerprint each finding**, not each file: path plus a hash of the normalized matched text, with a count. A file with three legacy violations does not get permission for a fourth.
- **Stable under whitespace.** Indentation and whitespace-run changes within a line, and moving lines within a file, keep the fingerprint; other reformatting does not. Editing the violating line makes it a new finding: fix it completely.
- **Moves keep their allowance.** After `git mv`, or extracting legacy lines into a new file, `--prune --base <ref>` carries each allowance to the file the change adds or renames. Per-fingerprint totals never grow, and one extra finding still fails.
- **Stale entries fail** until `--prune` removes them in the same change, so the baseline cannot hide a later regression.
- **Every configured rule is recorded**, even with zero findings, so a rule cannot ship unrecorded and adopt new debt later. A rule that scans zero files is an error unless marked `"allowEmpty": true`. A retired rule stays as a tombstone with its reason.
- **No command adds allowances, and `--base` makes that mechanical.** Against the merge-base of the base branch, CI fails when a recorded rule gains a fingerprint or count, leaves the config or baseline, changes its pattern, loses an include glob, or gains an exclude glob. [templates/CODEOWNERS](../templates/CODEOWNERS) puts the checker itself under owner review.

```sh
node scripts/governance/ratchet-baseline.mjs --init                    # once, when adopting
node scripts/governance/ratchet-baseline.mjs --base origin/main        # every CI run and pre-push
node scripts/governance/ratchet-baseline.mjs --prune --base origin/main  # when fixing or moving legacy findings
node scripts/governance/ratchet-baseline.mjs --list                    # remaining debt and scanned-file counts
```

Scanners behind the same contract:

- **`"multiline": true`** matches the whole file, for patterns such as Python `except Exception:` followed by `pass`, or an empty `catch (e) {}` split across lines.
- **`mustMatch` / `mustNotMatch`** samples run on every invocation, so an edited pattern that stops matching fails with exit 2.
- **`--findings <json>`** ratchets any linter's output for rules declared `"external": true`; each entry is `{rule, file, text}` or `{rule, file, line}`: `ruff check --select S110 --output-format=json . | jq '[.[] | {rule: "ruff-s110", file: .filename, line: .location.row}]'`. Prefer this over a regex wherever a parser-based linter already has the rule.

Per-line regex is the default; regex rules also match inside strings and comments. Good candidates: type escapes, unchecked errors, global state, empty `catch` blocks, deprecated calls, lint-disable comments.

## Gates that matter by year two

- **Dependency direction.** Enforce module boundaries with dependency-cruiser or eslint-plugin-boundaries (TypeScript), import-linter (Python), Go `internal/` packages, or Rust crate visibility, each proven with one forbidden import.
- **Split hot baselines.** With many parallel branches, keep one ratchet config and baseline per package (`--config`) so unrelated changes do not conflict on one file.

## Generated artifacts: generate plus `--check`

Anything derivable from source (API tables, config catalogs, CLI help, schema docs) is generated, committed, and freshness-checked:

```sh
<generator> --check            # preferred: render in memory and compare
<generator> && git diff --exit-code -- <out> && test -z "$(git status --porcelain -- <out>)"   # fallback: also catches untracked output
```

## Fast local hooks, exhaustive CI

| Layer | Runs | Purpose | Budget |
|---|---|---|---|
| pre-commit | Staged-file lint/format, whitespace | Keep commits clean | Seconds |
| pre-push | One incremental whole-repo check (typecheck, ratchet) | Catch the common break before CI | Under a minute |
| Local, by judgment | The narrowest test that fails on this change's regression | Evidence | Minutes |
| CI | Every gate, full test matrix, coverage, platforms, build | Exhaustive authority | Whatever it takes |

- **Hooks stay fast.** A slow hook gets bypassed with `--no-verify`. Start from [templates/lefthook.yml](../templates/lefthook.yml).
- **Focused local evidence.** Select checks from the changed paths (`git diff --name-only <base>...`). Do not run the full suite by reflex.
- **CI owns exhaustiveness.** [templates/github-actions-governance.yml](../templates/github-actions-governance.yml) wires these scripts with `--base`; add your stack's gates beside them.

## Negative controls: prove the guard fails

A check never seen failing may not check anything: a wrong glob or an always-true assertion looks green. For every new or changed check or test:

1. Introduce the exact regression it exists to catch.
2. Run the real runner and watch it fail for the expected reason.
3. Revert and watch it pass.

Keep a permanent negative-control test where the check is code.

- **Fail on an impossible empty scan.** Assert that a gate found files, so a narrowed glob cannot silently pass. Mandatory regex rules and the Markdown link scan exit 2 when they match no files; an empty notes tree and an empty `--findings []` are allowed, so the linter feeding `--findings` owns its own coverage.
- **Fail loudly on misconfiguration.** A missing config or manifest is exit 2, not a pass.

## Provenance

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `scripts/baseline-inventory.ts` (fingerprint inventory, `--prune`, no add command), `scripts/run-gates.ts`, `lefthook.yml`, and `docs/testing.md` ("a guard only guards if the regression fails it").
