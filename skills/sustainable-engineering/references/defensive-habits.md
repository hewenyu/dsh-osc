# Defensive habits and testing that verifies the world

Five habits cover most of the structural decay that accumulates when many hands, human or agent, optimize locally. Each habit below states the rule, the condition a reviewer checks, and a wrong and right form. Examples use pseudocode-like TypeScript and Python; the habits are language-independent.

Write your project's version as `docs/defensive-patterns.md` (review rules per artifact, each naming the defect it prevents) and `docs/core-guidelines.md` (numbered design rules, cited as "violates G.3" in review).

## 1. Make correctness explicit

Correctness comes from named call points, explicit lifecycles, explicit states, and types, never from where a callback happens to land in time.

- **Reviewer checks:** does correctness depend on "that callback already ran"? Does one `null` mean several things?
- **Wrong:** `setTimeout(() => refresh(), 0)` to wait for a render; `queueMicrotask` to order teardown; `return None` meaning "not loaded", "loaded and empty", and "unknown" at once; `a?.b?.c ?? fallback` hiding whether `c` should exist.
- **Right:** dispose the old store, then create the new one, in written order; a discriminated state `{kind: 'unknown'} | {kind: 'empty'} | {kind: 'value', value}`; an optional parameter whose contract states the behavior when it is absent.
- Report independent outcomes independently: a process can time out and exit 0; expose `timedOut`, `signal`, and `exitCode` separately rather than nesting one inside another's branch.
- Teardown reaches quiescence: await child exit after kill; keep resources needed for final persistence alive until consumers settle.

## 2. Keep one source of truth

One read path for a piece of data, one home for a fact, one named owner for shared state.

- **Reviewer checks:** can you name the object that owns this value and its lifetime?
- **Wrong:** `globalThis.__cache = new Map()`; a module-level `let activeTabId`; a second loader that re-reads config with its own defaults; caches, UI echoes, and prompts each derived from a different copy.
- **Right:** state hangs on a service or instance with a lifecycle; each view carries the key it renders instead of reading a global "current"; notifications and derived views update only after the operation commits, from one authoritative source.

## 3. Extend through registered seams

A new capability registers itself at an extension point. The central runtime, controller, or dispatcher holds the registry and lifecycle, not business rows.

- **Reviewer checks:** does adding this feature edit the center, or register from its own module?
- **Wrong:** `if plugin_name == "attachments": ...` inside the manager; a 40-case `switch` in the router that every feature edits; a central table of business entries.
- **Right:** `registry.register("attachments", handler)` from the attachments module, returning its own disposer; a merge-extensible type the producer extends in its own package.
- Before choosing an owner, establish that the new distinction, option, or adapter is needed at all. Moving an unnecessary concept does not remove its cost.
- Exception: pure infrastructure (logging, transport, storage) does not need a business registration point.
- **No seam yet (strangler).** Introduce the registry with the first new capability, route unknown keys to the legacy chain as an explicitly named fallback, and ratchet-freeze the chain (a rule matching `elif channel ==` in the dispatcher's file) so branch N+1 fails CI. Migrate legacy branches into registrations in later behavior-preserving changes, each with a characterization test through the real entry path. Never rewrite all branches in the feature change.
- **Dependencies point one way.** Each module imports only through another module's public entry, never its internals, and layers never import upward (`ui` → `service` → `store`). Enforce the direction with a boundary gate ([mechanical-enforcement.md](mechanical-enforcement.md#gates-that-matter-by-year-two)), not review memory.

## 4. Keep the change face equal to the review face

A change carries only the lines its stated behavior change needs, so a reviewer can see every behavioral difference.

- **Reviewer checks:** could a behavior change be hiding inside this diff's moves, renames, or reformatting?
- **Wrong:** a "move module" PR that also upgrades error handling; a refactor bundled with a fix; drive-by reformatting of untouched files.
- **Right:** move code verbatim in one change (`git mv` plus import updates), change behavior in the next; list every observable difference (error codes, ordering, timing) when a rewrite is unavoidable.
- Performance-sensitive changes carry before/after numbers for the touched path (runtime, peak and steady memory), same environment and input. "The overall benchmark is green" is not evidence.

## 5. Require falsifiable evidence

A claim is checked by something that would fail if it were false: a measurement, a gate, or a test through the real entry path.

- **Reviewer checks:** would this test fail if the feature were broken in production?
- Testing rules that follow:
  - **Verify the world, not the self-report.** Re-read the file, re-run the command, query the database. An assertion on an agent's or function's own "success" message passes when it lies. Assert untouched files are byte-identical.
  - **Test the real entry path.** The shipped binary, CLI, HTTP route, plugin loader, or built artifact, not a hand-assembled object graph. 100% line coverage with hand-mounted components can coexist with a product that crashes on first use.
  - **Prefer real implementations over mocks.** Mock only the expensive or nondeterministic boundary (network, model API, clock); keep everything downstream real.
  - **Negative controls** for every guard (see [mechanical-enforcement.md](mechanical-enforcement.md)).
  - **Tests own their resources.** Allocate ports, temp paths, and child processes per test and release them in teardown; a test that passes only when run alone is a defect in the test.
  - **Coverage is necessary, never sufficient.** An uncovered line is often dead code to delete, not a test to bolt on.
  - **A flaky test is a defect.** Fix it, or quarantine it in a named list with an owner and an expiry date that CI enforces. Never mask it with automatic retries; a retried pass hides the race the test exists to catch.
- **One library per capability.** A new direct dependency names the capability it covers and why the existing dependency cannot; a second HTTP client, validation library, or date library needs an Agent Note, because two owners of one job drift like two copies of one fact.

## Boundary validation

Validate at real boundaries: config files, user input, network and wire formats, files on disk, process and worker messages, model or tool JSON. Inside one typed process, trust the type system; do not add runtime checks, fallbacks, or hostile-input tests for values the static interface already guarantees. Defensive code without a current consumer is its own form of decay.

## Provenance

The five habits are taken from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `docs/defensive-patterns/README.md`; the examples generalize `docs/defensive-patterns/general.md`, `packages/AGENTS.md`, and `docs/testing.md`.
