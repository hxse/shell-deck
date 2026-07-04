export type TerminalBufferCaptureInput = {
  replay: string[]
  maxChars: number
}

export type TerminalBufferCaptureResult = {
  rawText: string
  normalizedText: string
  truncated: boolean
  rawCharsBeforeTail: number
  capturedChars: number
  strippedAnsi: boolean
}

export function captureTerminalBuffer(input: TerminalBufferCaptureInput): TerminalBufferCaptureResult {
  const maxChars = Math.max(0, Math.floor(input.maxChars))
  const fullRaw = input.replay.join('')
  const rawText = maxChars === 0 ? '' : fullRaw.slice(-maxChars)
  const normalizedText = normalizeTerminalText(rawText)
  return {
    rawText,
    normalizedText,
    truncated: fullRaw.length > rawText.length,
    rawCharsBeforeTail: fullRaw.length,
    capturedChars: rawText.length,
    strippedAnsi: rawText !== normalizedText,
  }
}

export function normalizeTerminalText(text: string): string {
  return renderVisibleTerminalText(text)
}

function renderVisibleTerminalText(text: string): string {
  const lines = ['']
  let row = 0
  let col = 0

  const currentLine = () => lines[row] ?? ''
  const setCurrentLine = (line: string) => {
    lines[row] = line
  }
  const writeChar = (char: string) => {
    const line = currentLine()
    const padded = line.length < col ? line + ' '.repeat(col - line.length) : line
    setCurrentLine(padded.slice(0, col) + char + padded.slice(col + 1))
    col += 1
  }
  const eraseLine = (mode: number) => {
    const line = currentLine()
    if (mode === 1) {
      setCurrentLine(' '.repeat(Math.min(col, line.length)) + line.slice(col))
    } else if (mode === 2) {
      setCurrentLine('')
    } else {
      setCurrentLine(line.slice(0, col))
    }
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\u001b' || char === '\u009b') {
      const parsed = parseAnsiControl(text, index)
      if (parsed) {
        if (parsed.eraseLineMode !== undefined) eraseLine(parsed.eraseLineMode)
        index = parsed.nextIndex - 1
        continue
      }
    }
    if (char === '\r') {
      col = 0
      continue
    }
    if (char === '\n') {
      row += 1
      col = 0
      if (lines[row] === undefined) lines[row] = ''
      continue
    }
    if (char === '\b') {
      col = Math.max(0, col - 1)
      continue
    }
    if (char === '\t') {
      const nextTab = col + (8 - (col % 8))
      while (col < nextTab) writeChar(' ')
      continue
    }
    if (char < ' ') {
      continue
    }
    writeChar(char)
  }

  return lines.join('\n')
}

function parseAnsiControl(text: string, startIndex: number): { nextIndex: number; eraseLineMode?: number } | null {
  const first = text[startIndex]
  if (first === '\u009b') return parseCsi(text, startIndex + 1)
  if (first !== '\u001b') return null
  const kind = text[startIndex + 1]
  if (kind === '[') return parseCsi(text, startIndex + 2)
  if (kind === ']') return parseOsc(text, startIndex + 2)
  if (kind === undefined) return { nextIndex: startIndex + 1 }
  return { nextIndex: startIndex + 2 }
}

function parseCsi(text: string, index: number): { nextIndex: number; eraseLineMode?: number } {
  let cursor = index
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor)
    if (code >= 0x40 && code <= 0x7e) {
      const final = text[cursor]
      const payload = text.slice(index, cursor)
      return {
        nextIndex: cursor + 1,
        eraseLineMode: final === 'K' ? eraseLineMode(payload) : undefined,
      }
    }
    cursor += 1
  }
  return { nextIndex: text.length }
}

function parseOsc(text: string, index: number): { nextIndex: number } {
  let cursor = index
  while (cursor < text.length) {
    if (text[cursor] === '\u0007') return { nextIndex: cursor + 1 }
    if (text[cursor] === '\u001b' && text[cursor + 1] === '\\') return { nextIndex: cursor + 2 }
    cursor += 1
  }
  return { nextIndex: text.length }
}

function eraseLineMode(payload: string): number {
  const params = payload.replace(/[?=><]/g, '').split(';').filter(Boolean)
  const mode = Number(params[params.length - 1] ?? 0)
  return mode === 1 || mode === 2 ? mode : 0
}
