#!/usr/bin/env node
// sustainable-engineering v1.0.0
/**
 * verify-doc-budgets: enforce word-count ceilings on standing documents.
 *
 * Reads a JSON manifest mapping repository-relative paths to positive integer ceilings and fails
 * when a listed file is missing or exceeds its ceiling. Counting matches `wc -w` for text without
 * CJK characters; each Han, Hiragana, or Katakana character counts as one word, so Chinese and
 * Japanese documents cannot grow without bound. With `--base <ref>`, a raised ceiling or a removed
 * entry relative to the merge-base of the ref and HEAD fails unless `--allow-ceiling-change` is
 * passed. Zero dependencies; Node.js >= 18.
 *
 * Exit codes: 0 within budget (or --list), 1 budget violation, 2 usage, manifest, or environment error.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const VERSION = '1.0.0'
const HELP = `Usage: node verify-doc-budgets.mjs [--root <dir>] [--manifest <file>] [--list]
         [--base <git-ref> [--allow-ceiling-change]]

Enforce word-count ceilings on standing documents (AGENTS.md, architecture docs, SKILL.md).

Options:
  --root <dir>              Repository root that manifest paths are relative to (default: cwd).
  --manifest <file>         Manifest path, relative to --root unless absolute
                            (default: scripts/governance/doc-budgets.manifest.json).
  --list                    Print usage per document and exit 0 even when over budget.
  --base <git-ref>          Also fail when, relative to the merge-base of <git-ref> and HEAD,
                            a ceiling rose or a budgeted entry left the manifest.
  --allow-ceiling-change    With --base, report those changes without failing. Pass it only
                            for a reviewed change that justifies the new ceiling.
  --version                 Print the version.
  -h, --help                Show this help.

Manifest format (keys starting with "//" or "$" are ignored as comments):
  { "AGENTS.md": 1200, "docs/architecture.md": 2400 }

When a document goes over budget: relocate content to its owning home first, condense second,
and raise the ceiling only with a justification in the pull request.

Exit codes: 0 ok, 1 over budget, missing file, or unapproved ceiling change, 2 usage, manifest, or environment error.`

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu
const CJK_PUNCTUATION_ONLY = /^[\u3000-\u303f\uff00-\uff65]+$/u

class UsageError extends Error {}

/**
 * Count words: whitespace-delimited tokens, with each CJK character counted separately.
 * @param {string} text - document text.
 * @returns {number} word count.
 */
function countWords(text) {
  return text
    .replace(CJK, ' x ')
    .split(/\s+/u)
    .filter(token => token.length > 0 && !CJK_PUNCTUATION_ONLY.test(token))
    .length
}

function parseArgs(argv) {
  const options = { root: process.cwd(), manifest: 'scripts/governance/doc-budgets.manifest.json', list: false, base: undefined, allowCeilingChange: false, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--version') options.version = true
    else if (arg === '--list') options.list = true
    else if (arg === '--allow-ceiling-change') options.allowCeilingChange = true
    else if (arg === '--root' || arg === '--manifest' || arg === '--base') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) throw new UsageError(`${arg} requires a value${value?.startsWith('-') ? `, not an option: ${value}` : ''}`)
      options[arg.slice(2)] = value
    } else throw new UsageError(`unknown argument: ${arg}`)
  }
  if (options.allowCeilingChange && options.base === undefined) throw new UsageError('--allow-ceiling-change only applies with --base')
  return options
}

/** Validate a parsed manifest and return its [path, ceiling] entries. */
function manifestEntries(value, what) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UsageError(`${what} must be a JSON object mapping paths to ceilings`)
  }
  const entries = Object.entries(value).filter(([key]) => !key.startsWith('//') && !key.startsWith('$'))
  if (entries.length === 0) throw new UsageError(`${what} lists no documents`)
  for (const [path, ceiling] of entries) {
    if (!Number.isSafeInteger(ceiling) || ceiling <= 0) {
      throw new UsageError(`${path}: ceiling must be a positive integer, got ${JSON.stringify(ceiling)}`)
    }
    if (isAbsolute(path) || path.split(/[\\/]/u).includes('..')) {
      throw new UsageError(`${path}: manifest paths must be relative and stay inside --root`)
    }
  }
  return entries
}

function parseManifest(text, what) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message}`)
  }
  return manifestEntries(value, what)
}

function readText(path, what) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new UsageError(`cannot read ${what} ${path}: ${error.message}`)
  }
}

function git(root, args, quiet = false) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (quiet) return null
    if (error.code === 'ENOENT') throw new UsageError('--base needs git, which is not installed or not on PATH')
    const stderr = String(error.stderr ?? '').trim()
    if (/not a git repository/iu.test(stderr)) throw new UsageError(`--base needs a Git work tree; ${root} is not one`)
    throw new UsageError(`git ${args[0]} failed: ${stderr || error.message}`)
  }
}

/** The manifest at the merge-base of <ref> and HEAD, or null when it did not exist there. */
function baseManifest(root, ref, manifestRel) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') throw new UsageError(`--base needs a Git work tree; ${root} is not one`)
  const oid = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], true)
  if (oid === null) throw new UsageError(`--base ${ref} does not name a commit (fetch it first, e.g. git fetch origin)`)
  const mergeBase = git(root, ['merge-base', oid.trim(), 'HEAD']).trim()
  if (git(root, ['cat-file', '-e', `${mergeBase}:./${manifestRel}`], true) === null) return null
  return parseManifest(git(root, ['show', `${mergeBase}:./${manifestRel}`]), `manifest at ${ref}`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return 0
  }
  if (options.version) {
    console.log(`verify-doc-budgets (sustainable-engineering) ${VERSION}`)
    return 0
  }
  const root = resolve(options.root)
  const manifestPath = resolve(root, options.manifest)
  if (!existsSync(manifestPath)) throw new UsageError(`manifest not found: ${manifestPath}`)
  const entries = parseManifest(readText(manifestPath, 'manifest'), `manifest ${manifestPath}`)
  const manifestLabel = relative(root, manifestPath) || manifestPath

  const rows = []
  const failures = []
  for (const [path, ceiling] of entries) {
    const file = resolve(root, path)
    let isFile
    try {
      isFile = existsSync(file) && statSync(file).isFile()
    } catch (error) {
      throw new UsageError(`cannot stat ${path}: ${error.message}`)
    }
    if (!isFile) {
      rows.push(`MISS  ${'-'.padStart(6)} / ${String(ceiling).padEnd(6)}       ${path}`)
      failures.push(`${path}: budgeted file does not exist (renamed or deleted? update ${manifestLabel} in the same change)`)
      continue
    }
    const words = countWords(readText(file, 'document'))
    const percent = `${Math.round((words / ceiling) * 100)}%`.padStart(5)
    rows.push(`${words <= ceiling ? 'ok  ' : 'OVER'}  ${String(words).padStart(6)} / ${String(ceiling).padEnd(6)} ${percent} ${path}`)
    if (words > ceiling) {
      failures.push(`${path}: ${words} words exceeds the ${ceiling}-word ceiling; relocate content to its owning home, then condense; raise the ceiling only with a written justification`)
    }
  }

  const changes = []
  if (options.base !== undefined) {
    const manifestRel = relative(root, manifestPath).split(sep).join('/')
    if (manifestRel.startsWith('..') || isAbsolute(manifestRel)) throw new UsageError('--base needs the manifest inside --root')
    const before = baseManifest(root, options.base, manifestRel)
    const now = new Map(entries)
    for (const [path, ceiling] of before ?? []) {
      if (!now.has(path)) changes.push(`${path}: budgeted at ${ceiling} in ${options.base}, but this change removes its entry`)
      else if (now.get(path) > ceiling) changes.push(`${path}: ceiling rose from ${ceiling} to ${now.get(path)}`)
    }
  }

  if (options.list) {
    console.log(rows.join('\n'))
    for (const change of changes) console.log(`note: ${change}`)
    return 0
  }
  if (changes.length > 0 && options.allowCeilingChange) {
    console.log(`verify-doc-budgets: ceiling changes allowed by --allow-ceiling-change (justify them in the pull request):`)
    for (const change of changes) console.log(`  ${change}`)
  } else if (changes.length > 0) {
    failures.push(...changes.map(change => `${change}; relocate or condense instead, or pass --allow-ceiling-change in a reviewed change that justifies it`))
  }
  if (failures.length > 0) {
    console.error('verify-doc-budgets failed:')
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.log(`verify-doc-budgets: ${entries.length} budgeted document(s) within ceiling.`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`verify-doc-budgets: ${error.message}\nRun with --help for usage.`)
    process.exitCode = 2
  } else throw error
}
