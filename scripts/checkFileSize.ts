import { lstatSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

export const FILE_SIZE_LIMIT = 400
export const FILE_SIZE_ADVISORY_LIMIT = 350
export const PROJECT_CODE_EXTENSIONS = [
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.css',
  '.cts',
  '.cxx',
  '.fish',
  '.go',
  '.gql',
  '.graphql',
  '.h',
  '.hh',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.less',
  '.lua',
  '.mjs',
  '.mts',
  '.nix',
  '.pcss',
  '.php',
  '.pl',
  '.pm',
  '.proto',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
  '.zsh',
] as const
export const PROJECT_CODE_FILENAMES = [
  'Dockerfile',
  'Justfile',
  'Makefile',
  'justfile',
  'package.json',
  'tsconfig.json',
] as const
export const NON_PROJECT_DIRECTORY_NAMES = [
  '.agents',
  '.codex',
  '.git',
  '.jj',
  '.serena',
  '.shell-deck',
  '.svelte-check',
  '.svelte-kit',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
] as const

const PROJECT_CODE_EXTENSION_SET = new Set<string>(PROJECT_CODE_EXTENSIONS)
const PROJECT_CODE_FILENAME_SET = new Set<string>(PROJECT_CODE_FILENAMES)
const NON_PROJECT_DIRECTORY_SET = new Set<string>(NON_PROJECT_DIRECTORY_NAMES)

export type FileSizeEntry = {
  path: string
  lines: number
}

export type FileSizeIssue = {
  path: string
  actual: number | null
  limit: number
  reason: string
}

export type FileSizeAdvisory = {
  path: string
  actual: number
  advisoryLimit: number
  hardLimit: number
}

export type FileSizeScanResult = {
  files: FileSizeEntry[]
  advisories: FileSizeAdvisory[]
  issues: FileSizeIssue[]
}

export function countLogicalLines(source: string): number {
  if (source.length === 0) return 0
  let lines = 1
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) lines += 1
  }
  return source.endsWith('\n') ? lines - 1 : lines
}

export function scanFileSizes(projectRoot = resolve(import.meta.dir, '..')): FileSizeScanResult {
  const resolvedProjectRoot = resolve(projectRoot)
  const candidates: string[] = []
  const advisories: FileSizeAdvisory[] = []
  const issues: FileSizeIssue[] = []
  collectDirectory(resolvedProjectRoot, resolvedProjectRoot, candidates, issues)

  const files: FileSizeEntry[] = []
  for (const absolutePath of candidates.sort((left, right) =>
    compareText(projectPath(resolvedProjectRoot, left), projectPath(resolvedProjectRoot, right)),
  )) {
    const path = projectPath(resolvedProjectRoot, absolutePath)
    const bytes = readRegularFile(absolutePath, path, issues)
    if (!bytes) continue

    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      issues.push(issue(path, null, 'file is not valid UTF-8'))
      continue
    }

    const entry = { path, lines: countLogicalLines(source) }
    files.push(entry)
    if (entry.lines > FILE_SIZE_LIMIT) {
      issues.push(issue(path, entry.lines, 'file exceeds line limit'))
    } else if (entry.lines >= FILE_SIZE_ADVISORY_LIMIT) {
      advisories.push({
        path,
        actual: entry.lines,
        advisoryLimit: FILE_SIZE_ADVISORY_LIMIT,
        hardLimit: FILE_SIZE_LIMIT,
      })
    }
  }

  advisories.sort((left, right) => compareText(left.path, right.path))
  issues.sort((left, right) => compareText(left.path, right.path) || compareText(left.reason, right.reason))
  return { files, advisories, issues }
}

export function formatFileSizeIssue(value: FileSizeIssue): string {
  return `${value.path}:${value.actual ?? 'unknown'}:${value.limit}: ${value.reason}`
}

export function formatFileSizeAdvisory(value: FileSizeAdvisory): string {
  return `${value.path}:${value.actual}:${value.advisoryLimit}:${value.hardLimit}: file approaches hard line limit`
}

function collectDirectory(
  projectRoot: string,
  directory: string,
  candidates: string[],
  issues: FileSizeIssue[],
): void {
  const path = projectPath(projectRoot, directory)
  let entries: Dirent[]
  try {
    const stat = lstatSync(directory)
    if (stat.isSymbolicLink()) {
      issues.push(issue(path, null, 'symlink is forbidden'))
      return
    }
    if (!stat.isDirectory()) {
      issues.push(issue(path, null, 'scan root is not a directory'))
      return
    }
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    issues.push(issue(path, null, `directory enumeration failed: ${errorCode(error)}`))
    return
  }

  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const absolutePath = resolve(directory, entry.name)
    const entryPath = projectPath(projectRoot, absolutePath)
    if (NON_PROJECT_DIRECTORY_SET.has(entry.name)
      && (entry.isDirectory() || entry.isSymbolicLink())) {
      continue
    }
    if (entry.isSymbolicLink()) {
      issues.push(issue(entryPath, null, 'symlink is forbidden'))
    } else if (entry.isDirectory()) {
      collectDirectory(projectRoot, absolutePath, candidates, issues)
    } else if (entry.isFile()) {
      if (isProjectCodeSource(entry.name)) candidates.push(absolutePath)
    } else {
      issues.push(issue(entryPath, null, 'non-regular filesystem entry is forbidden'))
    }
  }
}

function isProjectCodeSource(fileName: string): boolean {
  return PROJECT_CODE_FILENAME_SET.has(fileName)
    || PROJECT_CODE_EXTENSION_SET.has(extname(fileName).toLowerCase())
}

function readRegularFile(
  absolutePath: string,
  path: string,
  issues: FileSizeIssue[],
): Buffer | null {
  try {
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      issues.push(issue(path, null, 'symlink is forbidden'))
      return null
    }
    if (!stat.isFile()) {
      issues.push(issue(path, null, 'source is not a regular file'))
      return null
    }
    return readFileSync(absolutePath)
  } catch (error) {
    issues.push(issue(path, null, `file read failed: ${errorCode(error)}`))
    return null
  }
}

function projectPath(projectRoot: string, path: string): string {
  const output = relative(projectRoot, path).split(sep).join('/')
  return output || '.'
}

function issue(path: string, actual: number | null, reason: string): FileSizeIssue {
  return { path, actual, limit: FILE_SIZE_LIMIT, reason }
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return error instanceof Error ? error.name : 'unknown_error'
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

if (import.meta.main) {
  const result = scanFileSizes()
  for (const value of result.advisories) {
    console.log(`file-size advisory: ${formatFileSizeAdvisory(value)}`)
  }
  if (result.issues.length > 0) {
    for (const value of result.issues) console.error(formatFileSizeIssue(value))
    console.error(`file-size: ${result.issues.length} violation(s)`)
    process.exit(1)
  }
  console.log(
    `file-size: clean; scanned=${result.files.length}; limit=${FILE_SIZE_LIMIT}; `
    + `advisory-limit=${FILE_SIZE_ADVISORY_LIMIT}; advisories=${result.advisories.length}; `
    + 'scope=project-authored-code; exceptions=0',
  )
}
