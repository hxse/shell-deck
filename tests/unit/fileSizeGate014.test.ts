import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  countLogicalLines,
  FILE_SIZE_ADVISORY_LIMIT,
  FILE_SIZE_LIMIT,
  formatFileSizeAdvisory,
  formatFileSizeIssue,
  NON_PROJECT_DIRECTORY_NAMES,
  PROJECT_CODE_EXTENSIONS,
  PROJECT_CODE_FILENAMES,
  scanFileSizes,
} from '../../scripts/checkFileSize'

const projectRoot = resolve(import.meta.dir, '../..')
const temporaryProjects: string[] = []

afterEach(() => {
  for (const path of temporaryProjects.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('20260723C.014 file-size Gate', () => {
  test('350 lines produce a soft advisory while 401 remains the hard failure', () => {
    const root = createProject()
    writeSource(root, 'src/below.ts', lines(349, '\n'))
    writeSource(root, 'src/advisory.ts', lines(350, '\n'))
    writeSource(root, 'src/hard-edge.ts', lines(400, '\n'))
    writeSource(root, 'src/violation.ts', lines(401, '\n'))

    const result = scanFileSizes(root)
    expect(result.advisories).toEqual([
      {
        path: 'src/advisory.ts',
        actual: 350,
        advisoryLimit: FILE_SIZE_ADVISORY_LIMIT,
        hardLimit: FILE_SIZE_LIMIT,
      },
      {
        path: 'src/hard-edge.ts',
        actual: 400,
        advisoryLimit: FILE_SIZE_ADVISORY_LIMIT,
        hardLimit: FILE_SIZE_LIMIT,
      },
    ])
    expect(formatFileSizeAdvisory(result.advisories[0]))
      .toBe('src/advisory.ts:350:350:400: file approaches hard line limit')
    expect(result.issues.map(({ path }) => path)).toEqual(['src/violation.ts'])
  })

  test('logical line counting accepts 400, rejects 401 and treats CRLF or trailing newline exactly', () => {
    expect(countLogicalLines('')).toBe(0)
    expect(countLogicalLines('one')).toBe(1)
    expect(countLogicalLines('one\n')).toBe(1)
    expect(countLogicalLines('one\r\n')).toBe(1)
    expect(countLogicalLines(lines(400, '\n'))).toBe(400)
    expect(countLogicalLines(lines(400, '\r\n'))).toBe(400)
    expect(countLogicalLines(lines(401, '\r\n'))).toBe(401)

    const root = createProject()
    writeSource(root, 'server/exact.ts', lines(400, '\n'))
    writeSource(root, 'src/nested/tooLarge.svelte', lines(401, '\r\n'))
    writeSource(root, 'tests/tooLarge.js', lines(401, '\n'))
    writeSource(root, 'doc/ignored.md', lines(900, '\n'))
    const result = scanFileSizes(root)

    expect(result.issues).toEqual([
      {
        path: 'src/nested/tooLarge.svelte',
        actual: 401,
        limit: FILE_SIZE_LIMIT,
        reason: 'file exceeds line limit',
      },
      {
        path: 'tests/tooLarge.js',
        actual: 401,
        limit: FILE_SIZE_LIMIT,
        reason: 'file exceeds line limit',
      },
    ])
    expect(formatFileSizeIssue(result.issues[0]))
      .toBe('src/nested/tooLarge.svelte:401:400: file exceeds line limit')
    expect(result.files.map(({ path }) => path)).toEqual([
      'server/exact.ts',
      'src/nested/tooLarge.svelte',
      'tests/tooLarge.js',
    ])
  })

  test('root configs and representative code types are discovered without path exceptions', () => {
    const root = createProject()
    const codeFiles = [
      'index.html',
      'justfile',
      'package.json',
      'scripts/future.mjs',
      'server/ptyHelper.c',
      'src/app.css',
      'src/future.tsx',
      'svelte.config.js',
      'vite.config.ts',
    ]
    for (const path of codeFiles) writeSource(root, path, 'source\n')
    writeSource(root, 'node_modules/vendor.js', lines(900, '\n'))
    writeSource(root, 'dist/bundle.css', lines(900, '\n'))
    writeSource(root, '.git/generated.ts', lines(900, '\n'))
    writeSource(root, 'doc/data.json', lines(900, '\n'))

    const result = scanFileSizes(root)
    expect(result.issues).toEqual([])
    expect(result.files.map(({ path }) => path)).toEqual(codeFiles)
  })

  test('invalid UTF-8, symlinks and an unreadable root fail loudly in stable order', () => {
    const root = createProject()
    writeSource(root, 'scripts/invalid.ts', Buffer.from([0xc3, 0x28]))
    writeSource(root, 'tests/link-target.txt', 'target')
    symlinkSync('link-target.txt', resolve(root, 'tests/link.ts'))

    expect(scanFileSizes(root).issues).toEqual([
      {
        path: 'scripts/invalid.ts',
        actual: null,
        limit: FILE_SIZE_LIMIT,
        reason: 'file is not valid UTF-8',
      },
      {
        path: 'tests/link.ts',
        actual: null,
        limit: FILE_SIZE_LIMIT,
        reason: 'symlink is forbidden',
      },
    ])
    expect(scanFileSizes(resolve(root, 'missing-project')).issues).toEqual([{
      path: '.',
      actual: null,
      limit: FILE_SIZE_LIMIT,
      reason: 'directory enumeration failed: ENOENT',
    }])
  })

  test('the current project is exception-free and includes root, CSS and C sources', () => {
    const result = scanFileSizes(projectRoot)
    expect(result.issues).toEqual([])
    expect(result.advisories.every(({ actual }) => actual >= FILE_SIZE_ADVISORY_LIMIT && actual <= FILE_SIZE_LIMIT))
      .toBe(true)
    const paths = result.files.map(({ path }) => path)
    for (const path of [
      'playwright.config.ts',
      'scripts/checkFileSize.ts',
      'server/ptyHelper.c',
      'src/app.css',
      'svelte.config.js',
      'tests/unit/fileSizeGate014.test.ts',
      'vite.config.ts',
    ]) expect(paths).toContain(path)
    expect(result.files.every(({ lines: actual }) => actual <= FILE_SIZE_LIMIT)).toBe(true)
  })

  test('just check and public unit discovery keep one broad project-code scanner', () => {
    for (const extension of ['.js', '.mjs', '.ts', '.tsx', '.svelte', '.css', '.c'] as const) {
      expect(PROJECT_CODE_EXTENSIONS).toContain(extension)
    }
    expect(PROJECT_CODE_FILENAMES).toContain('justfile')
    for (const directory of ['.git', '.jj', 'dist', 'node_modules', 'test-results'] as const) {
      expect(NON_PROJECT_DIRECTORY_NAMES).toContain(directory)
    }
    const justfile = readFileSync(resolve(projectRoot, 'justfile'), 'utf8')
    expect(justfile).toContain('check: file-size ui-style-residue check-ts check-svelte')
    expect(justfile).toContain('file-size:\n    bun run scripts/checkFileSize.ts')

    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(packageJson.scripts['test:unit:core'].split('tests/unit/fileSizeGate014.test.ts'))
      .toHaveLength(2)
  })
})

function createProject(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'shell-deck-file-size-'))
  temporaryProjects.push(root)
  return root
}

function writeSource(root: string, path: string, content: string | Buffer): void {
  const absolutePath = resolve(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function lines(count: number, newline: '\n' | '\r\n'): string {
  return Array.from({ length: count }, () => 'line').join(newline) + newline
}
