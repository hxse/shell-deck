import { expect, test } from 'bun:test'
import { captureTerminalBuffer, normalizeTerminalText } from '../../src/lib/capture/terminalBufferCapture'

test('terminal-buffer capture tails raw replay and renders visible terminal text', () => {
  const captured = captureTerminalBuffer({
    replay: ['old line should truncate\n', '\u001b[31mREADY\u001b[0m\r\n', 'next\rprompt'],
    maxChars: 40,
  })

  expect(captured.truncated).toBe(true)
  expect(captured.rawText).toContain('\u001b[0m')
  expect(captured.normalizedText).not.toContain('\u001b')
  expect(captured.normalizedText).toContain('READY\nprompt')
  expect(captured.strippedAnsi).toBe(true)
})

test('terminal text normalization treats carriage return as cursor return, not newline', () => {
  expect(normalizeTerminalText('a\r\nb\rc')).toBe('a\nc')
  expect(normalizeTerminalText('a\r\nb\rc\u001b[2K')).toBe('a\n')
})

test('terminal text normalization handles bash prompt redraw without phantom blank lines', () => {
  const raw = '\u001b[?2004h$ \r\u001b[K\r$ echo hello\r\n\u001b[?2004l\rhello\r\n\u001b[?2004h$ '
  expect(normalizeTerminalText(raw)).toBe('$ echo hello\nhello\n$ ')
})
