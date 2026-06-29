import { assertArtifactRef } from './identifier'

export function extractArtifactRefs(value: unknown): string[] {
  const refs = new Set<string>()
  visit(value, '', refs)
  return [...refs].sort()
}

export function validateExtractedArtifactRefs(value: unknown): string[] {
  return extractArtifactRefs(value).map((ref) => assertArtifactRef(ref))
}

function visit(value: unknown, key: string, refs: Set<string>): void {
  if (typeof value === 'string') {
    if (key === 'artifactRef') refs.add(value)
    return
  }
  if (Array.isArray(value)) {
    if (key === 'artifactRefs') {
      for (const item of value) {
        if (typeof item === 'string') refs.add(item)
        else visit(item, '', refs)
      }
      return
    }
    for (const item of value) visit(item, '', refs)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [childKey, childValue] of Object.entries(value)) {
    visit(childValue, childKey, refs)
  }
}
