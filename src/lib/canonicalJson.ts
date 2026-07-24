export function canonicalJsonStringify(value: unknown): string {
  const encoded = encodeCanonical(value, '', false)
  if (encoded === undefined) throw new Error('canonical_json_root_not_serializable')
  return encoded
}

function encodeCanonical(value: unknown, key: string, arrayElement: boolean): string | undefined {
  if (value && typeof value === 'object') {
    const toJSON = (value as { toJSON?: unknown }).toJSON
    if (typeof toJSON === 'function') {
      return encodeCanonical(toJSON.call(value, key), key, arrayElement)
    }
  }
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return arrayElement ? 'null' : undefined
  }
  if (typeof value === 'bigint') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value
      .map((item, index) => encodeCanonical(item, String(index), true) ?? 'null')
      .join(',') + ']'
  }
  const record = value as Record<string, unknown>
  const fields: string[] = []
  for (const property of Object.keys(record).sort(compareCodePoints)) {
    const encoded = encodeCanonical(record[property], property, false)
    if (encoded !== undefined) fields.push(JSON.stringify(property) + ':' + encoded)
  }
  return '{' + fields.join(',') + '}'
}

function compareCodePoints(left: string, right: string): number {
  const a = [...left].map((value) => value.codePointAt(0)!)
  const b = [...right].map((value) => value.codePointAt(0)!)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}
