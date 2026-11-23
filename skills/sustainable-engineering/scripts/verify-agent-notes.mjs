#!/usr/bin/env node
// sustainable-engineering v1.0.0
/**
 * verify-agent-notes: enforce the path-encoded layout and in-file format of Agent Notes.
 *
 * Layout: `<dir>/{lifecycle}/{class}/yyyy-mm-dd-topic.md`, lifecycle in proposed | implemented |
 * rejected | archived, class from a closed set. A centralized INDEX file is rejected anywhere in
 * the tree. Translations (`topic.zh.md`) must have their primary sibling and skip format checks.
 * Required sections must carry visible content other than HTML comments or a bare TODO/TBD.
 * With `--base <ref>`, relative to the merge-base of the ref and HEAD, files under `archived/`
 * must be unchanged and files under `rejected/` may only be added or deleted.
 * Zero dependencies; Node.js >= 18.
 *
 * Exit codes: 0 valid, 1 violations found, 2 usage or environment error.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const VERSION = '1.0.0'
const HELP = `Usage: node verify-agent-notes.mjs [--root <dir>] [--dir <notes-dir>] [--classes <a,b,...>] [--base <git-ref>]

Verify Agent Notes (decision records) under .agents/notes/.

Options:
  --root <dir>         Repository root (default: cwd).
  --dir <path>         Notes directory relative to --root (default: .agents/notes).
  --classes <list>     Comma-separated closed set of class folders
                       (default: feature,bug-fix,simplification,architecture,process,testing).
  --base <git-ref>     Also fail when, relative to the merge-base of <git-ref> and HEAD, a
                       file under archived/ was modified, renamed, or deleted (archived notes
                       are frozen), or a file under rejected/ was modified (rejected notes
                       may only be added or deleted).
  --version            Print the version.
  -h, --help           Show this help.

Checks:
  - path is {lifecycle}/{class}/yyyy-mm-dd-kebab-topic.md with a real, non-future date
  - no INDEX file anywhere in the notes tree (it serializes parallel branches)
  - line 1 "# Agent Note: <title>", line 2 blank, line 3 "Status:" matching the lifecycle
      proposed     -> Status: proposed
      implemented  -> Status: implemented
      rejected     -> Status: rejected — <one-line reason>
      archived     -> Status: implemented, then line 4 "Archived: yyyy-mm-dd"
  - archived notes carry a real "Archived:" date
  - body opens with "## Problem"; required sections per lifecycle, each with visible
    content that is not only an HTML comment or a bare TODO/TBD
  - headings and the Status line are English; section bodies may use any language
  - no .markdown (or other Markdown extension) files where notes live
  - implemented/archived notes contain no Proposal, Plan, Migration plan,
    Acceptance criteria, or Open questions section

Exit codes: 0 ok, 1 violations, 2 usage or environment error.`

const LIFECYCLES = ['proposed', 'implemented', 'rejected', 'archived']
const DEFAULT_CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']
const GUIDE_FILE = /^(?:README|AGENTS|CLAUDE)(?:\.[A-Za-z]{2}(?:-[A-Za-z]{2,4})?)?\.md$/u
const INDEX_FILE = /^index\.(?:md|markdown|json|ya?ml|txt)$/iu
const OTHER_MARKDOWN = /\.(?:markdown|mdown|mkdn|mkd|mdx)$/iu
const PLACEHOLDER_ONLY = /^(?:[\s\-*+>:.()[\]#]|\d+\.|TODO|TBD|FIXME)*$/iu
const NOTE_FILE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)(\.[A-Za-z]{2}(?:-[A-Za-z]{2,4})?)?\.md$/u
const REQUIRED = {
  proposed: ['Problem', 'Proposal', 'Alternatives considered', 'Acceptance criteria', 'Risks'],
  implemented: ['Problem', 'Decision', 'Alternatives considered', 'Consequences'],
  rejected: ['Problem', 'Proposal', 'Alternatives considered'],
  archived: ['Problem', 'Decision', 'Alternatives considered', 'Consequences'],
}
const BANNED_SHIPPED = /^(?:Proposal|Plan|Migration plan|Acceptance criteria|Open questions)\b/iu
const STATUS = {
  proposed: /^Status: proposed$/u,
  implemented: /^Status: implemented$/u,
  rejected: /^Status: rejected (?:—|--|-) \S.*$/u,
  archived: /^Status: implemented$/u,
}
const STATUS_TEXT = {
  proposed: 'Status: proposed',
  implemented: 'Status: implemented',
  rejected: 'Status: rejected — <one-line reason>',
  archived: 'Status: implemented',
}

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { root: process.cwd(), dir: '.agents/notes', classes: DEFAULT_CLASSES, base: undefined, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--version') options.version = true
    else if (['--root', '--dir', '--classes', '--base'].includes(arg)) {
      const value = argv[++i]
      if (value === undefined) throw new UsageError(`${arg} requires a value`)
      if (arg === '--base' && value.startsWith('-')) throw new UsageError(`--base must name a commit, not an option: ${value}`)
      if (arg === '--classes') {
        options.classes = value.split(',').map(item => item.trim()).filter(Boolean)
        if (options.classes.length === 0) throw new UsageError('--classes must name at least one class')
      } else options[arg.slice(2)] = value
    } else throw new UsageError(`unknown argument: ${arg}`)
  }
  return options
}

function checkDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const valid = date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000
  return { valid, future: valid && date.getTime() > tomorrow }
}

/** Lines outside fenced code blocks, with HTML comments blanked, and their 1-based line numbers. */
function proseLines(lines) {
  const result = []
  let fence
  let inComment = false
  lines.forEach((line, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined
      return
    }
    if (marker && !inComment) {
      fence = marker[1]
      return
    }
    let visible = ''
    let rest = line
    while (rest.length > 0) {
      if (inComment) {
        const end = rest.indexOf('-->')
        if (end === -1) {
          rest = ''
          break
        }
        rest = rest.slice(end + 3)
        inComment = false
      } else {
        const start = rest.indexOf('<!--')
        if (start === -1) {
          visible += rest
          break
        }
        visible += rest.slice(0, start)
        rest = rest.slice(start + 4)
        inComment = true
      }
    }
    result.push({ text: visible, number: index + 1 })
  })
  return result
}

function checkFormat(text, lifecycle, fail) {
  const lines = text.split(/\r?\n/u)
  if (!/^# Agent Note: \S/u.test(lines[0] ?? '')) fail('line 1 must be "# Agent Note: <title>"')
  if ((lines[1] ?? '') !== '') fail('line 2 must be blank')
  if (!STATUS[lifecycle].test(lines[2] ?? '')) fail(`line 3 must be "${STATUS_TEXT[lifecycle]}" for a note under ${lifecycle}/`)
  if (lifecycle === 'archived') {
    const archived = /^Archived: (\d{4})-(\d{2})-(\d{2})$/u.exec(lines[3] ?? '')
    if (!archived) fail('line 4 of an archived note must be "Archived: yyyy-mm-dd"')
    else {
      const date = checkDate(archived[1], archived[2], archived[3])
      if (!date.valid || date.future) fail(`line 4: ${archived[1]}-${archived[2]}-${archived[3]} is not a real, non-future archive date`)
    }
  }

  const prose = proseLines(lines)
  const statusLines = prose.filter(line => line.text.startsWith('Status:'))
  if (statusLines.length > 1) fail(`only line 3 may start with "Status:" (also found on line ${statusLines[1].number})`)

  const headings = prose.filter(line => /^## /u.test(line.text)).map(line => ({ ...line, title: line.text.slice(3).trim() }))
  if (headings.length === 0 || headings[0].title !== 'Problem') fail('the body must open with "## Problem"')
  const seen = new Set()
  for (const heading of headings) {
    if (seen.has(heading.title)) fail(`duplicate section "## ${heading.title}" on line ${heading.number}`)
    seen.add(heading.title)
  }
  for (const required of REQUIRED[lifecycle]) {
    if (!seen.has(required)) fail(`missing required section "## ${required}" for a note under ${lifecycle}/`)
  }
  if (lifecycle === 'implemented' || lifecycle === 'archived') {
    for (const heading of headings.filter(item => BANNED_SHIPPED.test(item.title))) {
      fail(`"## ${heading.title}" (line ${heading.number}) is plan language; a shipped note states the present-tense Decision and Consequences`)
    }
  }

  for (const [index, heading] of headings.entries()) {
    if (!REQUIRED[lifecycle].includes(heading.title)) continue
    const next = headings[index + 1]
    const body = prose
      .filter(line => line.number > heading.number && (next === undefined || line.number < next.number))
      .map(line => line.text.trim())
      .filter(Boolean)
    if (body.length === 0) {
      fail(`"## ${heading.title}" is empty${heading.title === 'Alternatives considered' ? '; record each genuine alternative and why it lost' : ''}`)
    } else if (PLACEHOLDER_ONLY.test(body.join(' '))) {
      fail(`"## ${heading.title}" holds only a placeholder (TODO/TBD); write the content or leave the note in proposed/`)
    }
  }
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError('git is not installed or not on PATH')
    throw new UsageError(`git ${args[0]} failed: ${String(error.stderr || error.message).trim()}`)
  }
}

/** Resolve --base to the merge-base of the ref and HEAD, so a stale branch is not blamed for later base commits. */
function resolveBase(root, ref) {
  let inside
  try {
    inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError('--base needs git, which is not installed or not on PATH')
    const stderr = String(error.stderr ?? '').trim()
    if (/not a git repository/iu.test(stderr)) throw new UsageError(`--base needs a Git work tree; ${root} is not one`)
    throw new UsageError(`git rev-parse failed: ${stderr || error.message}`)
  }
  if (inside !== 'true') throw new UsageError(`--base needs a Git work tree; ${root} is not one`)
  let oid
  try {
    oid = execFileSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    throw new UsageError(`--base ${ref} does not name a commit (fetch it first, e.g. git fetch origin)`)
  }
  return git(root, ['merge-base', oid, 'HEAD']).trim()
}

/** Frozen-note violations: archived/ allows only additions; rejected/ allows additions and deletions. */
function listFrozenChanges(root, notesDir, mergeBase) {
  const pathspec = name => relative(root, join(notesDir, name)) || '.'
  const fields = git(root, ['diff', '--name-status', '--no-renames', '--no-ext-diff', '--relative', '-z', mergeBase, '--', pathspec('archived'), pathspec('rejected')]).split('\0')
  const changes = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, path] = [fields[i], fields[i + 1]]
    const lifecycle = relative(notesDir, join(root, path)).split(/[\\/]/u)[0]
    if (status === 'A') continue
    if (lifecycle === 'rejected' && status === 'D') continue
    changes.push({ status, path, lifecycle })
  }
  return changes
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return 0
  }
  if (options.version) {
    console.log(`verify-agent-notes (sustainable-engineering) ${VERSION}`)
    return 0
  }
  const root = resolve(options.root)
  const notesDir = resolve(root, options.dir)
  if (!existsSync(notesDir) || !lstatSync(notesDir).isDirectory()) {
    throw new UsageError(`notes directory not found: ${relative(root, notesDir) || notesDir}`)
  }
  const classes = new Set(options.classes)
  const errors = []
  let noteCount = 0
  const label = path => relative(root, path)

  const walkIndex = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walkIndex(path)
      else if (INDEX_FILE.test(entry.name)) {
        errors.push(`${label(path)}: centralized index files are banned; the path {lifecycle}/{class}/date-topic.md is the index`)
      }
    }
  }
  walkIndex(notesDir)

  for (const top of readdirSync(notesDir, { withFileTypes: true })) {
    if (top.name.startsWith('.') || INDEX_FILE.test(top.name)) continue
    const topPath = join(notesDir, top.name)
    if (!top.isDirectory()) {
      if (!GUIDE_FILE.test(top.name)) errors.push(`${label(topPath)}: notes live under {lifecycle}/{class}/; only README/AGENTS/CLAUDE guides sit at the top level`)
      continue
    }
    if (!LIFECYCLES.includes(top.name)) {
      errors.push(`${label(topPath)}: unknown lifecycle folder; expected one of ${LIFECYCLES.join(', ')}`)
      continue
    }
    const lifecycle = top.name
    for (const second of readdirSync(topPath, { withFileTypes: true })) {
      if (second.name.startsWith('.') || INDEX_FILE.test(second.name)) continue
      const classPath = join(topPath, second.name)
      if (!second.isDirectory()) {
        if (!GUIDE_FILE.test(second.name)) errors.push(`${label(classPath)}: notes live one level deeper, under ${lifecycle}/{class}/`)
        continue
      }
      if (!classes.has(second.name)) {
        errors.push(`${label(classPath)}: unknown class folder; expected one of ${[...classes].join(', ')} (extend --classes and your notes README together)`)
        continue
      }
      const files = readdirSync(classPath, { withFileTypes: true })
      const names = new Set(files.map(file => file.name))
      for (const file of files) {
        const path = join(classPath, file.name)
        if (file.name.startsWith('.') || INDEX_FILE.test(file.name)) continue
        if (file.isDirectory()) {
          errors.push(`${label(path)}: nested folders are not allowed below {lifecycle}/{class}/`)
          continue
        }
        if (OTHER_MARKDOWN.test(file.name)) {
          errors.push(`${label(path)}: notes use the .md extension`)
          continue
        }
        if (!file.name.endsWith('.md') || GUIDE_FILE.test(file.name)) continue
        const match = NOTE_FILE.exec(file.name)
        if (!match) {
          errors.push(`${label(path)}: filename must be yyyy-mm-dd-kebab-case-topic.md`)
          continue
        }
        const [, year, month, day, topic, language] = match
        const date = checkDate(year, month, day)
        if (!date.valid) errors.push(`${label(path)}: ${year}-${month}-${day} is not a real date`)
        else if (date.future) errors.push(`${label(path)}: date ${year}-${month}-${day} is in the future; use the date the topic was first proposed`)
        if (language) {
          const primary = `${year}-${month}-${day}-${topic}.md`
          if (!names.has(primary)) errors.push(`${label(path)}: translation has no primary note ${primary} beside it`)
          continue
        }
        noteCount++
        checkFormat(readFileSync(path, 'utf8'), lifecycle, message => errors.push(`${label(path)}: ${message}`))
      }
    }
  }

  if (options.base !== undefined) {
    const mergeBase = resolveBase(root, options.base)
    for (const { status, path, lifecycle } of listFrozenChanges(root, notesDir, mergeBase)) {
      errors.push(lifecycle === 'rejected'
        ? `${path}: rejected notes are frozen proposals, but this change modifies it (relative to ${options.base}); delete it or write a new note`
        : `${path}: archived notes are frozen, but this change ${status === 'D' ? 'deletes' : 'modifies'} it (relative to ${options.base})`)
    }
  }

  if (errors.length > 0) {
    console.error(`verify-agent-notes failed (${errors.length} problem(s)):`)
    for (const error of errors) console.error(`  ${error}`)
    return 1
  }
  console.log(`verify-agent-notes: ${noteCount} note(s) valid under ${label(notesDir) || '.'}.`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`verify-agent-notes: ${error.message}\nRun with --help for usage.`)
    process.exitCode = 2
  } else throw error
}
