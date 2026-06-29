import { expect, test } from 'bun:test'
import { captureTerminalBuffer, normalizeTerminalText } from '../../src/lib/capture/terminalBufferCapture'

test('terminal-buffer capture tails raw replay and normalizes ANSI/carriage returns', () => {
  const captured = captureTerminalBuffer({
    replay: ['old line should truncate\n', '\u001b[31mREADY\u001b[0m\r\n', 'next\rprompt'],
    maxChars: 40,
  })

  expect(captured.truncated).toBe(true)
  expect(captured.rawText).toContain('\u001b[0m')
  expect(captured.normalizedText).not.toContain('\u001b')
  expect(captured.normalizedText).toContain('READY\nnext\nprompt')
  expect(captured.strippedAnsi).toBe(true)
})

test('terminal text normalization is deterministic for parser input', () => {
  expect(normalizeTerminalText('a\r\nb\rc\u001b[2K')).toBe('a\nb\nc')
})
