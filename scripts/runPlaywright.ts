import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { dirname } from 'node:path'

const args = process.argv.slice(2)

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  const env = await playwrightEnvWithPort()
  const wrapper = resolveWrapper(env)
  const child = spawn(wrapper.command, wrapper.args, {
    stdio: 'inherit',
    env: wrapper.env,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

function resolveWrapper(baseEnv: NodeJS.ProcessEnv) {
  const playwrightArgs = ['node_modules/playwright/cli.js', 'test', ...args]
  if (!shouldUseSteamRun()) {
    return {
      command: 'bun',
      args: playwrightArgs,
      env: baseEnv,
    }
  }

  const libraryPath = resolvePlaywrightLibraryPath()
  return {
    command: 'steam-run',
    args: ['bun', ...playwrightArgs],
    env: playwrightEnv(baseEnv, {
      LD_LIBRARY_PATH: [libraryPath, baseEnv.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    }),
  }
}

async function playwrightEnvWithPort() {
  const env = playwrightEnv(process.env)
  env.SHELL_DECK_E2E_HOST = env.SHELL_DECK_E2E_HOST ?? '127.0.0.1'
  env.SHELL_DECK_E2E_PORT = env.SHELL_DECK_E2E_PORT ?? String(await findFreePort(env.SHELL_DECK_E2E_HOST))
  env.SHELL_DECK_DATA_ROOT = env.SHELL_DECK_DATA_ROOT ?? mkdtempSync(join(tmpdir(), 'shell-deck-e2e-'))
  return env
}

function playwrightEnv(base: NodeJS.ProcessEnv, extra: Record<string, string | undefined> = {}) {
  const env = {
    ...base,
    ...extra,
  }
  delete env.NO_COLOR
  return env
}

function findFreePort(host: string) {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }
        reject(new Error('failed_to_allocate_e2e_port'))
      })
    })
  })
}

function shouldUseSteamRun() {
  return process.platform === 'linux' && commandExists('steam-run') && Boolean(resolvePlaywrightLibraryPath())
}

function resolvePlaywrightLibraryPath() {
  const systemLibraries = '/run/current-system/sw/lib'
  const nspr = findLibraryDir('libnspr4.so')
  const nss = findLibraryDir('libnss3.so')
  const xcomposite = findLibraryDir('libXcomposite.so.1')
  return [...new Set([
    existsSync(systemLibraries) ? systemLibraries : '',
    nspr,
    nss,
    xcomposite,
  ].filter(Boolean))].join(':')
}

function findLibraryDir(libraryName: string) {
  const result = spawnSync('find', ['/nix/store', '-maxdepth', '4', '-name', libraryName], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    return ''
  }

  const firstMatch = result.stdout.split('\n').find(Boolean)
  return firstMatch ? dirname(firstMatch) : ''
}

function commandExists(command: string) {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    stdio: 'ignore',
  })
  return result.status === 0
}
