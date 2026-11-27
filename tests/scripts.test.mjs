/**
 * Behavior tests for the skill's governance scripts. Every script gets a passing case and a
 * deliberately invalid negative control, run as a real subprocess in a private temp directory
 * that is removed afterwards. Run with `node --test tests/`.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = resolve(REPO, 'skills/sustainable-engineering/scripts')
const TEMPLATES = resolve(SCRIPTS, '../templates')
const TIMEOUT = 30_000

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sustainable-engineering-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function write(root, path, content) {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}

const read = (root, path) => readFileSync(join(root, path), 'utf8')
const fingerprint = (ruleId, text) => createHash('sha256').update(`${ruleId}\0${text.trim().replace(/\s+/gu, ' ')}`).digest('hex').slice(0, 16)

function run(script, args, cwd, env = process.env) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd, encoding: 'utf8', timeout: TIMEOUT, env })
  assert.equal(result.error, undefined, `${script} did not finish: ${result.error?.message}`)
  return { code: result.status, out: result.stdout, err: result.stderr }
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', timeout: TIMEOUT })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function commitAll(dir, message = 'commit') {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '--allow-empty', '-m', message)
}

const SCRIPT_NAMES = ['verify-doc-budgets.mjs', 'verify-agent-notes.mjs', 'ratchet-baseline.mjs', 'verify-md-links.mjs']

describe('every script', () => {
  for (const script of SCRIPT_NAMES) {
    it(`${script} prints --help with exit 0 and rejects unknown flags with exit 2`, (t) => {
      const dir = sandbox(t)
      const help = run(script, ['--help'], dir)
      assert.equal(help.code, 0)
      assert.match(help.out, /^Usage: /u)
      assert.match(help.out, /Exit codes:/u)
      const bad = run(script, ['--definitely-not-a-flag'], dir)
      assert.equal(bad.code, 2)
      assert.match(bad.err, /unknown argument/u)
    })

    it(`${script} carries the version header and prints it with --version`, (t) => {
      const dir = sandbox(t)
      assert.equal(readFileSync(join(SCRIPTS, script), 'utf8').split('\n')[1], '// sustainable-engineering v1.0.0')
      const version = run(script, ['--version'], dir)
      assert.equal(version.code, 0)
      assert.match(version.out, /\(sustainable-engineering\) 1\.0\.0/u)
    })
  }
})

describe('verify-doc-budgets', () => {
  const MANIFEST = 'scripts/governance/doc-budgets.manifest.json'
  const manifest = (dir, value) => write(dir, MANIFEST, JSON.stringify(value))

  it('passes when every budgeted document is within its ceiling', (t) => {
    const dir = sandbox(t)
    write(dir, 'AGENTS.md', 'one two three four five\n')
    manifest(dir, { '// note': 'comment keys are ignored', 'AGENTS.md': 5 })
    const result = run('verify-doc-budgets.mjs', [], dir)
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /1 budgeted document\(s\) within ceiling/u)
  })

  it('negative control: fails when a document exceeds its ceiling', (t) => {
    const dir = sandbox(t)
    write(dir, 'AGENTS.md', 'one two three four five six\n')
    manifest(dir, { 'AGENTS.md': 5 })
    const result = run('verify-doc-budgets.mjs', [], dir)
    assert.equal(result.code, 1)
    assert.match(result.err, /AGENTS\.md: 6 words exceeds the 5-word ceiling/u)
  })

  it('negative control: fails when a budgeted document is missing', (t) => {
    const dir = sandbox(t)
    manifest(dir, { 'docs/architecture.md': 100 })
    const result = run('verify-doc-budgets.mjs', [], dir)
    assert.equal(result.code, 1)
    assert.match(result.err, /does not exist/u)
  })

  it('counts each CJK character as a word so Chinese docs are budgeted', (t) => {
    const dir = sandbox(t)
    write(dir, 'README.md', '中文文档，七个字。 ok\n')
    manifest(dir, { 'README.md': 8 })
    assert.equal(run('verify-doc-budgets.mjs', [], dir).code, 0, '7 Han characters + 1 token; CJK punctuation is not a word')
    manifest(dir, { 'README.md': 7 })
    const over = run('verify-doc-budgets.mjs', [], dir)
    assert.equal(over.code, 1)
    assert.match(over.err, /8 words exceeds the 7-word ceiling/u)
  })

  it('rejects invalid ceilings and escaping paths with exit 2; --list always exits 0', (t) => {
    const dir = sandbox(t)
    write(dir, 'AGENTS.md', 'a b c\n')
    manifest(dir, { 'AGENTS.md': 0 })
    assert.equal(run('verify-doc-budgets.mjs', [], dir).code, 2)
    manifest(dir, { '../outside.md': 10 })
    assert.equal(run('verify-doc-budgets.mjs', [], dir).code, 2)
    manifest(dir, { 'AGENTS.md': 1 })
    const list = run('verify-doc-budgets.mjs', ['--list'], dir)
    assert.equal(list.code, 0)
    assert.match(list.out, /OVER\s+3 \/ 1/u)
  })

  it('turns filesystem errors into exit 2 instead of a stack trace', (t) => {
    const dir = sandbox(t)
    mkdirSync(join(dir, MANIFEST), { recursive: true })
    const result = run('verify-doc-budgets.mjs', [], dir)
    assert.equal(result.code, 2)
    assert.match(result.err, /cannot read manifest/u)
    assert.doesNotMatch(result.err, /\n\s+at /u)
  })

  it('accepts the shipped manifest template once the listed files exist', (t) => {
    const dir = sandbox(t)
    const template = JSON.parse(readFileSync(join(TEMPLATES, 'doc-budgets.manifest.json'), 'utf8'))
    for (const path of Object.keys(template).filter(key => !key.startsWith('//') && !key.startsWith('$'))) write(dir, path, 'short\n')
    write(dir, MANIFEST, JSON.stringify(template))
    assert.equal(run('verify-doc-budgets.mjs', [], dir).code, 0)
  })

  describe('--base ceiling guard', () => {
    const seeded = (t) => {
      const dir = sandbox(t)
      write(dir, 'AGENTS.md', 'one two three\n')
      write(dir, 'docs/architecture.md', 'one two\n')
      manifest(dir, { 'AGENTS.md': 10, 'docs/architecture.md': 10 })
      git(dir, 'init', '-q')
      commitAll(dir, 'seed')
      return dir
    }

    it('passes an unchanged or lowered ceiling', (t) => {
      const dir = seeded(t)
      assert.equal(run('verify-doc-budgets.mjs', ['--base', 'HEAD'], dir).code, 0)
      manifest(dir, { 'AGENTS.md': 8, 'docs/architecture.md': 10 })
      const lowered = run('verify-doc-budgets.mjs', ['--base', 'HEAD'], dir)
      assert.equal(lowered.code, 0, lowered.err)
    })

    it('negative control: a raised ceiling fails unless --allow-ceiling-change', (t) => {
      const dir = seeded(t)
      manifest(dir, { 'AGENTS.md': 20, 'docs/architecture.md': 10 })
      assert.equal(run('verify-doc-budgets.mjs', [], dir).code, 0, 'without --base nothing compares ceilings')
      const raised = run('verify-doc-budgets.mjs', ['--base', 'HEAD'], dir)
      assert.equal(raised.code, 1)
      assert.match(raised.err, /AGENTS\.md: ceiling rose from 10 to 20/u)
      const allowed = run('verify-doc-budgets.mjs', ['--base', 'HEAD', '--allow-ceiling-change'], dir)
      assert.equal(allowed.code, 0, allowed.err)
      assert.match(allowed.out, /ceiling rose from 10 to 20/u)
    })

    it('negative control: removing a budgeted entry fails', (t) => {
      const dir = seeded(t)
      manifest(dir, { 'AGENTS.md': 10 })
      const removed = run('verify-doc-budgets.mjs', ['--base', 'HEAD'], dir)
      assert.equal(removed.code, 1)
      assert.match(removed.err, /docs\/architecture\.md: budgeted at 10 .* removes its entry/u)
    })

    it('compares with the merge-base, so a stale branch is not blamed for later base commits', (t) => {
      const dir = seeded(t)
      git(dir, 'checkout', '-q', '-b', 'topic')
      git(dir, 'checkout', '-q', 'main')
      manifest(dir, { 'AGENTS.md': 5, 'docs/architecture.md': 10 })
      commitAll(dir, 'main tightens AGENTS.md')
      git(dir, 'checkout', '-q', 'topic')
      const result = run('verify-doc-budgets.mjs', ['--base', 'main'], dir)
      assert.equal(result.code, 0, result.err)
    })

    it('rejects option-shaped refs, unknown refs, and a missing Git work tree with exit 2', (t) => {
      const dir = seeded(t)
      assert.equal(run('verify-doc-budgets.mjs', ['--base', '--cached'], dir).code, 2)
      assert.equal(run('verify-doc-budgets.mjs', ['--base', 'no-such-ref'], dir).code, 2)
      assert.equal(run('verify-doc-budgets.mjs', ['--allow-ceiling-change'], dir).code, 2)
      const plain = sandbox(t)
      write(plain, 'AGENTS.md', 'x\n')
      manifest(plain, { 'AGENTS.md': 10 })
      const result = run('verify-doc-budgets.mjs', ['--base', 'HEAD'], plain)
      assert.equal(result.code, 2)
      assert.match(result.err, /not one|Git work tree/u)
    })
  })
})

const NOTES = '.agents/notes'
const implemented = (title = 'Use one config loader') => `# Agent Note: ${title}

Status: implemented

## Problem

Two loaders disagreed on defaults.

## Decision

\`config/load\` is the only loader.

## Alternatives considered

- **Keep both loaders.** Rejected: defaults drift.

## Consequences

One read path for configuration.
`
const archivedNote = (title, date = '2026-01-10') => implemented(title).replace('Status: implemented\n', `Status: implemented\nArchived: ${date}\n`)
const proposed = `# Agent Note: Split the worker pool

Status: proposed

## Problem

Jobs starve.

## Proposal

Split the pool by job class.

## Alternatives considered

- **Raise the pool size.** Rejected: starvation is about ordering, not capacity.

## Acceptance criteria

Short jobs finish within 1s under load.

## Risks

More configuration.
`
const rejectedNote = proposed
  .replace('Status: proposed', 'Status: rejected — the shared release train outweighs build time')
  .replace('Split the worker pool', 'Split the monorepo')

function notesTree(dir) {
  write(dir, `${NOTES}/README.md`, '# Agent Notes\n')
  write(dir, `${NOTES}/implemented/architecture/2026-01-05-one-config-loader.md`, implemented())
  write(dir, `${NOTES}/implemented/architecture/2026-01-05-one-config-loader.zh.md`, '# Agent Note: 统一配置加载\n')
  write(dir, `${NOTES}/proposed/feature/2026-02-01-split-worker-pool.md`, proposed)
  write(dir, `${NOTES}/rejected/process/2026-02-02-monorepo-split.md`, rejectedNote)
}

describe('verify-agent-notes', () => {
  it('passes a valid tree with proposed, implemented, rejected, and a translation', (t) => {
    const dir = sandbox(t)
    notesTree(dir)
    const result = run('verify-agent-notes.mjs', [], dir)
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /3 note\(s\) valid/u)
  })

  it('accepts the shipped note templates', (t) => {
    const dir = sandbox(t)
    for (const lifecycle of ['proposed', 'implemented', 'rejected']) {
      const text = readFileSync(join(TEMPLATES, `agent-note-${lifecycle}.md`), 'utf8')
      write(dir, `${NOTES}/${lifecycle}/process/2026-03-01-template-check.md`, text)
    }
    const result = run('verify-agent-notes.mjs', [], dir)
    assert.equal(result.code, 0, result.err)
  })

  it('accepts any-language section bodies under English headings', (t) => {
    const dir = sandbox(t)
    notesTree(dir)
    write(dir, `${NOTES}/implemented/process/2026-01-08-chinese-body.md`, implemented('中文正文').replace('Two loaders disagreed on defaults.', '两个加载器的默认值不一致。'))
    assert.equal(run('verify-agent-notes.mjs', [], dir).code, 0)
  })

  const hollow = (section, body) => implemented().replace(new RegExp(`(## ${section}\\n\\n)[^\\n]*\\n`, 'u'), `$1${body}\n`)
  const negatives = [
    ['a missing Alternatives considered section', d => write(d, `${NOTES}/implemented/process/2026-01-06-no-alts.md`, implemented().replace(/## Alternatives considered\n\n.*\n\n/u, '')), /missing required section "## Alternatives considered"/u],
    ['an empty Alternatives considered section', d => write(d, `${NOTES}/implemented/process/2026-01-06-empty-alts.md`, implemented().replace(/(## Alternatives considered\n\n).*\n/u, '$1')), /"## Alternatives considered" is empty/u],
    ['an empty Decision section', d => write(d, `${NOTES}/implemented/process/2026-01-06-empty-decision.md`, hollow('Decision', '')), /"## Decision" is empty/u],
    ['an empty Consequences section', d => write(d, `${NOTES}/implemented/process/2026-01-06-empty-consequences.md`, implemented().replace(/(## Consequences\n\n).*\n/u, '$1')), /"## Consequences" is empty/u],
    ['an Alternatives section holding only "- TBD"', d => write(d, `${NOTES}/implemented/process/2026-01-06-tbd-alts.md`, hollow('Alternatives considered', '- TBD')), /"## Alternatives considered" holds only a placeholder/u],
    ['a Problem section holding only "TODO:"', d => write(d, `${NOTES}/implemented/process/2026-01-06-todo-problem.md`, hollow('Problem', 'TODO:')), /"## Problem" holds only a placeholder/u],
    ['an Alternatives section holding only an HTML comment', d => write(d, `${NOTES}/implemented/process/2026-01-06-comment-alts.md`, hollow('Alternatives considered', '<!-- TODO alternatives -->')), /"## Alternatives considered" is empty/u],
    ['a proposed Risks section hidden in a multi-line comment', d => write(d, `${NOTES}/proposed/process/2026-01-06-hidden-risks.md`, proposed.replace('More configuration.', '<!--\nMore configuration.\n-->')), /"## Risks" is empty/u],
    ['a centralized INDEX.md', d => write(d, `${NOTES}/INDEX.md`, '# Index\n'), /centralized index files are banned/u],
    ['a Status line that disagrees with the folder', d => write(d, `${NOTES}/implemented/process/2026-01-06-wrong-status.md`, implemented().replace('Status: implemented', 'Status: proposed')), /line 3 must be "Status: implemented"/u],
    ['plan language in an implemented note', d => write(d, `${NOTES}/implemented/process/2026-01-06-spec-speak.md`, `${implemented()}\n## Migration plan\n\nStep 1.\n`), /"## Migration plan".*plan language/u],
    ['a rejected note without a reason', d => write(d, `${NOTES}/rejected/process/2026-01-06-no-reason.md`, proposed.replace('Status: proposed', 'Status: rejected')), /Status: rejected — <one-line reason>/u],
    ['a filename without a date', d => write(d, `${NOTES}/implemented/process/one-config-loader.md`, implemented()), /filename must be yyyy-mm-dd/u],
    ['an impossible date', d => write(d, `${NOTES}/implemented/process/2026-02-30-bad-date.md`, implemented()), /not a real date/u],
    ['an impossible Archived date', d => write(d, `${NOTES}/archived/process/2026-01-06-bad-archive.md`, archivedNote('Bad archive', '9999-99-99')), /9999-99-99 is not a real, non-future archive date/u],
    ['a .markdown file where notes live', d => write(d, `${NOTES}/implemented/process/2026-01-06-other-extension.markdown`, implemented()), /notes use the \.md extension/u],
    ['an unknown class folder', d => write(d, `${NOTES}/implemented/misc/2026-01-06-x.md`, implemented()), /unknown class folder/u],
    ['a note outside {lifecycle}/{class}/', d => write(d, `${NOTES}/implemented/2026-01-06-flat.md`, implemented()), /one level deeper/u],
    ['a translation without its primary note', d => write(d, `${NOTES}/implemented/process/2026-01-06-orphan.zh.md`, '# x\n'), /has no primary note/u],
    ['a body that does not open with Problem', d => write(d, `${NOTES}/implemented/process/2026-01-06-no-problem.md`, implemented().replace('## Problem', '## Context')), /must open with "## Problem"/u],
  ]
  for (const [name, mutate, expected] of negatives) {
    it(`negative control: rejects ${name}`, (t) => {
      const dir = sandbox(t)
      notesTree(dir)
      mutate(dir)
      const result = run('verify-agent-notes.mjs', [], dir)
      assert.equal(result.code, 1, result.out)
      assert.match(result.err, expected)
    })
  }

  it('ignores headings inside fenced code blocks and keeps prose beside an inline comment', (t) => {
    const dir = sandbox(t)
    notesTree(dir)
    write(dir, `${NOTES}/implemented/process/2026-01-07-fenced.md`, implemented().replace('## Consequences', '```markdown\n## Plan\nStatus: proposed\n```\n\n## Consequences'))
    write(dir, `${NOTES}/implemented/process/2026-01-07-inline-comment.md`, hollow('Decision', '<!-- reviewer: keep --> `config/load` is the only loader.'))
    const result = run('verify-agent-notes.mjs', [], dir)
    assert.equal(result.code, 0, result.err)
  })

  describe('--base', () => {
    const ARCHIVED = `${NOTES}/archived/architecture/2025-12-01-old-cache.md`
    const REJECTED = `${NOTES}/rejected/process/2026-02-02-monorepo-split.md`
    const seeded = (t) => {
      const dir = sandbox(t)
      notesTree(dir)
      write(dir, ARCHIVED, archivedNote('Old cache'))
      git(dir, 'init', '-q')
      commitAll(dir, 'seed')
      return dir
    }

    it('freezes archived notes: additions pass, edits and deletions fail', (t) => {
      const dir = seeded(t)
      write(dir, `${NOTES}/archived/process/2025-11-01-new-archive.md`, archivedNote('New archive', '2026-01-11'))
      const added = run('verify-agent-notes.mjs', ['--base', 'HEAD'], dir)
      assert.equal(added.code, 0, added.err)
      write(dir, ARCHIVED, `${read(dir, ARCHIVED)}\nEdited later.\n`)
      const edited = run('verify-agent-notes.mjs', ['--base', 'HEAD'], dir)
      assert.equal(edited.code, 1)
      assert.match(edited.err, /archived notes are frozen/u)
      unlinkSync(join(dir, ARCHIVED))
      const deleted = run('verify-agent-notes.mjs', ['--base', 'HEAD'], dir)
      assert.equal(deleted.code, 1)
      assert.match(deleted.err, /deletes it/u)
    })

    it('freezes rejected notes: additions and deletions pass, edits fail', (t) => {
      const dir = seeded(t)
      write(dir, `${NOTES}/rejected/process/2026-02-03-another-rejection.md`, rejectedNote.replace('Split the monorepo', 'Rewrite in Rust'))
      assert.equal(run('verify-agent-notes.mjs', ['--base', 'HEAD'], dir).code, 0)
      write(dir, REJECTED, rejectedNote.replace('Split the pool by job class.', 'Split the pool by job class, now with sharding.'))
      const edited = run('verify-agent-notes.mjs', ['--base', 'HEAD'], dir)
      assert.equal(edited.code, 1)
      assert.match(edited.err, /rejected notes are frozen proposals/u)
      unlinkSync(join(dir, REJECTED))
      const deleted = run('verify-agent-notes.mjs', ['--base', 'HEAD'], dir)
      assert.equal(deleted.code, 0, deleted.err)
    })

    it('compares with the merge-base: a stale branch passes after main archives a note', (t) => {
      const dir = seeded(t)
      git(dir, 'checkout', '-q', '-b', 'topic')
      write(dir, `${NOTES}/implemented/process/2026-01-09-topic-work.md`, implemented('Topic work'))
      commitAll(dir, 'topic work')
      git(dir, 'checkout', '-q', 'main')
      git(dir, 'mv', `${NOTES}/implemented/architecture/2026-01-05-one-config-loader.md`, `${NOTES}/archived/architecture/2026-01-05-one-config-loader.md`)
      write(dir, `${NOTES}/archived/architecture/2026-01-05-one-config-loader.md`, archivedNote('Use one config loader', '2026-02-10'))
      unlinkSync(join(dir, `${NOTES}/implemented/architecture/2026-01-05-one-config-loader.zh.md`))
      commitAll(dir, 'main archives a note')
      git(dir, 'checkout', '-q', 'topic')
      const result = run('verify-agent-notes.mjs', ['--base', 'main'], dir)
      assert.equal(result.code, 0, result.err)
    })

    it('negative control: option-shaped and unknown refs exit 2 (--base --cached cannot hide an edit)', (t) => {
      const dir = seeded(t)
      write(dir, ARCHIVED, `${read(dir, ARCHIVED)}\nEdited later.\n`)
      const option = run('verify-agent-notes.mjs', ['--base', '--cached'], dir)
      assert.equal(option.code, 2)
      assert.match(option.err, /not an option/u)
      assert.equal(run('verify-agent-notes.mjs', ['--base', 'no-such-ref'], dir).code, 2)
    })
  })

  it('exits 2 when the notes directory is missing', (t) => {
    const dir = sandbox(t)
    assert.equal(run('verify-agent-notes.mjs', [], dir).code, 2)
  })
})

describe('ratchet-baseline', () => {
  const CONFIG_PATH = 'scripts/governance/ratchet.config.json'
  const BASELINE = 'scripts/governance/ratchet.baseline.json'
  const CONFIG = {
    baseline: BASELINE,
    exclude: ['vendor/**'],
    rules: [{ id: 'no-any-cast', pattern: '\\bas\\s+any\\b', include: ['src/**/*.ts'], exclude: ['**/*.d.ts'], message: 'no as any' }],
  }
  const config = (dir, value) => write(dir, CONFIG_PATH, JSON.stringify(value, null, 2))
  const baseline = dir => JSON.parse(read(dir, BASELINE))
  const setup = (t, value = CONFIG) => {
    const dir = sandbox(t)
    config(dir, value)
    write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\nconst z = w as any\n')
    write(dir, 'src/types.d.ts', 'declare const q: any; const r = q as any\n')
    write(dir, 'vendor/lib.ts', 'const v = u as any\n')
    return dir
  }
  const adopted = (t, value = CONFIG) => {
    const dir = setup(t, value)
    assert.equal(run('ratchet-baseline.mjs', ['--init'], dir).code, 0)
    git(dir, 'init', '-q')
    commitAll(dir, 'adopt the ratchet')
    return dir
  }

  it('--init freezes legacy findings and the check then passes', (t) => {
    const dir = setup(t)
    const init = run('ratchet-baseline.mjs', ['--init'], dir)
    assert.equal(init.code, 0, init.err)
    assert.match(init.out, /recorded 2 existing finding/u)
    assert.deepEqual(Object.keys(baseline(dir)['no-any-cast']), ['src/a.ts'])
    const check = run('ratchet-baseline.mjs', [], dir)
    assert.equal(check.code, 0, check.err)
  })

  it('keeps an allowance when a legacy line is re-indented or moved within its file', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    write(dir, 'src/a.ts', 'const ok = 1\nconst z =   w as any\n\n    const x = y as any\n')
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
  })

  it('negative control: a new finding fails, even in a file that already has allowances', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\nconst z = w as any\nconst n = m as any\n')
    const result = run('ratchet-baseline.mjs', [], dir)
    assert.equal(result.code, 1)
    assert.match(result.err, /src\/a\.ts:4\s+\[no-any-cast\]/u)
  })

  it('negative control: duplicating an allowed line is a new finding (counts are exact)', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    write(dir, 'src/a.ts', 'const x = y as any\nconst x = y as any\nconst z = w as any\n')
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 1)
  })

  it('a fixed finding blocks the check until --prune ratchets the baseline down', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\nconst z = w as unknown as number\n')
    const stale = run('ratchet-baseline.mjs', [], dir)
    assert.equal(stale.code, 1)
    assert.match(stale.err, /no longer exist.*--prune/su)
    const prune = run('ratchet-baseline.mjs', ['--prune'], dir)
    assert.equal(prune.code, 0, prune.err)
    assert.match(prune.out, /1 recorded finding\(s\) remain/u)
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
  })

  it('negative control: --prune refuses while a new finding exists and leaves the baseline untouched', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    const before = read(dir, BASELINE)
    write(dir, 'src/b.ts', 'const k = j as any\n')
    const prune = run('ratchet-baseline.mjs', ['--prune'], dir)
    assert.equal(prune.code, 1)
    assert.match(prune.err, /--prune refused/u)
    assert.equal(read(dir, BASELINE), before)
  })

  it('negative control: there is no way to re-init over an existing baseline', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    write(dir, 'src/b.ts', 'const k = j as any\n')
    const reinit = run('ratchet-baseline.mjs', ['--init'], dir)
    assert.equal(reinit.code, 2)
    assert.match(reinit.err, /No command adds allowances/u)
    const reinitRule = run('ratchet-baseline.mjs', ['--init-rule', 'no-any-cast'], dir)
    assert.equal(reinitRule.code, 2)
  })

  it('--init-rule records a newly adopted rule once', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    write(dir, 'src/c.ts', '// TODO fix me\n')
    const value = structuredClone(CONFIG)
    value.rules.push({ id: 'no-bare-todo', pattern: 'TODO(?!\\()', include: ['src/**'] })
    config(dir, value)
    const before = run('ratchet-baseline.mjs', [], dir)
    assert.equal(before.code, 1)
    assert.match(before.err, /--init-rule no-bare-todo/u)
    assert.equal(run('ratchet-baseline.mjs', ['--init-rule', 'no-bare-todo'], dir).code, 0)
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
  })

  it('negative control: a configured rule with zero findings still must be recorded', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    const value = structuredClone(CONFIG)
    value.rules.push({ id: 'no-eval', pattern: '\\beval\\(', include: ['src/**/*.ts'] })
    config(dir, value)
    const check = run('ratchet-baseline.mjs', [], dir)
    assert.equal(check.code, 1)
    assert.match(check.err, /no-eval is configured but not recorded/u)
    assert.equal(run('ratchet-baseline.mjs', ['--init-rule', 'no-eval'], dir).code, 0)
    assert.deepEqual(baseline(dir)['no-eval'], {})
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
  })

  it('negative control: a recorded rule cannot be dropped from the config; retiring it keeps a tombstone', (t) => {
    const dir = setup(t)
    run('ratchet-baseline.mjs', ['--init'], dir)
    config(dir, { ...CONFIG, rules: [{ id: 'no-eval', pattern: '\\beval\\(', include: ['src/**/*.ts'] }] })
    run('ratchet-baseline.mjs', ['--init-rule', 'no-eval'], dir)
    const dropped = run('ratchet-baseline.mjs', [], dir)
    assert.equal(dropped.code, 1)
    assert.match(dropped.err, /no-any-cast is recorded but no longer configured/u)
    const prune = run('ratchet-baseline.mjs', ['--prune'], dir)
    assert.equal(prune.code, 1)
    assert.ok(baseline(dir)['no-any-cast'], '--prune must not erase a recorded rule')
    config(dir, { ...CONFIG, rules: [{ id: 'no-any-cast', retired: 'superseded by typescript-eslint no-explicit-any' }, { id: 'no-eval', pattern: '\\beval\\(', include: ['src/**/*.ts'] }] })
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 1, 'the retired rule still has entries to prune')
    assert.equal(run('ratchet-baseline.mjs', ['--prune'], dir).code, 0)
    assert.deepEqual(baseline(dir)['no-any-cast'], {})
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
  })

  it('uses git-visible files inside a work tree, so ignored files are not scanned', (t) => {
    const dir = setup(t)
    git(dir, 'init', '-q')
    write(dir, '.gitignore', 'src/generated/\n')
    write(dir, 'src/generated/out.ts', 'const g = h as any\n')
    const init = run('ratchet-baseline.mjs', ['--init'], dir)
    assert.match(init.out, /recorded 2 existing finding/u)
  })

  it('rejects malformed config, unknown fields, and a corrupted baseline with exit 2', (t) => {
    const dir = setup(t)
    config(dir, { ...CONFIG, rules: [{ id: 'x', pattern: '(', include: ['**'] }] })
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 2)
    config(dir, { ...CONFIG, rules: [{ ...CONFIG.rules[0], allowempty: true }] })
    const typo = run('ratchet-baseline.mjs', [], dir)
    assert.equal(typo.code, 2)
    assert.match(typo.err, /unknown field "allowempty"/u)
    config(dir, CONFIG)
    write(dir, BASELINE, JSON.stringify({ 'no-any-cast': { 'src/a.ts': { nothex: 1 } } }))
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 2)
  })

  it('accepts the shipped config template, whose rules pass their own self-tests', (t) => {
    const dir = sandbox(t)
    write(dir, CONFIG_PATH, readFileSync(join(TEMPLATES, 'ratchet.config.json'), 'utf8'))
    write(dir, 'src/app.ts', 'export const a = 1\n')
    const init = run('ratchet-baseline.mjs', ['--init'], dir)
    assert.equal(init.code, 0, init.err)
    assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
  })

  describe('empty scans', () => {
    it('negative control: a rule whose include matches no file is a configuration error', (t) => {
      const dir = setup(t, { ...CONFIG, rules: [{ ...CONFIG.rules[0], include: ['srcs/**/*.ts'] }] })
      for (const args of [['--init'], []]) {
        const result = run('ratchet-baseline.mjs', args, dir)
        assert.equal(result.code, 2)
        assert.match(result.err, /no-any-cast scanned zero files/u)
      }
      const list = run('ratchet-baseline.mjs', ['--list'], dir)
      assert.equal(list.code, 0)
      assert.match(list.out, /no-any-cast: 0 finding\(s\) in 0 scanned file\(s\), EMPTY SCOPE/u)
    })

    it('an optional rule with "allowEmpty": true may scan nothing', (t) => {
      const dir = setup(t, { ...CONFIG, rules: [...CONFIG.rules, { id: 'no-unwrap', pattern: '\\.unwrap\\(\\)', include: ['**/*.rs'], allowEmpty: true }] })
      assert.equal(run('ratchet-baseline.mjs', ['--init'], dir).code, 0)
      assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
      assert.match(run('ratchet-baseline.mjs', ['--list'], dir).out, /no-any-cast: 2 finding\(s\) in 1 scanned file\(s\)/u)
    })
  })

  describe('multiline rules', () => {
    const PY = {
      baseline: BASELINE,
      rules: [{ id: 'no-python-silent-except', multiline: true, pattern: '^[ \\t]*except\\b[^:\\n]*:(?:\\s*#[^\\n]*)*\\s*pass\\b', include: ['**/*.py'] }],
    }
    const legacy = 'try:\n    run()\nexcept Exception:\n    pass\n\ntry:\n    stop()\nexcept OSError:  # best effort\n    pass\n'

    it('freezes multi-line `except Exception:` / `pass` handlers', (t) => {
      const dir = sandbox(t)
      config(dir, PY)
      write(dir, 'app/jobs.py', legacy)
      const init = run('ratchet-baseline.mjs', ['--init'], dir)
      assert.equal(init.code, 0, init.err)
      assert.match(init.out, /recorded 2 existing finding/u)
      write(dir, 'app/jobs.py', `\n\n${legacy}`)
      assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0, 'moving the block keeps its allowance')
    })

    it('negative control: a new multi-line silent handler fails', (t) => {
      const dir = sandbox(t)
      config(dir, PY)
      write(dir, 'app/jobs.py', legacy)
      run('ratchet-baseline.mjs', ['--init'], dir)
      write(dir, 'app/jobs.py', `${legacy}\ntry:\n    flush()\nexcept ValueError:\n    pass\n`)
      const result = run('ratchet-baseline.mjs', [], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /app\/jobs\.py:13\s+\[no-python-silent-except\]/u)
    })
  })

  describe('self-test samples', () => {
    it('passes when mustMatch matches and mustNotMatch does not', (t) => {
      const dir = setup(t, { ...CONFIG, rules: [{ ...CONFIG.rules[0], mustMatch: ['x as any'], mustNotMatch: ['x as unknown', 'company'] }] })
      assert.equal(run('ratchet-baseline.mjs', ['--init'], dir).code, 0)
    })

    it('negative control: a pattern that misses its mustMatch sample is exit 2', (t) => {
      const dir = setup(t, { ...CONFIG, rules: [{ ...CONFIG.rules[0], pattern: '\\bas\\s+anything\\b', mustMatch: ['x as any'] }] })
      const result = run('ratchet-baseline.mjs', ['--list'], dir)
      assert.equal(result.code, 2)
      assert.match(result.err, /no-any-cast fails its self-test: mustMatch sample "x as any" does not match/u)
    })

    it('negative control: a pattern that matches its mustNotMatch sample is exit 2', (t) => {
      const dir = setup(t, { ...CONFIG, rules: [{ ...CONFIG.rules[0], pattern: 'any', mustNotMatch: ['company'] }] })
      const result = run('ratchet-baseline.mjs', [], dir)
      assert.equal(result.code, 2)
      assert.match(result.err, /mustNotMatch sample "company" matches/u)
    })
  })

  describe('--findings from an external linter', () => {
    const EXT = { baseline: BASELINE, rules: [{ id: 'ruff-s110', external: true, message: 'try-except-pass' }] }
    const setupExternal = (t) => {
      const dir = sandbox(t)
      config(dir, EXT)
      write(dir, 'app/jobs.py', 'try:\n    run()\nexcept Exception:\n    pass\n')
      write(dir, 'findings.json', JSON.stringify([{ rule: 'ruff-s110', file: 'app/jobs.py', line: 3 }]))
      return dir
    }

    it('ratchets linter findings under the same baseline contract, reading text from "line"', (t) => {
      const dir = setupExternal(t)
      const init = run('ratchet-baseline.mjs', ['--init', '--findings', 'findings.json'], dir)
      assert.equal(init.code, 0, init.err)
      assert.match(init.out, /recorded 1 existing finding/u)
      write(dir, 'app/jobs.py', '\n\ntry:\n    run()\nexcept Exception:\n    pass\n')
      write(dir, 'findings.json', JSON.stringify([{ rule: 'ruff-s110', file: join(dir, 'app/jobs.py'), line: 5 }]))
      const moved = run('ratchet-baseline.mjs', ['--findings', 'findings.json'], dir)
      assert.equal(moved.code, 0, moved.err)
    })

    it('negative control: a new external finding fails', (t) => {
      const dir = setupExternal(t)
      run('ratchet-baseline.mjs', ['--init', '--findings', 'findings.json'], dir)
      write(dir, 'findings.json', JSON.stringify([
        { rule: 'ruff-s110', file: 'app/jobs.py', line: 3 },
        { rule: 'ruff-s110', file: 'app/other.py', text: 'except BaseException:' },
      ]))
      const result = run('ratchet-baseline.mjs', ['--findings', 'findings.json'], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /app\/other\.py:0\s+\[ruff-s110\]/u)
    })

    it('negative control: missing --findings, unknown rules, and escaping paths are exit 2', (t) => {
      const dir = setupExternal(t)
      run('ratchet-baseline.mjs', ['--init', '--findings', 'findings.json'], dir)
      assert.match(run('ratchet-baseline.mjs', [], dir).err, /external; pass --findings/u)
      write(dir, 'findings.json', JSON.stringify([{ rule: 'eslint-x', file: 'a.ts', text: 'x' }]))
      assert.equal(run('ratchet-baseline.mjs', ['--findings', 'findings.json'], dir).code, 2)
      write(dir, 'findings.json', JSON.stringify([{ rule: 'ruff-s110', file: '../outside.py', text: 'x' }]))
      assert.equal(run('ratchet-baseline.mjs', ['--findings', 'findings.json'], dir).code, 2)
      write(dir, 'findings.json', JSON.stringify({ rule: 'ruff-s110' }))
      assert.equal(run('ratchet-baseline.mjs', ['--findings', 'findings.json'], dir).code, 2)
    })
  })

  describe('--base monotonicity guard', () => {
    it('passes when the change only shrinks the baseline', (t) => {
      const dir = adopted(t)
      write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\n')
      assert.equal(run('ratchet-baseline.mjs', ['--prune'], dir).code, 0)
      const check = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(check.code, 0, check.err)
      assert.match(check.out, /nothing loosened since HEAD/u)
    })

    it('negative control: a hand-edited count fails', (t) => {
      const dir = adopted(t)
      write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\nconst z = w as any\nconst z = w as any\n')
      const value = baseline(dir)
      value['no-any-cast']['src/a.ts'][fingerprint('no-any-cast', 'const z = w as any')] = 2
      write(dir, BASELINE, JSON.stringify(value))
      assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0, 'without --base the edited baseline looks consistent')
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /rose from 1 to 2/u)
    })

    it('negative control: deleting the baseline and re-running --init with new debt fails', (t) => {
      const dir = adopted(t)
      write(dir, 'src/b.ts', 'const k = j as any\n')
      unlinkSync(join(dir, BASELINE))
      assert.equal(run('ratchet-baseline.mjs', ['--init'], dir).code, 0)
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /new fingerprint/u)
    })

    it('negative control: dropping a rule, pruning, and re-adopting it with new debt fails', (t) => {
      const dir = adopted(t)
      const clean = { id: 'no-eval', pattern: '\\beval\\(', include: ['src/**/*.ts'] }
      config(dir, { ...CONFIG, rules: [clean] })
      write(dir, BASELINE, JSON.stringify({ 'no-eval': {} }))
      write(dir, 'src/b.ts', 'const k = j as any\n')
      config(dir, { ...CONFIG, rules: [clean, CONFIG.rules[0]] })
      assert.equal(run('ratchet-baseline.mjs', ['--init-rule', 'no-any-cast'], dir).code, 0)
      assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0, 'without --base the laundering looks clean')
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /new fingerprint/u)
    })

    it('negative control: removing a recorded rule from config and baseline fails', (t) => {
      const dir = adopted(t, { ...CONFIG, rules: [...CONFIG.rules, { id: 'no-eval', pattern: '\\beval\\(', include: ['src/**/*.ts'] }] })
      config(dir, { ...CONFIG, rules: [{ id: 'no-eval', pattern: '\\beval\\(', include: ['src/**/*.ts'] }] })
      write(dir, BASELINE, JSON.stringify({ 'no-eval': {} }))
      assert.equal(run('ratchet-baseline.mjs', [], dir).code, 0)
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /no-any-cast was removed from the config/u)
    })

    it('negative control: narrowing include, widening exclude, or changing the pattern fails', (t) => {
      const loosen = [
        [{ ...CONFIG, rules: [{ ...CONFIG.rules[0], include: ['src/core/**/*.ts', 'src/*.ts'] }] }, /include lost "src\/\*\*\/\*\.ts"/u],
        [{ ...CONFIG, rules: [{ ...CONFIG.rules[0], exclude: ['**/*.d.ts', 'src/a.ts'] }] }, /exclude gained "src\/a\.ts"/u],
        [{ ...CONFIG, exclude: ['vendor/**', 'src/a.ts'] }, /config\.exclude gained "src\/a\.ts"/u],
        [{ ...CONFIG, rules: [{ ...CONFIG.rules[0], pattern: '\\bas\\s+any\\b(?!.*legacy)' }] }, /"pattern" changed/u],
      ]
      for (const [value, expected] of loosen) {
        const dir = adopted(t)
        write(dir, 'src/ok.ts', 'export const ok = 1\n')
        config(dir, value)
        const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
        assert.equal(result.code, 1, `${JSON.stringify(value)}\n${result.err}`)
        assert.match(result.err, expected)
      }
    })

    it('retiring a recorded rule with a reason passes', (t) => {
      const dir = adopted(t)
      config(dir, { ...CONFIG, rules: [{ id: 'no-any-cast', retired: 'typescript-eslint no-explicit-any owns this now' }] })
      assert.equal(run('ratchet-baseline.mjs', ['--prune'], dir).code, 0)
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(result.code, 0, result.err)
    })

    it('rejects option-shaped refs, --base outside check and prune, and non-repositories with exit 2', (t) => {
      const dir = adopted(t)
      assert.equal(run('ratchet-baseline.mjs', ['--base', '--cached'], dir).code, 2)
      assert.equal(run('ratchet-baseline.mjs', ['--base', 'HEAD', '--init'], dir).code, 2)
      assert.equal(run('ratchet-baseline.mjs', ['--base', 'no-such-ref'], dir).code, 2)
      const plain = setup(t)
      run('ratchet-baseline.mjs', ['--init'], plain)
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], plain)
      assert.equal(result.code, 2)
      assert.match(result.err, /needs a Git work tree/u)
    })
  })

  describe('--base without a base ratchet or with a relocated config', () => {
    it('reports a first-adoption check instead of claiming nothing loosened', (t) => {
      const dir = setup(t)
      git(dir, 'init', '-q')
      commitAll(dir, 'before the ratchet')
      assert.equal(run('ratchet-baseline.mjs', ['--init'], dir).code, 0)
      const result = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(result.code, 0, result.err)
      assert.match(result.out, /no base ratchet at HEAD; first-adoption check/u)
      assert.doesNotMatch(result.out, /nothing loosened/u)
    })

    it('a relocated config with an unchanged baseline passes', (t) => {
      const dir = adopted(t)
      git(dir, 'mv', CONFIG_PATH, 'scripts/governance/moved.config.json')
      const result = run('ratchet-baseline.mjs', ['--config', 'scripts/governance/moved.config.json', '--base', 'HEAD'], dir)
      assert.equal(result.code, 0, result.err)
      assert.match(result.out, /nothing loosened since HEAD/u)
    })

    it('negative control: relocating the config cannot launder a re-initialized baseline', (t) => {
      const dir = adopted(t)
      git(dir, 'mv', CONFIG_PATH, 'scripts/governance/moved.config.json')
      write(dir, 'src/b.ts', 'const k = j as any\n')
      unlinkSync(join(dir, BASELINE))
      assert.equal(run('ratchet-baseline.mjs', ['--config', 'scripts/governance/moved.config.json', '--init'], dir).code, 0)
      const result = run('ratchet-baseline.mjs', ['--config', 'scripts/governance/moved.config.json', '--base', 'HEAD'], dir)
      assert.equal(result.code, 1)
      assert.match(result.err, /new fingerprint/u)
    })
  })

  describe('file moves', () => {
    it('git mv keeps every allowance once --prune --base carries it to the new path', (t) => {
      const dir = adopted(t)
      mkdirSync(join(dir, 'src/lib'))
      git(dir, 'mv', 'src/a.ts', 'src/lib/a.ts')
      const check = run('ratchet-baseline.mjs', [], dir)
      assert.equal(check.code, 1)
      assert.match(check.err, /run --prune --base <ref>/u)
      const prune = run('ratchet-baseline.mjs', ['--prune', '--base', 'HEAD'], dir)
      assert.equal(prune.code, 0, prune.err)
      assert.match(prune.out, /moved 2 allowance\(s\)/u)
      assert.deepEqual(Object.keys(baseline(dir)['no-any-cast']), ['src/lib/a.ts'])
      const guarded = run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir)
      assert.equal(guarded.code, 0, guarded.err)
    })

    it('extracting legacy lines into a new file carries their allowances', (t) => {
      const dir = adopted(t)
      write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\n')
      write(dir, 'src/extracted.ts', 'const z = w as any\n')
      const prune = run('ratchet-baseline.mjs', ['--prune', '--base', 'HEAD'], dir)
      assert.equal(prune.code, 0, prune.err)
      assert.equal(run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir).code, 0)
    })

    it('negative control: git mv plus one extra violation still fails and leaves the baseline untouched', (t) => {
      const dir = adopted(t)
      mkdirSync(join(dir, 'src/lib'))
      git(dir, 'mv', 'src/a.ts', 'src/lib/a.ts')
      write(dir, 'src/lib/a.ts', `${read(dir, 'src/lib/a.ts')}const n = m as any\n`)
      const before = read(dir, BASELINE)
      const prune = run('ratchet-baseline.mjs', ['--prune', '--base', 'HEAD'], dir)
      assert.equal(prune.code, 1)
      assert.match(prune.err, /src\/lib\/a\.ts:4\s+\[no-any-cast\]/u)
      assert.equal(read(dir, BASELINE), before)
      assert.equal(run('ratchet-baseline.mjs', ['--base', 'HEAD'], dir).code, 1)
    })

    it('negative control: an allowance never moves into an existing file', (t) => {
      const dir = adopted(t)
      write(dir, 'src/existing.ts', 'export const e = 1\n')
      commitAll(dir, 'add an existing file')
      write(dir, 'src/a.ts', 'const x = y as any\nconst ok = 1\n')
      write(dir, 'src/existing.ts', 'export const e = 1\nconst z = w as any\n')
      assert.equal(run('ratchet-baseline.mjs', ['--prune', '--base', 'HEAD'], dir).code, 1)
    })
  })
})

describe('verify-md-links', () => {
  const docs = (dir) => {
    write(dir, 'README.md', '# Project\n\nSee [arch](docs/architecture.md#data-flow), [notes](.agents/notes/), [web](https://example.com), and [self](#project).\n\n```md\n[ignored](missing-in-fence.md)\n```\n\nInline `[ignored](missing-inline.md)` too.\n')
    write(dir, 'docs/architecture.md', '# Architecture\n\n## Data flow\n\n## Data flow\n\n<a id="Custom-Anchor"></a>\n\n[dup](#data-flow-1) [custom](#custom-anchor) [up](../README.md)\n\n[ref]: ../README.md\n')
    mkdirSync(join(dir, '.agents/notes'), { recursive: true })
  }
  const check = (dir, ...args) => run('verify-md-links.mjs', args, dir)

  it('passes when every relative link and anchor resolves', (t) => {
    const dir = sandbox(t)
    docs(dir)
    const result = check(dir)
    assert.equal(result.code, 0, result.err)
  })

  it('negative control: fails on a missing file target', (t) => {
    const dir = sandbox(t)
    docs(dir)
    write(dir, 'docs/guide.md', 'Read [the plan](plan.md).\n')
    const result = check(dir)
    assert.equal(result.code, 1)
    assert.match(result.err, /docs\/guide\.md:1: plan\.md -> missing docs\/plan\.md/u)
  })

  it('negative control: fails on a missing heading anchor unless --no-anchors', (t) => {
    const dir = sandbox(t)
    docs(dir)
    write(dir, 'docs/guide.md', 'See [flow](architecture.md#control-flow).\n')
    const result = check(dir)
    assert.equal(result.code, 1)
    assert.match(result.err, /no heading or anchor "#control-flow"/u)
    assert.equal(check(dir, '--no-anchors').code, 0)
  })

  it('--exclude skips matching files', (t) => {
    const dir = sandbox(t)
    docs(dir)
    write(dir, 'templates/AGENTS.md', '[placeholder](docs/owning-home.md)\n')
    assert.equal(check(dir).code, 1)
    assert.equal(check(dir, '--exclude', 'templates/**').code, 0)
  })

  it('handles CJK headings with GitHub slugs', (t) => {
    const dir = sandbox(t)
    write(dir, 'README.md', '# 项目\n\n## 为什么会崩掉？\n\n[跳转](#为什么会崩掉)\n')
    assert.equal(check(dir).code, 0)
  })

  it('negative control: zero scanned files is exit 2 unless --allow-empty', (t) => {
    const dir = sandbox(t)
    write(dir, 'notes.txt', 'not markdown\n')
    const empty = check(dir)
    assert.equal(empty.code, 2)
    assert.match(empty.err, /no Markdown files/u)
    assert.equal(check(dir, '--allow-empty').code, 0)
    docs(dir)
    assert.equal(check(dir, '--exclude', '**').code, 2, 'excluding everything is an empty scan too')
  })

  const cases = [
    ['ignores headings hidden in a multi-line HTML comment', '<!--\n## Ghost\n-->\n\n[x](#ghost)\n', 1, /no heading or anchor "#ghost"/u],
    ['ignores links inside HTML comments', '# T\n\n<!-- [x](missing.md) -->\n', 0],
    ['ignores 4-space indented code blocks', '# T\n\nText.\n\n    [x](missing.md)\n', 0],
    ['checks indented list continuations, which are not code', '# T\n\n- item\n\n    [x](missing.md)\n', 1, /missing\.md -> missing/u],
    ['resolves balanced parentheses in a destination', '# T\n\n[x](file(v1).md)\n', 0],
    ['negative control: reports the whole parenthesized destination', '# T\n\n[x](gone(v1).md)\n', 1, /gone\(v1\)\.md -> missing gone\(v1\)\.md/u],
    ['resolves a destination split across lines', '# T\n\n[x](\nfile(v1).md\n)\n', 0],
    ['negative control: checks a destination split across lines', '# T\n\n[x](\nmissing.md\n)\n', 1, /README\.md:3: missing\.md -> missing/u],
    ['resolves Setext headings', 'Title\n=====\n\nSub section\n-----------\n\n[a](#title) [b](#sub-section)\n', 0],
    ['negative control: a Setext anchor that does not exist', 'Title\n=====\n\n[a](#subtitle)\n', 1, /"#subtitle"/u],
    ['allocates duplicate slugs against every used id like github-slugger', '# Foo\n\n# Foo-1\n\n# Foo\n\n[a](#foo) [b](#foo-1) [c](#foo-2)\n', 0],
    ['negative control: a duplicate slug that was never allocated', '# Foo\n\n# Foo-1\n\n# Foo\n\n[d](#foo-3)\n', 1, /"#foo-3"/u],
    ['resolves root-relative links from --root', '# T\n\n[x](/file(v1).md)\n', 0],
    ['skips front matter', '---\ntitle: x\n---\n\n# T\n\n[x](#t)\n', 0],
    ['checks links nested in image links', '# T\n\n[![badge](missing.svg)](file(v1).md)\n', 1, /missing\.svg -> missing/u],
    ['keeps inline-code text in heading slugs', '# API `foo()`\n\n[valid](#api-foo)\n', 0],
    ['negative control: a slug that drops the inline-code text', '# API `foo()`\n\n[wrong](#api)\n', 1, /no heading or anchor "#api"/u],
    ['still ignores links inside inline code in headings', '# See `[x](missing.md)`\n', 0],
  ]
  for (const [name, readme, code, expected] of cases) {
    it(name, (t) => {
      const dir = sandbox(t)
      write(dir, 'file(v1).md', '# File\n')
      write(dir, 'README.md', readme)
      const result = check(dir)
      assert.equal(result.code, code, `${result.out}${result.err}`)
      if (expected) assert.match(result.err, expected)
    })
  }

  it('scans symlinks the same way with and without Git: never directly, only their targets', (t) => {
    if (process.platform === 'win32') return t.skip('symlinks need privileges on Windows')
    const dir = sandbox(t)
    write(dir, 'AGENTS.md', '# Rules\n\n[gone](missing.md)\n')
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'))
    const walked = check(dir)
    assert.equal(walked.code, 1)
    assert.equal(walked.err.match(/missing\.md -> missing/gu).length, 1)
    git(dir, 'init', '-q')
    commitAll(dir, 'seed')
    const listed = check(dir)
    assert.equal(listed.code, 1)
    assert.equal(listed.err.match(/missing\.md -> missing/gu).length, 1)
  })

  it('distinguishes a missing Git (directory walk) from a failing Git (exit 2)', (t) => {
    if (process.platform === 'win32') return t.skip('uses a POSIX shell stub')
    const dir = sandbox(t)
    docs(dir)
    const noGit = sandbox(t)
    const walked = run('verify-md-links.mjs', [], dir, { ...process.env, PATH: noGit })
    assert.equal(walked.code, 0, walked.err)
    const broken = sandbox(t)
    write(broken, 'git', '#!/bin/sh\necho "fatal: simulated failure" >&2\nexit 128\n')
    chmodSync(join(broken, 'git'), 0o755)
    const failed = run('verify-md-links.mjs', [], dir, { ...process.env, PATH: `${broken}${delimiter}${process.env.PATH}` })
    assert.equal(failed.code, 2)
    assert.match(failed.err, /git rev-parse failed/u)
  })
})

describe('templates compose into the adoption rungs', () => {
  const copyScripts = (dir, names) => {
    for (const name of names) {
      mkdirSync(join(dir, 'scripts/governance'), { recursive: true })
      copyFileSync(join(SCRIPTS, name), join(dir, 'scripts/governance', name))
    }
  }
  const node = (dir, script, ...args) => {
    const result = spawnSync(process.execPath, [`scripts/governance/${script}`, ...args], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT })
    return { code: result.status, out: result.stdout, err: result.stderr }
  }
  const day1 = (dir) => {
    write(dir, 'AGENTS.md', readFileSync(join(TEMPLATES, 'AGENTS.md'), 'utf8'))
    write(dir, 'CLAUDE.md', '@AGENTS.md\n')
    write(dir, `${NOTES}/README.md`, readFileSync(join(TEMPLATES, 'agent-notes-README.md'), 'utf8'))
    write(dir, `${NOTES}/implemented/architecture/2026-01-05-sqlite-not-redis-for-job-state.md`, readFileSync(join(TEMPLATES, 'agent-note-implemented.md'), 'utf8'))
  }

  it('the root AGENTS.md template carries the always-loaded design rules and every gate command', () => {
    const text = readFileSync(join(TEMPLATES, 'AGENTS.md'), 'utf8')
    assert.match(text, /## Before designing a change/u)
    assert.match(text, /rg -l -i "<module or concept>" \.agents\/notes\/\{implemented,rejected,proposed\} \| xargs head -n 3/u)
    assert.match(text, /Never re-propose a rejected option/u)
    assert.match(text, /Mock only external boundaries/u)
    for (const script of SCRIPT_NAMES) assert.match(text, new RegExp(`node scripts/governance/${script.replace('.', '\\.')}`, 'u'))
  })

  it('Day 1: AGENTS.md, CLAUDE.md, notes README, and one note pass the notes check', (t) => {
    const dir = sandbox(t)
    day1(dir)
    copyScripts(dir, ['verify-agent-notes.mjs'])
    const result = node(dir, 'verify-agent-notes.mjs')
    assert.equal(result.code, 0, result.err)
  })

  it('Week 1: the Day 1 files plus docs pass budgets, notes, and links, before and after a base exists', (t) => {
    const dir = sandbox(t)
    day1(dir)
    write(dir, 'docs/AGENTS.md', readFileSync(join(TEMPLATES, 'docs-AGENTS.md'), 'utf8'))
    write(dir, 'docs/CLAUDE.md', '@AGENTS.md\n')
    write(dir, 'docs/architecture.md', '# Architecture\n\nOne-page map.\n')
    write(dir, 'scripts/governance/doc-budgets.manifest.json', readFileSync(join(TEMPLATES, 'doc-budgets.manifest.json'), 'utf8'))
    copyScripts(dir, ['verify-doc-budgets.mjs', 'verify-agent-notes.mjs', 'verify-md-links.mjs'])
    for (const script of ['verify-doc-budgets.mjs', 'verify-agent-notes.mjs', 'verify-md-links.mjs']) {
      const result = node(dir, script)
      assert.equal(result.code, 0, `${script}: ${result.err}`)
    }
    git(dir, 'init', '-q')
    commitAll(dir, 'week 1')
    assert.equal(node(dir, 'verify-doc-budgets.mjs', '--base', 'HEAD').code, 0)
    assert.equal(node(dir, 'verify-agent-notes.mjs', '--base', 'HEAD').code, 0)
  })

  it('the workflow templates skip the ratchet until adopted and keep GitHub expressions out of shell text', () => {
    const template = readFileSync(join(TEMPLATES, 'github-actions-governance.yml'), 'utf8')
    assert.match(template, /if \[ ! -f scripts\/governance\/ratchet\.baseline\.json \]/u)
    for (const file of [join(TEMPLATES, 'github-actions-governance.yml'), join(REPO, '.github/workflows/verify.yml')]) {
      for (const line of readFileSync(file, 'utf8').split('\n').filter(item => item.includes('${{'))) {
        assert.match(line, /^\s*(?:[A-Z_]+|node-version):\s*\$\{\{[^}]*\}\}\s*$/u, `${file}: ${line}`)
      }
    }
    assert.match(readFileSync(join(TEMPLATES, 'lefthook.yml'), 'utf8'), /\[ ! -f scripts\/governance\/ratchet\.baseline\.json \] && \[ ! -f scripts\/governance\/ratchet\.config\.json \]; \} \|\|/u)
  })

  describe('the workflow template ratchet step, executed', () => {
    const template = readFileSync(join(TEMPLATES, 'github-actions-governance.yml'), 'utf8').split('\n')
    const start = template.findIndex(line => line.includes('- name: Legacy ratchet'))
    const runLine = template.findIndex((line, index) => index > start && /^\s*run: \|\s*$/u.test(line))
    const indent = template[runLine + 1].match(/^\s*/u)[0]
    const body = []
    for (const line of template.slice(runLine + 1)) {
      if (line.trim() !== '' && !line.startsWith(indent)) break
      body.push(line.slice(indent.length))
    }
    const step = body.join('\n')
    const RATCHET_CONFIG = { baseline: 'scripts/governance/ratchet.baseline.json', rules: [{ id: 'no-any-cast', pattern: '\\bas\\s+any\\b', include: ['src/**/*.ts'] }] }

    const repo = (t, { adopt }) => {
      const dir = sandbox(t)
      write(dir, 'src/a.ts', 'const x = y as any\n')
      copyScripts(dir, ['ratchet-baseline.mjs'])
      if (adopt) {
        write(dir, 'scripts/governance/ratchet.config.json', JSON.stringify(RATCHET_CONFIG))
        assert.equal(node(dir, 'ratchet-baseline.mjs', '--init').code, 0)
      }
      git(dir, 'init', '-q')
      commitAll(dir, 'main')
      git(dir, 'checkout', '-q', '-b', 'topic')
      return dir
    }
    const runStep = (dir) => {
      const result = spawnSync('bash', ['-e', '-c', step], {
        cwd: dir, encoding: 'utf8', timeout: TIMEOUT,
        env: { ...process.env, GOV_BASE: 'main', PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` },
      })
      return { code: result.status, out: result.stdout, err: result.stderr }
    }

    it('extracts a non-empty step body that calls the checker with --base', () => {
      assert.match(step, /node scripts\/governance\/ratchet-baseline\.mjs \$\{GOV_BASE:\+--base "\$GOV_BASE"\}/u)
    })

    it('never adopted, here or at the base: skipped with exit 0', (t) => {
      const dir = repo(t, { adopt: false })
      const result = runStep(dir)
      assert.equal(result.code, 0, result.err)
      assert.match(result.out, /ratchet not adopted: skipped/u)
    })

    it('adopted and unchanged: runs the check and exits 0', (t) => {
      const dir = repo(t, { adopt: true })
      const result = runStep(dir)
      assert.equal(result.code, 0, result.err)
      assert.match(result.out, /nothing loosened since main/u)
    })

    it('negative control: adopted, then the baseline deleted and a violation added, fails', (t) => {
      const dir = repo(t, { adopt: true })
      git(dir, 'rm', '-q', 'scripts/governance/ratchet.baseline.json')
      write(dir, 'src/b.ts', 'const k = j as any\n')
      commitAll(dir, 'drop the baseline')
      const result = runStep(dir)
      assert.notEqual(result.code, 0, result.out)
      assert.match(result.err, /baseline not found/u)
    })

    it('negative control: adopted, then config and baseline both deleted, fails', (t) => {
      const dir = repo(t, { adopt: true })
      git(dir, 'rm', '-q', '-r', 'scripts/governance/ratchet.baseline.json', 'scripts/governance/ratchet.config.json')
      commitAll(dir, 'drop the ratchet')
      const result = runStep(dir)
      assert.notEqual(result.code, 0, result.out)
      assert.match(result.err, /config not found/u)
    })

    it('negative control: adopted, then the baseline re-initialized with extra debt, exits 1', (t) => {
      const dir = repo(t, { adopt: true })
      write(dir, 'src/b.ts', 'const k = j as any\n')
      unlinkSync(join(dir, 'scripts/governance/ratchet.baseline.json'))
      assert.equal(node(dir, 'ratchet-baseline.mjs', '--init').code, 0)
      commitAll(dir, 'launder the baseline')
      const result = runStep(dir)
      assert.equal(result.code, 1, result.out)
      assert.match(result.err, /new fingerprint/u)
    })

    it('negative control: a config committed without a baseline fails', (t) => {
      const dir = repo(t, { adopt: false })
      write(dir, 'scripts/governance/ratchet.config.json', JSON.stringify(RATCHET_CONFIG))
      commitAll(dir, 'config only')
      const result = runStep(dir)
      assert.notEqual(result.code, 0, result.out)
      assert.match(result.err, /baseline not found/u)
    })
  })

  describe('the README install snippet, executed', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
    const snippet = readme.slice(readme.indexOf('DEST=~/.agents/skills'), readme.indexOf('\n```', readme.indexOf('DEST=~/.agents/skills')))
    const install = (t, gitBody) => {
      if (process.platform === 'win32') return t.skip('uses a POSIX shell stub')
      const home = sandbox(t)
      const temp = sandbox(t)
      const bin = sandbox(t)
      write(bin, 'git', `#!/bin/sh\n${gitBody}\n`)
      chmodSync(join(bin, 'git'), 0o755)
      const result = spawnSync('bash', ['-c', snippet], { encoding: 'utf8', timeout: TIMEOUT, env: { ...process.env, HOME: home, TMPDIR: temp, PATH: `${bin}${delimiter}${process.env.PATH}` } })
      return { code: result.status, home, leftovers: readdirSync(temp) }
    }

    it('installs the skill and removes its temporary clone', (t) => {
      const result = install(t, 'mkdir -p "$5/skills/sustainable-engineering" && echo skill > "$5/skills/sustainable-engineering/SKILL.md"')
      if (!result) return
      assert.equal(result.code, 0)
      assert.ok(existsSync(join(result.home, '.agents/skills/sustainable-engineering/SKILL.md')))
      assert.deepEqual(result.leftovers, [])
    })

    it('negative control: a failed clone keeps its exit status and still cleans up', (t) => {
      const result = install(t, 'exit 42')
      if (!result) return
      assert.equal(result.code, 42)
      assert.deepEqual(result.leftovers, [])
    })
  })

  it('the CODEOWNERS template protects the gates and the standing instructions', () => {
    const text = readFileSync(join(TEMPLATES, 'CODEOWNERS'), 'utf8')
    for (const path of ['/scripts/governance/', '/AGENTS.md', '/CLAUDE.md', '/.github/workflows/governance.yml']) {
      assert.match(text, new RegExp(`^${path.replaceAll('.', '\\.')}\\s+@`, 'mu'))
    }
  })

  it('the plugin manifest carries a version', () => {
    const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin/marketplace.json'), 'utf8'))
    assert.match(marketplace.plugins[0].version, /^\d+\.\d+\.\d+$/u)
    assert.ok(existsSync(join(REPO, marketplace.plugins[0].skills[0], 'SKILL.md')))
  })
})
