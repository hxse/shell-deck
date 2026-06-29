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
  return stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function stripAnsi(text: string): string {
  return text.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
}
