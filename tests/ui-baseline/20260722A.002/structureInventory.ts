import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'

export type StructureFingerprint = {
  count: number
  digest: string
  entries: string[]
  entryDigests: string[]
}

export function collectSvelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSvelteFiles(path)
    return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : []
  })
}

export function structureFingerprint(projectRoot: string, path: string): StructureFingerprint {
  const entries = structureInventory(projectRoot, path)
  return {
    count: entries.length,
    digest: sha256(JSON.stringify(entries)),
    entries,
    entryDigests: entries.map(sha256),
  }
}

export function structureInventory(projectRoot: string, path: string): string[] {
  const source = readFileSync(path, 'utf8')
  const ast = parse(source, { modern: true }) as unknown as { fragment: unknown }
  const entries: string[] = []
  walk(ast.fragment, (node) => {
    const record = node as {
      type?: string
      name?: string
      attributes?: Array<{ type?: string; name?: string; start?: number; end?: number }>
    }
    if (!['RegularElement', 'Component'].includes(record.type ?? '')) return
    const attributes = (record.attributes ?? [])
      .filter((attribute) => attribute.name !== 'class' && attribute.name !== 'style')
      .filter((attribute) => !attribute.type?.includes('Class') && !attribute.type?.includes('Style'))
      .map((attribute) => source.slice(attribute.start, attribute.end).replace(/\s+/g, ' ').trim())
    const relativePath = relative(projectRoot, path).split('\\').join('/')
    entries.push(`${relativePath}::${record.type}:${record.name}::${attributes.join('|')}`)
  })
  return entries
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function walk(value: unknown, visit: (node: object) => void): void {
  if (!value || typeof value !== 'object') return
  visit(value)
  for (const [key, child] of Object.entries(value)) {
    if (key === 'parent' || key === 'metadata' || key === 'loc') continue
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visit)
    } else {
      walk(child, visit)
    }
  }
}
