import type { MacroDefinitionV5 } from './macroDefinitionTypes'

type JsonPath = Array<string | number>
type PathEntry = { path: JsonPath; key: string }

export function createMacroDraftMutationTracker() {
  let base: MacroDefinitionV5 | null = null
  const unequal = new Map<string, PathEntry>()
  const proxyTargets = new WeakMap<object, object>()

  return {
    replaceBase(definition: MacroDefinitionV5 | null): void {
      base = definition
      unequal.clear()
    },
    apply(
      definition: MacroDefinitionV5,
      mutator: (definition: MacroDefinitionV5) => void,
    ): boolean {
      const changed = new Map<string, PathEntry>()
      mutator(recordingProxy(definition, [], changed, new WeakMap(), proxyTargets))
      if (base === null) return true
      for (const entry of minimalAffectedPaths(changed, unequal)) {
        removeRelatedPaths(unequal, entry.path)
        if (!sameJsonPathValue(definition, base, entry.path)) unequal.set(entry.key, entry)
      }
      return unequal.size > 0
    },
  }
}

function recordingProxy<T extends object>(
  target: T,
  path: JsonPath,
  changed: Map<string, PathEntry>,
  cache: WeakMap<object, object>,
  proxyTargets: WeakMap<object, object>,
): T {
  const cached = cache.get(target)
  if (cached) return cached as T
  const proxy = new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver)
      if (!value || typeof value !== 'object') return value
      return recordingProxy(value, [...path, pathSegment(property)], changed, cache, proxyTargets)
    },
    set(current, property, value, receiver) {
      notePath(changed, [...path, pathSegment(property)])
      return Reflect.set(current, property, unwrapRecordingValue(value, proxyTargets), receiver)
    },
    deleteProperty(current, property) {
      notePath(changed, [...path, pathSegment(property)])
      return Reflect.deleteProperty(current, property)
    },
  })
  cache.set(target, proxy)
  proxyTargets.set(proxy, target)
  return proxy
}

function unwrapRecordingValue(
  value: unknown,
  proxyTargets: WeakMap<object, object>,
  seen = new WeakSet<object>(),
): unknown {
  if (!value || typeof value !== 'object') return value
  const target = proxyTargets.get(value) ?? value
  if (seen.has(target)) return target
  seen.add(target)
  for (const key of Reflect.ownKeys(target)) {
    const child = Reflect.get(target, key)
    const unwrapped = unwrapRecordingValue(child, proxyTargets, seen)
    if (child !== unwrapped) Reflect.set(target, key, unwrapped)
  }
  return target
}

function minimalAffectedPaths(
  changed: Map<string, PathEntry>,
  unequal: Map<string, PathEntry>,
): PathEntry[] {
  const affected = new Map(changed)
  for (const current of unequal.values()) {
    if ([...changed.values()].some((entry) => pathsRelated(entry.path, current.path))) {
      affected.set(current.key, current)
    }
  }
  const ordered = [...affected.values()].sort((left, right) => left.path.length - right.path.length)
  return ordered.filter((entry, index) => !ordered.slice(0, index).some((parent) => isPrefix(parent.path, entry.path)))
}

function removeRelatedPaths(paths: Map<string, PathEntry>, changed: JsonPath): void {
  for (const [key, entry] of paths) if (pathsRelated(entry.path, changed)) paths.delete(key)
}

function sameJsonPathValue(left: unknown, right: unknown, path: JsonPath): boolean {
  const a = valueAtPath(left, path)
  const b = valueAtPath(right, path)
  if (a.present !== b.present) return false
  return !a.present || deepJsonEqual(a.value, b.value)
}

function valueAtPath(root: unknown, path: JsonPath): { present: boolean; value?: unknown } {
  let value = root
  for (const segment of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { present: false }
    value = (value as Record<string | number, unknown>)[segment]
  }
  return { present: true, value }
}

function deepJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.hasOwn(right, key)
    && deepJsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

function notePath(paths: Map<string, PathEntry>, path: JsonPath): void {
  const key = JSON.stringify(path)
  paths.set(key, { path, key })
}

function pathSegment(property: string | symbol): string | number {
  const value = String(property)
  return /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value
}

function pathsRelated(left: JsonPath, right: JsonPath): boolean {
  return isPrefix(left, right) || isPrefix(right, left)
}

function isPrefix(prefix: JsonPath, path: JsonPath): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index])
}
