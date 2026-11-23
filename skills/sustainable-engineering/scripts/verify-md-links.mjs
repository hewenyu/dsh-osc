#!/usr/bin/env node
// sustainable-engineering v1.0.0
/**
 * verify-md-links: fail when a relative Markdown link points at a missing file or heading.
 *
 * Checks inline links and images (including balanced parentheses and destinations split across
 * lines) and reference definitions in every Markdown file under the root. Front matter, fenced and
 * indented code, inline code, HTML comments, and URLs with a scheme are ignored. Anchors resolve
 * against ATX and Setext headings with GitHub's slug rules (duplicates get -1, -2, ... against
 * every id already used, as github-slugger does) plus explicit `<a id|name>` targets. This is a
 * deliberately bounded Markdown subset, not a full CommonMark parser. Zero dependencies;
 * Node.js >= 18.
 *
 * Exit codes: 0 all links resolve, 1 broken links, 2 usage or environment error, or no files.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const VERSION = '1.0.0'
const HELP = `Usage: node verify-md-links.mjs [--root <dir>] [--exclude <glob>]... [--no-anchors] [--allow-empty]

Verify that relative links in Markdown files resolve to existing files and headings.

Options:
  --root <dir>      Directory to scan (default: cwd). Links may point outside it; a link
                    starting with "/" resolves from --root.
  --exclude <glob>  Skip Markdown files matching the glob (repeatable), e.g. "templates/**".
  --no-anchors      Check file targets only, not #heading anchors.
  --allow-empty     Exit 0 when no Markdown file is scanned (default: exit 2).
  --version         Print the version.
  -h, --help        Show this help.

Files come from 'git ls-files --cached --others --exclude-standard' inside a Git work tree,
otherwise from a directory walk that skips .git and node_modules. Symbolic links are not
scanned (their targets are, when inside --root); a link may still point at one.

Exit codes: 0 ok, 1 broken links, 2 usage or environment error, or zero files scanned.`

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { root: process.cwd(), exclude: [], anchors: true, allowEmpty: false, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--version') options.version = true
    else if (arg === '--no-anchors') options.anchors = false
    else if (arg === '--allow-empty') options.allowEmpty = true
    else if (arg === '--root' || arg === '--exclude') {
      const value = argv[++i]
      if (value === undefined) throw new UsageError(`${arg} requires a value`)
      if (arg === '--root') options.root = value
      else options.exclude.push(value)
    } else throw new UsageError(`unknown argument: ${arg}`)
  }
  return options
}

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

function listMarkdown(root) {
  if (isGitWorkTree(root)) {
    let output
    try {
      output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      throw new UsageError(`git ls-files failed: ${String(error.stderr || error.message).trim()}`)
    }
    return output.split('\0')
      .filter(path => /\.md$/iu.test(path) && lstatSync(join(root, path), { throwIfNoEntry: false })?.isFile())
      .sort()
  }
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && /\.md$/iu.test(entry.name)) files.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return files.sort()
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/u
const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u

/**
 * Blank everything that is not rendered prose: front matter, fenced and indented code blocks,
 * HTML comments, and inline code. Line count and positions are preserved. With keepCodeText,
 * inline code keeps its text and loses only its backticks, as a rendered heading does.
 */
function visibleText(text, { keepCodeText = false } = {}) {
  const lines = text.split(/\r?\n/u)
  let frontMatterEnd = 0
  if (lines[0] === '---') {
    const close = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'))
    if (close !== -1) frontMatterEnd = close + 1
  }
  const out = []
  let fence
  let inComment = false
  let inIndented = false
  let inList = false
  let previousBlank = true
  lines.forEach((line, index) => {
    if (index < frontMatterEnd) return out.push('')
    if (fence) {
      const marker = FENCE.exec(line)
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = undefined
      return out.push('')
    }
    if (!inComment) {
      const blank = line.trim() === ''
      const indented = !blank && /^(?: {4}|\t)/u.test(line)
      if (inIndented) {
        if (indented || blank) {
          previousBlank = blank
          return out.push('')
        }
        inIndented = false
      } else if (indented && previousBlank && !inList) {
        inIndented = true
        previousBlank = false
        return out.push('')
      }
      const marker = FENCE.exec(line)
      if (marker) {
        fence = marker[1]
        previousBlank = false
        return out.push('')
      }
    }
    let visible = ''
    let rest = line
    while (rest.length > 0) {
      if (inComment) {
        const end = rest.indexOf('-->')
        if (end === -1) break
        visible += ' '.repeat(end + 3)
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
        visible += '    '
        inComment = true
      }
    }
    out.push(visible)
    if (visible.trim() === '') previousBlank = true
    else {
      if (LIST_ITEM.test(visible)) inList = true
      else if (!/^\s/u.test(visible)) inList = false
      previousBlank = false
    }
  })
  const joined = out.join('\n')
  if (keepCodeText) return joined.replace(/(`+)([^`\n][\s\S]*?)\1/gu, '$2')
  return joined.replace(/(`+)[^`\n][\s\S]*?\1/gu, match => match.replace(/[^\n]/gu, ' '))
}

/** GitHub heading slug: lowercase, drop punctuation except `-` and `_`, spaces become `-`. */
function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\- _]/gu, '')
    .replace(/ /gu, '-')
}

const anchorCache = new Map()

function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file)
  const anchors = new Set()
  const occurrences = new Map()
  const addHeading = (text) => {
    const base = slug(text)
    let id = base
    while (occurrences.has(id)) {
      occurrences.set(base, occurrences.get(base) + 1)
      id = `${base}-${occurrences.get(base)}`
    }
    occurrences.set(id, 0)
    anchors.add(id)
  }
  const lines = visibleText(readFileSync(file, 'utf8'), { keepCodeText: true }).split('\n')
  const isParagraph = line => line.trim() !== '' && !/^\s{0,3}(?:#{1,6}(?:\s|$)|>|\||(?:=+|-+)\s*$)/u.test(line) && !LIST_ITEM.test(line)
  lines.forEach((line, index) => {
    const heading = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/u.exec(line)
    if (heading) addHeading(heading[1])
    else if (/^\s{0,3}(?:=+|-+)\s*$/u.test(line) && index > 0 && isParagraph(lines[index - 1])) {
      let start = index - 1
      while (start > 0 && isParagraph(lines[start - 1])) start--
      addHeading(lines.slice(start, index).map(item => item.trim()).join(' '))
    }
    for (const match of line.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["']/giu)) anchors.add(match[1].toLowerCase())
  })
  anchorCache.set(file, anchors)
  return anchors
}

/** Index of the "]" matching the "[" at `open`, or -1; link text cannot span a blank line. */
function closingBracket(text, open) {
  let depth = 0
  for (let i = open; i < text.length && i < open + 4000; i++) {
    const char = text[i]
    if (char === '\\') i++
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) return i
    else if (char === '\n' && /^\n[ \t]*\n/u.test(text.slice(i, i + 80))) return -1
  }
  return -1
}

/** Skip spaces and tabs with at most one line ending. */
function skipSpace(text, i) {
  let newlines = 0
  while (i < text.length && /[ \t\n]/u.test(text[i])) {
    if (text[i] === '\n' && ++newlines > 1) return -1
    i++
  }
  return i
}

/** Parse "(destination title?)" starting just after "("; returns the destination or null. */
function inlineDestination(text, start) {
  let i = skipSpace(text, start)
  if (i === -1) return null
  let destination = ''
  if (text[i] === '<') {
    const close = text.indexOf('>', i)
    if (close === -1 || text.slice(i, close).includes('\n')) return null
    destination = text.slice(i + 1, close)
    i = close + 1
  } else {
    let depth = 0
    for (; i < text.length; i++) {
      const char = text[i]
      if (char === '\\' && i + 1 < text.length && /[!-/:-@[-`{-~]/u.test(text[i + 1])) {
        destination += text[++i]
        continue
      }
      if (/\s/u.test(char)) break
      if (char === '(') depth++
      else if (char === ')') {
        if (depth === 0) break
        depth--
      }
      destination += char
    }
    if (depth !== 0) return null
  }
  i = skipSpace(text, i)
  if (i === -1) return null
  const closer = { '"': '"', "'": "'", '(': ')' }[text[i]]
  if (closer && /\s/u.test(text[i - 1])) {
    const close = text.indexOf(closer, i + 1)
    if (close === -1) return null
    i = skipSpace(text, close + 1)
    if (i === -1) return null
  }
  return text[i] === ')' && destination !== '' ? destination : null
}

function linkTargets(text) {
  const targets = []
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (index) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid] <= index) low = mid
      else high = mid - 1
    }
    return low + 1
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' || text[i - 1] === '\\') continue
    const close = closingBracket(text, i)
    if (close === -1 || text[close + 1] !== '(') continue
    const target = inlineDestination(text, close + 2)
    if (target !== null) targets.push({ target, line: lineOf(i) })
  }
  text.split('\n').forEach((line, index) => {
    const definition = /^\s{0,3}\[([^\]^][^\]]*)\]:\s*(<[^>]*>|\S+)/u.exec(line)
    if (definition) targets.push({ target: definition[2].replace(/^<|>$/gu, ''), line: index + 1 })
  })
  return targets
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return 0
  }
  if (options.version) {
    console.log(`verify-md-links (sustainable-engineering) ${VERSION}`)
    return 0
  }
  const root = resolve(options.root)
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new UsageError(`root is not a directory: ${options.root}`)
  const excludes = options.exclude.map(glob => new RegExp(`^${globSource(glob)}$`, 'u'))
  const files = listMarkdown(root).filter(file => !excludes.some(glob => glob.test(file)))
  if (files.length === 0 && !options.allowEmpty) {
    throw new UsageError(`no Markdown files to scan under ${root}${options.exclude.length > 0 ? ' after --exclude' : ''}; check --root and --exclude, or pass --allow-empty`)
  }
  const broken = []
  let checked = 0

  for (const file of files) {
    const absolute = join(root, file)
    let text
    try {
      text = readFileSync(absolute, 'utf8')
    } catch (error) {
      throw new UsageError(`cannot read ${file}: ${error.message}`)
    }
    for (const { target, line } of linkTargets(visibleText(text))) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('//')) continue
      checked++
      const hash = target.indexOf('#')
      const pathPart = hash === -1 ? target : target.slice(0, hash)
      const anchor = hash === -1 ? '' : target.slice(hash + 1)
      let decoded
      try {
        decoded = decodeURIComponent(pathPart.split('?')[0])
      } catch {
        broken.push(`${file}:${line}: malformed URL encoding in ${target}`)
        continue
      }
      let resolved = absolute
      if (decoded.startsWith('/')) resolved = join(root, decoded)
      else if (decoded !== '') resolved = resolve(dirname(absolute), decoded)
      if (!existsSync(resolved)) {
        broken.push(`${file}:${line}: ${target} -> missing ${relative(root, resolved) || '.'}`)
        continue
      }
      if (options.anchors && anchor !== '' && /\.md$/iu.test(resolved) && statSync(resolved).isFile()) {
        let wanted = anchor
        try {
          wanted = decodeURIComponent(anchor)
        } catch {
          // Keep the raw anchor; the lookup below reports it as missing.
        }
        if (!anchorsOf(resolved).has(wanted.toLowerCase())) {
          broken.push(`${file}:${line}: ${target} -> no heading or anchor "#${anchor}" in ${relative(root, resolved)}`)
        }
      }
    }
  }

  if (broken.length > 0) {
    console.error(`verify-md-links: ${broken.length} broken link(s):`)
    for (const item of broken) console.error(`  ${item}`)
    return 1
  }
  console.log(`verify-md-links: ${checked} relative link(s) in ${files.length} Markdown file(s) resolve.`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`verify-md-links: ${error.message}\nRun with --help for usage.`)
    process.exitCode = 2
  } else throw error
}
