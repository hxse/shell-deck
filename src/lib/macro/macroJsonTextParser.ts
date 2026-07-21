export type InvalidJsonError = { code: 'invalid_json'; offset: number; line: number; column: number; message: string }

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: InvalidJsonError } {
  const syntaxOffset = jsonSyntaxErrorOffset(text)
  if (syntaxOffset !== null) {
    const offset = syntaxOffset
    const position = lineAndColumn(text, offset)
    return { ok: false, error: { code: 'invalid_json', offset, ...position, message: `Invalid JSON at line ${position.line}, column ${position.column}` } }
  }
  return { ok: true, value: JSON.parse(text) as unknown }
}

function jsonSyntaxErrorOffset(text: string): number | null {
  let index = 0
  const whitespace = () => { while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\r' || text[index] === '\n')) index += 1 }
  const literal = (expected: string): number | null => {
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (text[index + offset] !== expected[offset]) return Math.min(text.length, index + offset)
    }
    index += expected.length
    return null
  }
  const string = (): number | null => {
    if (text[index] !== '"') return index
    index += 1
    while (index < text.length) {
      const code = text.charCodeAt(index)
      if (text[index] === '"') { index += 1; return null }
      if (code < 0x20) return index
      if (text[index] !== '\\') { index += 1; continue }
      index += 1
      if (index >= text.length) return text.length
      if ('"\\/bfnrt'.includes(text[index])) { index += 1; continue }
      if (text[index] !== 'u') return index
      index += 1
      for (let count = 0; count < 4; count += 1) {
        if (index >= text.length || !/[0-9A-Fa-f]/.test(text[index])) return Math.min(index, text.length)
        index += 1
      }
    }
    return text.length
  }
  const number = (): number | null => {
    if (text[index] === '-') index += 1
    if (text[index] === '0') index += 1
    else {
      if (!/[1-9]/.test(text[index] ?? '')) return index
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    if (text[index] === '.') {
      index += 1
      if (!/[0-9]/.test(text[index] ?? '')) return index
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    if (text[index] === 'e' || text[index] === 'E') {
      index += 1
      if (text[index] === '+' || text[index] === '-') index += 1
      if (!/[0-9]/.test(text[index] ?? '')) return index
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    return null
  }
  const value = (): number | null => {
    whitespace()
    const token = text[index]
    if (token === '"') return string()
    if (token === '{') return object()
    if (token === '[') return array()
    if (token === 't') return literal('true')
    if (token === 'f') return literal('false')
    if (token === 'n') return literal('null')
    if (token === '-' || /[0-9]/.test(token ?? '')) return number()
    return index
  }
  const object = (): number | null => {
    index += 1
    whitespace()
    if (text[index] === '}') { index += 1; return null }
    while (index < text.length) {
      const keyIssue = string()
      if (keyIssue !== null) return keyIssue
      whitespace()
      if (text[index] !== ':') return index
      index += 1
      const valueIssue = value()
      if (valueIssue !== null) return valueIssue
      whitespace()
      if (text[index] === '}') { index += 1; return null }
      if (text[index] !== ',') return index
      index += 1
      whitespace()
    }
    return text.length
  }
  const array = (): number | null => {
    index += 1
    whitespace()
    if (text[index] === ']') { index += 1; return null }
    while (index < text.length) {
      const valueIssue = value()
      if (valueIssue !== null) return valueIssue
      whitespace()
      if (text[index] === ']') { index += 1; return null }
      if (text[index] !== ',') return index
      index += 1
      whitespace()
    }
    return text.length
  }
  whitespace()
  const issue = value()
  if (issue !== null) return issue
  whitespace()
  return index === text.length ? null : index
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let column = 1
  let index = 0
  while (index < offset) {
    const code = text.charCodeAt(index)
    if (code === 13) {
      if (index + 1 < offset && text.charCodeAt(index + 1) === 10) index += 1
      line += 1
      column = 1
    } else if (code === 10) {
      line += 1
      column = 1
    } else column += 1
    index += 1
  }
  return { line, column }
}
