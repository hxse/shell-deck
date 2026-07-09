import { homedir } from 'node:os'
import { expect, test } from 'bun:test'
import { DEFAULT_REAL_SHELL_ALIAS_LINES, DEFAULT_REAL_SHELL_PROMPT, defaultRealShellCwd } from '../../server/realPtyBackend'

test('real shell defaults to home cwd and a path prompt', () => {
  expect(DEFAULT_REAL_SHELL_PROMPT).toBe('\\[\\e[1;92m\\][\\u@\\h:\\w]\\$\\[\\e[0m\\] ')
  const home = homedir()
  if (home) expect(defaultRealShellCwd()).toBe(home)
  expect(DEFAULT_REAL_SHELL_ALIAS_LINES).toContain("alias ls='ls --color=auto'")
})
