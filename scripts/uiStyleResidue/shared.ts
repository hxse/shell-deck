import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export type UiStyleResidueIssue = {
  file: string
  line: number
  reason: string
}

const SOURCE_EXTENSIONS = new Set(['.css', '.svelte', '.ts'])

export function scanProductionColorText(file: string, source: string): UiStyleResidueIssue[] {
  const issues: UiStyleResidueIssue[] = []
  const patterns: Array<[RegExp, string]> = [
    [/#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/gi, 'hard-coded hex UI color is forbidden'],
    [/\b(?:rgba?|hsla?|oklch)\s*\(/gi, 'hard-coded functional UI color is forbidden'],
    [/\b(?:bg|text|border(?:-[trblxy])?|outline|ring(?:-offset)?|fill|stroke|decoration|caret|accent)-\[(?:color:)?[a-z]+\]/gi, 'Tailwind arbitrary UI color utility is forbidden'],
  ]
  for (const [pattern, reason] of patterns) {
    for (const match of source.matchAll(pattern)) issues.push(issueAt(file, source, match.index, reason))
  }
  return issues
}

export function collectSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (!entry.isFile()) return []
    const extension = entry.name.slice(entry.name.lastIndexOf('.'))
    return SOURCE_EXTENSIONS.has(extension) ? [path] : []
  })
}

export function readIfPresent(path: string): string {
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : ''
}

export function projectPath(root: string, path: string): string {
  return relative(root, path).split('\\').join('/')
}

export function issueAt(file: string, source: string, index: number | undefined, reason: string): UiStyleResidueIssue {
  return { file, line: lineOf(source, index ?? 0), reason }
}

export function lineOf(source: string, index: number): number {
  return source.slice(0, Math.max(0, index)).split('\n').length
}

export function dedupeIssues(issues: UiStyleResidueIssue[]): UiStyleResidueIssue[] {
  return [...new Map(issues.map((issue) => [`${issue.file}:${issue.line}:${issue.reason}`, issue])).values()]
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.reason.localeCompare(right.reason))
}
