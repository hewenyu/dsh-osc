# Postmortem: <What broke, in one line>

<!-- Copy to docs/postmortem/yyyy-mm-dd-short-slug.md (the date the incident was found; dates do not collide across parallel branches the way sequential numbers do). Write one when a bug is subtle, systemic (it escaped through a gap in tests, tooling, or conventions), and costly to rediscover. Delete this comment. -->

Status: resolved (<PR or commit reference>)

## Executive summary

<One paragraph a reader absorbs in thirty seconds: what broke, the root cause in plain terms, why every safety net missed it, and the durable lesson.>

## Impact

<Who or what was affected, for how long, and what it cost (data, users, debugging time).>

## Timeline

- <Event, with the evidence that established it.>
- <Including wrong hypotheses and what falsified them.>

## Root cause

<The mechanism, precise enough that a careful engineer would not have to re-derive it. Quote the code or config that caused it.>

## Why the safety nets missed it

<For each net that should have caught this (unit tests, integration tests, types, lint, review, staging), the specific reason it did not. This section is the point of the document.>

## Guardrails added

Each entry is permanent and fails loudly on recurrence:

- **Test:** <path> — reproduces the failure through the real entry path. Verified red with the bug restored, green with the fix.
- **Rule:** <AGENTS.md or defensive-patterns line> — links back to this postmortem.
- **Gate:** <lint rule, ratchet rule, CI check> — or why the class cannot be checked mechanically.

## Lessons

<The generalizable rule, if any, and where it now lives.>
