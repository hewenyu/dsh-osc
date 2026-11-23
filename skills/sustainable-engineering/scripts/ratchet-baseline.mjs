#!/usr/bin/env node
// sustainable-engineering v1.0.0
/**
 * ratchet-baseline: freeze existing violations of a rule and reject every new one.
 *
 * A regex rule matches one line at a time, or the whole file with `"multiline": true`; an
 * external rule takes findings from another linter through `--findings <json>`. A finding is
 * keyed by its repository path and a fingerprint of its rule id plus the matched text with
 * whitespace collapsed, with an exact count per fingerprint. Fixing a recorded finding leaves a
 * stale entry that blocks the check until `--prune` retires it, so the baseline only shrinks.
 * `--base <ref>` compares the config and baseline with the merge-base of <ref> and HEAD and fails
 * on any loosening; `--prune --base <ref>` carries allowances along files the change adds or
 * renames. No command adds an allowance to a recorded rule. Zero dependencies; Node.js >= 18.
 *
 * Exit codes: 0 clean, 1 new, stale, unrecorded, or loosened findings, 2 usage, config, or
 * environment error.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const VERSION = '1.0.0'
const HELP = `Usage: node ratchet-baseline.mjs [--root <dir>] [--config <file>] [--findings <file>]
         [--base <git-ref>] [--init | --init-rule <id> | --prune | --list]

Freeze legacy violations, reject new ones, and let the recorded count only go down.

Modes:
  (none)            Check: exit 1 on a finding the baseline does not record, a recorded
                    finding that no longer exists (run --prune in that change), or a
                    configured rule missing from the baseline (run --init-rule).
  --prune           Retire stale entries. Refuses (exit 1) while any new finding exists.
                    With --base, first carries each allowance whose line moved verbatim into
                    a file this change adds or renames (git mv, extraction into a new file).
  --init            Create the baseline from current findings. Refuses (exit 2) if it exists.
  --init-rule <id>  Record the current findings of a rule newly added to the config.
                    Refuses (exit 2) if the baseline already records that rule.
  --list            Print findings and scanned-file counts per rule; exit 0.

Options:
  --root <dir>        Repository root (default: cwd).
  --config <file>     Config path relative to --root (default: scripts/governance/ratchet.config.json).
  --findings <file>   JSON array of {"rule", "file", "text"} (or "line" instead of "text")
                      from an external linter, for rules declared "external": true.
  --base <git-ref>    Check: also fail when, relative to the merge-base of <git-ref> and HEAD,
                      a recorded rule gained a fingerprint or count, left the config or
                      baseline, changed its pattern, lost an include glob, or gained an
                      exclude glob. Prune: resolve moves against the same merge-base.
  --version           Print the version.
  -h, --help          Show this help.

Config format:
  {
    "baseline": "scripts/governance/ratchet.baseline.json",
    "exclude": ["vendor/**", "**/*.min.js"],
    "rules": [
      { "id": "no-any-cast", "pattern": "\\\\bas\\\\s+any\\\\b", "flags": "",
        "include": ["src/**/*.ts"], "exclude": ["**/*.d.ts"],
        "mustMatch": ["const x = y as any"], "mustNotMatch": ["const x = y as unknown"],
        "message": "Use a typed value or validate at the boundary instead of 'as any'." },
      { "id": "no-silent-except", "multiline": true, "allowEmpty": true,
        "pattern": "^[ \\\\t]*except\\\\b[^:\\\\n]*:\\\\s*pass\\\\b", "include": ["**/*.py"] },
      { "id": "ruff-s110", "external": true, "message": "try-except-pass" },
      { "id": "old-rule", "retired": "superseded by ruff-s110 (link the note)" }
    ]
  }

  multiline     Match the whole file (flags gm); the fingerprint is the matched text.
  allowEmpty    Permit a rule whose include globs select no files. Without it, a rule
                that scans zero files is a configuration error (exit 2).
  mustMatch     Sample texts the pattern must match / must not match; checked on every
  mustNotMatch  run, and a failing sample is a configuration error (exit 2).
  external      Findings come only from --findings.
  retired       Reason the rule no longer runs; its baseline entry stays as {}.

Files come from 'git ls-files --cached --others --exclude-standard' inside a Git work tree,
otherwise from a directory walk that skips .git and node_modules. Symbolic links are skipped.

There is deliberately no command that adds an allowance to a recorded rule: fix the new
finding, or adopt a new rule id in a reviewed config change.

Exit codes: 0 ok, 1 new, stale, unrecorded, or loosened findings, 2 usage, config, or environment error.`

const RULE_KEYS = new Set(['id', 'pattern', 'flags', 'multiline', 'include', 'exclude', 'message', 'allowEmpty', 'mustMatch', 'mustNotMatch', 'external', 'retired'])
const CONFIG_KEYS = new Set(['baseline', 'exclude', 'rules'])

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { root: process.cwd(), config: 'scripts/governance/ratchet.config.json', findings: undefined, base: undefined, mode: 'check', rule: undefined, help: false, version: false }
  const setMode = (mode) => {
    if (options.mode !== 'check') throw new UsageError(`choose one mode; got --${options.mode} and --${mode}`)
    options.mode = mode
  }
  const value = (arg, index) => {
    const next = argv[index]
    if (next === undefined || next.startsWith('-')) throw new UsageError(`${arg} requires a value`)
    return next
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--version') options.version = true
    else if (arg === '--prune') setMode('prune')
    else if (arg === '--init') setMode('init')
    else if (arg === '--list') setMode('list')
    else if (arg === '--init-rule') {
      setMode('init-rule')
      options.rule = value(arg, ++i)
    } else if (['--root', '--config', '--findings', '--base'].includes(arg)) options[arg.slice(2)] = value(arg, ++i)
    else throw new UsageError(`unknown argument: ${arg}`)
  }
  if (options.base !== undefined && !['check', 'prune'].includes(options.mode)) {
    throw new UsageError('--base applies to the check and --prune modes only')
  }
  return options
}

/**
 * Translate a glob (`**`, `*`, `?`, `{a,b}`) into a regular-expression source matching
 * forward-slash repository paths.
 * @param {string} glob - glob pattern.
 * @returns {string} regular-expression source without anchors.
 */
function globSource(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else if (char === '{') {
      const close = glob.indexOf('}', i)
      if (close === -1) throw new UsageError(`unclosed "{" in glob: ${glob}`)
      source += `(?:${glob.slice(i + 1, close).split(',').map(globSource).join('|')})`
      i = close
    } else source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  }
  return source
}

function compileGlobs(globs, field) {
  if (globs === undefined) return []
  if (!Array.isArray(globs) || globs.some(glob => typeof glob !== 'string' || glob.length === 0)) {
    throw new UsageError(`${field} must be an array of non-empty glob strings`)
  }
  return globs.map(glob => new RegExp(`^${globSource(glob)}$`, 'u'))
}

function readJson(path, what) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new UsageError(`cannot read ${what} ${path}: ${error.message}`)
  }
  return parseJson(text, `${what} ${path}`)
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message}`)
  }
}

const isObject = item => typeof item === 'object' && item !== null && !Array.isArray(item)
const isComment = key => key.startsWith('//') || key.startsWith('$')

/** Count matches of a compiled rule in a text, line by line or across the whole text. */
function countMatches(rule, text) {
  if (rule.multiline) return [...text.matchAll(rule.regex)].length
  return text.split(/\r?\n/u).reduce((sum, line) => sum + [...line.matchAll(rule.regex)].length, 0)
}

function compileRule(rule, index) {
  const where = `config.rules[${index}]`
  if (!isObject(rule)) throw new UsageError(`${where} must be an object`)
  if (typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(rule.id)) throw new UsageError(`${where}.id must be kebab-case`)
  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.has(key) && !isComment(key)) throw new UsageError(`${where} (${rule.id}) has an unknown field "${key}"`)
  }
  const message = typeof rule.message === 'string' ? rule.message : `violates ${rule.id}`
  if (rule.retired !== undefined) {
    if (typeof rule.retired !== 'string' || rule.retired.trim() === '') throw new UsageError(`${where}.retired must state the reason the rule no longer runs`)
    return { id: rule.id, kind: 'retired', reason: rule.retired, message }
  }
  if (rule.external !== undefined && rule.external !== true) throw new UsageError(`${where}.external must be true when present`)
  if (rule.external) {
    for (const key of ['pattern', 'include', 'multiline', 'mustMatch', 'mustNotMatch']) {
      if (rule[key] !== undefined) throw new UsageError(`${where} is external; "${key}" belongs to regex rules`)
    }
    return { id: rule.id, kind: 'external', message }
  }
  if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) throw new UsageError(`${where}.pattern must be a non-empty string`)
  const flags = rule.flags ?? ''
  if (typeof flags !== 'string' || /[gy]/u.test(flags)) throw new UsageError(`${where}.flags must be a string without g or y`)
  for (const key of ['multiline', 'allowEmpty']) {
    if (rule[key] !== undefined && typeof rule[key] !== 'boolean') throw new UsageError(`${where}.${key} must be true or false`)
  }
  const multiline = rule.multiline === true
  const allFlags = [...new Set(`${flags}g${multiline ? 'm' : ''}`)].join('')
  let regex
  try {
    regex = new RegExp(rule.pattern, allFlags)
  } catch (error) {
    throw new UsageError(`${where}.pattern is not a valid regular expression: ${error.message}`)
  }
  if (new RegExp(rule.pattern, allFlags.replace('g', '')).test('')) throw new UsageError(`${where}.pattern matches the empty string`)
  const include = compileGlobs(rule.include, `${where}.include`)
  if (include.length === 0) throw new UsageError(`${where}.include must list at least one glob`)
  const compiled = {
    id: rule.id,
    kind: 'regex',
    regex,
    multiline,
    allowEmpty: rule.allowEmpty === true,
    include,
    exclude: compileGlobs(rule.exclude, `${where}.exclude`),
    message,
  }
  for (const [key, wanted] of [['mustMatch', true], ['mustNotMatch', false]]) {
    const samples = rule[key]
    if (samples === undefined) continue
    if (!Array.isArray(samples) || samples.some(sample => typeof sample !== 'string')) throw new UsageError(`${where}.${key} must be an array of strings`)
    for (const sample of samples) {
      if ((countMatches(compiled, sample) > 0) !== wanted) {
        throw new UsageError(`rule ${rule.id} fails its self-test: ${key} sample ${JSON.stringify(sample)} ${wanted ? 'does not match' : 'matches'}`)
      }
    }
  }
  return compiled
}

function loadConfig(root, configPath) {
  if (!existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`)
  const raw = readJson(configPath, 'config')
  if (!isObject(raw)) throw new UsageError('config must be a JSON object')
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key) && !isComment(key)) throw new UsageError(`config has an unknown field "${key}"`)
  }
  if (typeof raw.baseline !== 'string' || raw.baseline.length === 0) throw new UsageError('config.baseline must name the baseline file')
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) throw new UsageError('config.rules must be a non-empty array')
  const ids = new Set()
  const rules = raw.rules.map((rule, index) => {
    const compiled = compileRule(rule, index)
    if (ids.has(compiled.id)) throw new UsageError(`duplicate rule id: ${compiled.id}`)
    ids.add(compiled.id)
    return compiled
  })
  const baselinePath = resolve(root, raw.baseline)
  return {
    raw,
    baselinePath,
    exclude: compileGlobs(raw.exclude, 'config.exclude'),
    rules,
    ownFiles: new Set([toRepoPath(root, configPath), toRepoPath(root, baselinePath)]),
  }
}

function toRepoPath(root, path) {
  return relative(root, path).split(sep).join('/')
}

/** Run git; a missing binary or a failing command is an environment error (exit 2). */
function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError('git is not installed or not on PATH')
    throw new UsageError(`git ${args[0]} failed: ${String(error.stderr || error.message).trim()}`)
  }
}

/** True inside a Git work tree, false when git is absent or the root is not a repository. */
function isGitWorkTree(root) {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'true'
  } catch (error) {
    if (error.code === 'ENOENT') return false
    const stderr = String(error.stderr ?? '')
    if (/not a git repository/iu.test(stderr)) return false
    throw new UsageError(`git rev-parse failed in ${root}: ${stderr.trim() || error.message}`)
  }
}

function listFiles(root) {
  if (isGitWorkTree(root)) {
    const output = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    return [...new Set(output.split('\0').filter(Boolean))].sort()
  }
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(toRepoPath(root, path))
    }
  }
  walk(root)
  return files.sort()
}

/** Resolve --base to the merge-base of the ref and HEAD, rejecting option-shaped refs. */
function resolveBase(root, ref) {
  if (ref.startsWith('-')) throw new UsageError(`--base must name a commit, not an option: ${ref}`)
  if (!isGitWorkTree(root)) throw new UsageError(`--base needs a Git work tree; ${root} is not one`)
  let oid
  try {
    oid = execFileSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    throw new UsageError(`--base ${ref} does not name a commit (fetch it first, e.g. git fetch origin)`)
  }
  return git(root, ['merge-base', oid, 'HEAD']).trim()
}

/** File content at a commit, or null when the path does not exist there. */
function gitShow(root, rev, path) {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}:./${path}`], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    return null
  }
  return git(root, ['show', `${rev}:./${path}`])
}

function fingerprint(ruleId, text) {
  return createHash('sha256').update(`${ruleId}\0${text.trim().replace(/\s+/gu, ' ')}`).digest('hex').slice(0, 16)
}

function readFindings(root, path, config) {
  const file = resolve(root, path)
  const value = readJson(file, 'findings')
  if (!Array.isArray(value)) throw new UsageError('findings must be a JSON array of {"rule", "file", "text" | "line"}')
  const external = new Map(config.rules.filter(rule => rule.kind === 'external').map(rule => [rule.id, rule]))
  if (external.size === 0) throw new UsageError('--findings needs at least one rule with "external": true in the config')
  const sources = new Map()
  return value.map((entry, index) => {
    const where = `findings[${index}]`
    if (!isObject(entry)) throw new UsageError(`${where} must be an object`)
    const rule = external.get(entry.rule)
    if (!rule) throw new UsageError(`${where}.rule ${JSON.stringify(entry.rule)} is not an external rule in the config`)
    if (typeof entry.file !== 'string' || entry.file.length === 0) throw new UsageError(`${where}.file must be a path`)
    let repoPath = toRepoPath(root, resolve(root, entry.file))
    if (isAbsolute(entry.file) && (repoPath.startsWith('..') || isAbsolute(repoPath)) && existsSync(entry.file)) {
      repoPath = toRepoPath(realpathSync(root), realpathSync(entry.file))
    }
    if (repoPath === '' || repoPath.startsWith('..') || isAbsolute(repoPath)) throw new UsageError(`${where}.file is outside --root: ${entry.file}`)
    const line = entry.line
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) throw new UsageError(`${where}.line must be a positive integer`)
    let text = entry.text
    if (text !== undefined && typeof text !== 'string') throw new UsageError(`${where}.text must be a string`)
    if (text === undefined) {
      if (line === undefined) throw new UsageError(`${where} needs "text" or "line"`)
      if (!sources.has(repoPath)) {
        let content
        try {
          content = readFileSync(join(root, repoPath), 'utf8')
        } catch (error) {
          throw new UsageError(`${where}.file cannot be read: ${error.message}`)
        }
        sources.set(repoPath, content.split(/\r?\n/u))
      }
      text = sources.get(repoPath)[line - 1]
      if (text === undefined) throw new UsageError(`${where}.line ${line} is past the end of ${repoPath}`)
    }
    return { rule, file: repoPath, line: line ?? 0, key: fingerprint(rule.id, text), text: text.trim() }
  })
}

/**
 * Scan the repository. Returns counts (rule -> file -> fingerprint -> count), every finding's
 * location, and the number of files each regex rule scanned.
 */
function scan(root, config, findingsPath) {
  const active = config.rules.filter(rule => rule.kind !== 'retired')
  const counts = Object.fromEntries(active.map(rule => [rule.id, {}]))
  const scanned = Object.fromEntries(active.filter(rule => rule.kind === 'regex').map(rule => [rule.id, 0]))
  const locations = []
  const record = (location) => {
    const byFile = counts[location.rule.id][location.file] ??= {}
    byFile[location.key] = (byFile[location.key] ?? 0) + 1
    locations.push(location)
  }
  const regexRules = active.filter(rule => rule.kind === 'regex')
  for (const file of listFiles(root)) {
    if (config.ownFiles.has(file) || config.exclude.some(glob => glob.test(file))) continue
    const rules = regexRules.filter(rule => rule.include.some(glob => glob.test(file)) && !rule.exclude.some(glob => glob.test(file)))
    if (rules.length === 0) continue
    const path = join(root, file)
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (!stat?.isFile()) continue
    let buffer
    try {
      buffer = readFileSync(path)
    } catch (error) {
      throw new UsageError(`cannot read ${file}: ${error.message}`)
    }
    if (buffer.subarray(0, 8192).includes(0)) continue
    const text = buffer.toString('utf8')
    const lines = text.split(/\r?\n/u)
    for (const rule of rules) {
      scanned[rule.id]++
      if (rule.multiline) {
        for (const match of text.matchAll(rule.regex)) {
          const line = text.slice(0, match.index).split('\n').length
          const matched = match[0].trim() === '' ? lines[line - 1] : match[0]
          record({ rule, file, line, key: fingerprint(rule.id, matched), text: matched.trim().replace(/\s+/gu, ' ') })
        }
        continue
      }
      lines.forEach((line, index) => {
        const matches = [...line.matchAll(rule.regex)].length
        for (let n = 0; n < matches; n++) record({ rule, file, line: index + 1, key: fingerprint(rule.id, line), text: line.trim() })
      })
    }
  }
  const external = active.filter(rule => rule.kind === 'external')
  if (findingsPath !== undefined) {
    for (const location of readFindings(root, findingsPath, config)) record(location)
  } else if (external.length > 0) {
    throw new UsageError(`rule(s) ${external.map(rule => rule.id).join(', ')} are external; pass --findings <file>`)
  }
  return { counts: sortDeep(counts), locations, scanned }
}

function sortDeep(value) {
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortDeep(value[key])]))
}

function validateBaseline(value, what) {
  if (!isObject(value)) throw new UsageError(`${what} must map rule ids to file entries`)
  for (const [ruleId, files] of Object.entries(value)) {
    if (!isObject(files)) throw new UsageError(`${what} rule ${ruleId} must map files to fingerprint counts`)
    for (const [file, prints] of Object.entries(files)) {
      if (file.startsWith('/') || file.includes('\\') || file.split('/').includes('..') || !isObject(prints) || Object.keys(prints).length === 0) {
        throw new UsageError(`${what} rule ${ruleId} has an invalid file entry: ${file}`)
      }
      for (const [key, count] of Object.entries(prints)) {
        if (!/^[a-f0-9]{16}$/u.test(key) || !Number.isSafeInteger(count) || count <= 0) {
          throw new UsageError(`${what} rule ${ruleId} has an invalid count: ${file}:${key}`)
        }
      }
    }
  }
  return value
}

function writeBaseline(path, counts) {
  try {
    writeFileSync(path, `${JSON.stringify(sortDeep(counts), null, 2)}\n`)
  } catch (error) {
    throw new UsageError(`cannot write baseline ${path}: ${error.message}`)
  }
}

/** Match findings against allowances; returns findings without allowance and unused allowances. */
function compare(baseline, locations, config) {
  const remaining = structuredClone(baseline)
  const added = []
  for (const location of locations) {
    const byFile = remaining[location.rule.id]?.[location.file]
    const allowance = byFile?.[location.key] ?? 0
    if (allowance > 0) byFile[location.key] = allowance - 1
    else added.push(location)
  }
  const configured = new Set(config.rules.map(rule => rule.id))
  const stale = []
  for (const [ruleId, files] of Object.entries(remaining)) {
    if (!configured.has(ruleId)) continue
    for (const [file, prints] of Object.entries(files)) {
      for (const [key, count] of Object.entries(prints)) {
        if (count > 0) stale.push({ ruleId, file, key, count })
      }
    }
  }
  return { added, stale }
}

function total(counts) {
  let sum = 0
  for (const files of Object.values(counts)) for (const prints of Object.values(files)) for (const count of Object.values(prints)) sum += count
  return sum
}

/** Rules recorded in one place but not the other: both block check and prune. */
function structureProblems(baseline, config) {
  const problems = []
  for (const rule of config.rules) {
    if (!Object.hasOwn(baseline, rule.id)) {
      problems.push(rule.kind === 'retired'
        ? `rule ${rule.id} is retired but absent from the baseline; restore its entry as {}`
        : `rule ${rule.id} is configured but not recorded in the baseline; adopt it in this change with --init-rule ${rule.id}`)
    }
  }
  const configured = new Set(config.rules.map(rule => rule.id))
  for (const ruleId of Object.keys(baseline)) {
    if (!configured.has(ruleId)) problems.push(`rule ${ruleId} is recorded but no longer configured; keep it in the config as { "id": "${ruleId}", "retired": "<reason>" }`)
  }
  return problems
}

/** Per-fingerprint totals across files for one rule's baseline entry. */
function totalsByFingerprint(files) {
  const totals = new Map()
  for (const prints of Object.values(files ?? {})) for (const [key, count] of Object.entries(prints)) totals.set(key, (totals.get(key) ?? 0) + count)
  return totals
}

/**
 * Everything this change loosens relative to the config and baseline at the merge-base. When the
 * config path is new (a relocated config), the baseline at the current baseline path still
 * anchors the comparison. `found` is false when no baseline existed at the merge-base.
 */
function loosening(root, mergeBase, configRel, config, baseline) {
  const baseText = gitShow(root, mergeBase, configRel)
  let baseConfig = null
  if (baseText !== null) {
    baseConfig = parseJson(baseText, `config at the base commit (${configRel})`)
    if (!isObject(baseConfig) || typeof baseConfig.baseline !== 'string' || !Array.isArray(baseConfig.rules)) {
      throw new UsageError(`config at the base commit (${configRel}) is malformed`)
    }
  }
  const baseBaselinePath = baseConfig ? baseConfig.baseline : toRepoPath(root, config.baselinePath)
  const baseBaselineText = gitShow(root, mergeBase, baseBaselinePath)
  if (baseBaselineText === null) return { problems: [], found: false }
  const baseBaseline = validateBaseline(parseJson(baseBaselineText, `baseline at the base commit (${baseBaselinePath})`), 'baseline at the base commit')
  const problems = []
  const baseRules = new Map((baseConfig?.rules ?? []).filter(isObject).map(rule => [rule.id, rule]))
  const rules = new Map(config.raw.rules.map(rule => [rule.id, rule]))
  if (baseConfig) {
    const baseExclude = baseConfig.exclude ?? []
    for (const glob of config.raw.exclude ?? []) {
      if (!baseExclude.includes(glob)) problems.push(`config.exclude gained "${glob}"`)
    }
  }
  for (const [ruleId, baseFiles] of Object.entries(baseBaseline)) {
    const rule = rules.get(ruleId)
    if (!rule) {
      problems.push(`rule ${ruleId} was removed from the config; keep it as { "id": "${ruleId}", "retired": "<reason>" }`)
      continue
    }
    if (!Object.hasOwn(baseline, ruleId)) {
      problems.push(`rule ${ruleId} was removed from the baseline`)
      continue
    }
    const baseRule = baseRules.get(ruleId)
    if (baseRule && baseRule.retired === undefined && rule.retired === undefined) {
      for (const [field, normalize] of [['pattern', v => v], ['flags', v => v ?? ''], ['multiline', v => v === true], ['external', v => v === true]]) {
        if (normalize(baseRule[field]) !== normalize(rule[field])) problems.push(`rule ${ruleId}: "${field}" changed; adopt a new rule id instead of redefining a recorded one`)
      }
      for (const glob of baseRule.include ?? []) {
        if (!(rule.include ?? []).includes(glob)) problems.push(`rule ${ruleId}: include lost "${glob}"`)
      }
      for (const glob of rule.exclude ?? []) {
        if (!(baseRule.exclude ?? []).includes(glob)) problems.push(`rule ${ruleId}: exclude gained "${glob}"`)
      }
      if (baseRule.allowEmpty !== true && rule.allowEmpty === true) problems.push(`rule ${ruleId}: allowEmpty was turned on`)
    }
    const before = totalsByFingerprint(baseFiles)
    for (const [key, count] of totalsByFingerprint(baseline[ruleId])) {
      const was = before.get(key)
      if (was === undefined) problems.push(`rule ${ruleId}: new fingerprint ${key} x${count}`)
      else if (count > was) problems.push(`rule ${ruleId}: fingerprint ${key} rose from ${was} to ${count}`)
    }
  }
  return { problems, found: true }
}

/** Files this change adds or renames relative to the merge-base: new path -> old path or null. */
function movedTargets(root, mergeBase) {
  const targets = new Map()
  const fields = git(root, ['diff', '--name-status', '-M', '--no-ext-diff', '--relative', '-z', mergeBase, '--']).split('\0')
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i]
    if (/^[RC]/u.test(status)) {
      if (status.startsWith('R')) targets.set(fields[i + 2], fields[i + 1])
      i += 3
    } else {
      if (status === 'A') targets.set(fields[i + 1], null)
      i += 2
    }
  }
  for (const path of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    if (!targets.has(path)) targets.set(path, null)
  }
  return targets
}

/**
 * Carry allowances whose finding moved verbatim into a file the change adds or renames. Each
 * transfer takes an unused allowance with the same rule and fingerprint, preferring the rename
 * source, so per-fingerprint totals never grow.
 */
function rekeyMoves(baseline, locations, targets) {
  const result = structuredClone(baseline)
  const found = {}
  for (const location of locations) {
    const byFile = (found[location.rule.id] ??= {})[location.file] ??= {}
    byFile[location.key] = (byFile[location.key] ?? 0) + 1
  }
  let moved = 0
  const ordered = [...targets.keys()].sort((a, b) => Number(targets.get(b) !== null) - Number(targets.get(a) !== null) || a.localeCompare(b))
  for (const [ruleId, files] of Object.entries(found)) {
    if (!result[ruleId]) continue
    for (const target of ordered) {
      for (const [key, count] of Object.entries(files[target] ?? {})) {
        let need = count - (result[ruleId][target]?.[key] ?? 0)
        const source = targets.get(target)
        const sources = [...new Set([source, ...Object.keys(result[ruleId]).sort()])].filter(path => path && path !== target)
        for (const from of sources) {
          if (need <= 0) break
          const spare = (result[ruleId][from]?.[key] ?? 0) - (files[from]?.[key] ?? 0)
          if (spare <= 0) continue
          const take = Math.min(need, spare)
          result[ruleId][from][key] -= take
          if (result[ruleId][from][key] === 0) delete result[ruleId][from][key]
          if (Object.keys(result[ruleId][from]).length === 0) delete result[ruleId][from]
          const into = result[ruleId][target] ??= {}
          into[key] = (into[key] ?? 0) + take
          need -= take
          moved += take
        }
      }
    }
  }
  return { baseline: result, moved }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return 0
  }
  if (options.version) {
    console.log(`ratchet-baseline (sustainable-engineering) ${VERSION}`)
    return 0
  }
  const root = resolve(options.root)
  const configPath = resolve(root, options.config)
  const config = loadConfig(root, configPath)
  if (options.findings !== undefined) config.ownFiles.add(toRepoPath(root, resolve(root, options.findings)))
  const { counts, locations, scanned } = scan(root, config, options.findings)
  const baselineLabel = toRepoPath(root, config.baselinePath)

  if (options.mode === 'list') {
    for (const rule of config.rules) {
      if (rule.kind === 'retired') {
        console.log(`${rule.id}: retired (${rule.reason})`)
        continue
      }
      const scope = rule.kind === 'external' ? 'from --findings' : `in ${scanned[rule.id]} scanned file(s)${scanned[rule.id] === 0 ? (rule.allowEmpty ? ', allowEmpty' : ', EMPTY SCOPE') : ''}`
      console.log(`${rule.id}: ${total({ [rule.id]: counts[rule.id] })} finding(s) ${scope}`)
      for (const [file, prints] of Object.entries(counts[rule.id])) console.log(`  ${String(Object.values(prints).reduce((a, b) => a + b, 0)).padStart(5)}  ${file}`)
    }
    return 0
  }

  const empty = config.rules.filter(rule => rule.kind === 'regex' && scanned[rule.id] === 0 && !rule.allowEmpty)
  if (empty.length > 0) {
    throw new UsageError(`rule(s) ${empty.map(rule => rule.id).join(', ')} scanned zero files; fix the include globs, or set "allowEmpty": true for a rule that is optional in this repository`)
  }

  if (options.mode === 'init') {
    if (existsSync(config.baselinePath)) {
      throw new UsageError(`${baselineLabel} already exists; --init only creates a first baseline. No command adds allowances: fix the new finding instead.`)
    }
    const initial = { ...counts, ...Object.fromEntries(config.rules.filter(rule => rule.kind === 'retired').map(rule => [rule.id, {}])) }
    writeBaseline(config.baselinePath, initial)
    console.log(`ratchet-baseline: recorded ${total(initial)} existing finding(s) for ${config.rules.length} rule(s) in ${baselineLabel}. New findings now fail; the count can only go down.`)
    return 0
  }

  if (!existsSync(config.baselinePath)) throw new UsageError(`baseline not found: ${baselineLabel} (run --init once when adopting the ratchet)`)
  const baseline = validateBaseline(readJson(config.baselinePath, 'baseline'), 'baseline')

  if (options.mode === 'init-rule') {
    const rule = config.rules.find(item => item.id === options.rule)
    if (!rule) throw new UsageError(`rule ${options.rule} is not in the config`)
    if (rule.kind === 'retired') throw new UsageError(`rule ${options.rule} is retired; adopt a new rule id instead`)
    if (Object.hasOwn(baseline, options.rule)) {
      throw new UsageError(`baseline already records rule ${options.rule}; no command adds allowances to a recorded rule.`)
    }
    baseline[options.rule] = counts[options.rule]
    writeBaseline(config.baselinePath, baseline)
    console.log(`ratchet-baseline: recorded ${total({ [options.rule]: counts[options.rule] })} existing finding(s) for new rule ${options.rule}.`)
    return 0
  }

  const mergeBase = options.base === undefined ? undefined : resolveBase(root, options.base)
  const problems = structureProblems(baseline, config)

  if (options.mode === 'prune') {
    if (problems.length > 0) {
      console.error(`ratchet-baseline: --prune refused; the config and ${baselineLabel} disagree:`)
      for (const problem of problems) console.error(`  ${problem}`)
      return 1
    }
    const rekeyed = mergeBase === undefined ? { baseline, moved: 0 } : rekeyMoves(baseline, locations, movedTargets(root, mergeBase))
    const { added, stale } = compare(rekeyed.baseline, locations, config)
    if (added.length > 0) {
      console.error(`ratchet-baseline: ${added.length} new finding(s) not allowed by ${baselineLabel}:`)
      for (const item of added) console.error(`  ${item.file}:${item.line}  [${item.rule.id}] ${item.rule.message}\n      ${item.text}`)
      console.error('\nFix each new finding. --prune refused: the baseline was not modified.')
      return 1
    }
    const pruned = Object.fromEntries(config.rules.map(rule => [rule.id, rule.kind === 'retired' ? {} : counts[rule.id]]))
    const changed = rekeyed.moved > 0 || stale.length > 0
    if (changed) writeBaseline(config.baselinePath, pruned)
    const staleCount = stale.reduce((sum, item) => sum + item.count, 0)
    console.log(`ratchet-baseline: moved ${rekeyed.moved} allowance(s) with their files, pruned ${staleCount} stale finding(s); ${total(pruned)} recorded finding(s) remain.`)
    return 0
  }

  const { added, stale } = compare(baseline, locations, config)
  const history = mergeBase === undefined ? { problems: [], found: false } : loosening(root, mergeBase, toRepoPath(root, configPath), config, baseline)
  const loosened = history.problems
  if (problems.length > 0) {
    console.error(`ratchet-baseline: the config and ${baselineLabel} disagree:`)
    for (const problem of problems) console.error(`  ${problem}`)
  }
  if (loosened.length > 0) {
    console.error(`ratchet-baseline: this change loosens the ratchet relative to ${options.base} (merge-base ${mergeBase.slice(0, 12)}):`)
    for (const problem of loosened) console.error(`  ${problem}`)
    console.error('A recorded rule only tightens. Fix the findings, or retire the rule and adopt a new id in a reviewed change.')
  }
  if (added.length > 0) {
    console.error(`ratchet-baseline: ${added.length} new finding(s) not allowed by ${baselineLabel}:`)
    for (const item of added) console.error(`  ${item.file}:${item.line}  [${item.rule.id}] ${item.rule.message}\n      ${item.text}`)
    console.error('\nFix each new finding. Editing a recorded line also makes it new: fix it completely.')
    const staleKeys = new Set(stale.map(item => `${item.ruleId}\0${item.key}`))
    if (added.some(item => staleKeys.has(`${item.rule.id}\0${item.key}`))) {
      console.error('Some new findings match unused allowances elsewhere. If the code moved verbatim into a file this change adds or renames (git mv), run --prune --base <ref>.')
    }
  } else if (stale.length > 0) {
    console.error(`ratchet-baseline: ${stale.length} recorded finding(s) no longer exist. Ratchet down with --prune in this change:`)
    for (const item of stale) console.error(`  ${item.ruleId}: ${item.file} (${item.key}) x${item.count}`)
  }
  if (problems.length > 0 || loosened.length > 0 || added.length > 0 || stale.length > 0) return 1
  let since = ''
  if (mergeBase !== undefined) since = history.found ? `; nothing loosened since ${options.base}` : `; no base ratchet at ${options.base}; first-adoption check`
  console.log(`ratchet-baseline: no new findings; ${total(baseline)} recorded legacy finding(s) remain across ${config.rules.length} rule(s)${since}.`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`ratchet-baseline: ${error.message}\nRun with --help for usage.`)
    process.exitCode = 2
  } else throw error
}
