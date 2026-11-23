# Agent Note: Count CJK characters as words in documentation budgets

Status: implemented

## Problem

`wc -w` counts whitespace-delimited tokens. Chinese and Japanese text has no spaces between words, so a 3,000-character Chinese `AGENTS.md` counts as a few dozen words and never reaches any ceiling. This skill targets Chinese and international developers, so budgets that only work for English would silently exempt half of its audience.

## Decision

`verify-doc-budgets.mjs` counts whitespace-delimited tokens after replacing each Han, Hiragana, or Katakana character with a separate token, and ignores tokens made only of CJK or full-width punctuation. For text without CJK characters, the count equals `wc -w`. Hangul is not split because Korean separates words with spaces.

## Alternatives considered

- **Plain `wc -w` semantics, as in DeepSeek Harness.** Rejected: Chinese documents would be effectively unbudgeted.
- **Character-count budgets for every language.** Rejected: English ceilings would no longer be comparable to the `wc -w` numbers teams already know.
- **A per-file `"unit": "chars"` option in the manifest.** Rejected: mixed-language documents (Chinese prose with English code and identifiers) need both rules at once, and an option adds a choice every adopter must understand.

## Consequences

- One manifest budgets English, Chinese, Japanese, and mixed documents with the same rule.
- Ceilings for Chinese documents are numerically larger than their `wc -w` output; `--list` shows the counts this script uses.
