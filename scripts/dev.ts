export {}

const serverArgs = process.argv.slice(2)
const backendHost = argValue(serverArgs, '--host') ?? '127.0.0.1'
const backendPort = argValue(serverArgs, '--port') ?? '5177'
const backendOrigin = 'http://' + proxyHost(backendHost) + ':' + backendPort

const children = [
  spawn(['bun', 'run', 'server/httpServer.ts', ...serverArgs]),
  spawn(['bun', 'x', 'vite'], {
    SHELL_DECK_DEV_BACKEND_ORIGIN: backendOrigin,
    SHELL_DECK_DEV_HOST: backendHost,
    VITE_SHELL_DECK_DEV_BACKEND_HOST: backendHost,
    VITE_SHELL_DECK_DEV_BACKEND_PORT: backendPort,
  }),
]

let stopping = false

process.once('SIGINT', () => {
  void stopAll('SIGINT').then(() => process.exit(130))
})
process.once('SIGTERM', () => {
  void stopAll('SIGTERM').then(() => process.exit(143))
})

const firstExit = await Promise.race(children.map(async (child) => await child.exited))
if (!stopping) {
  await stopAll('SIGTERM')
  process.exit(firstExit)
}

function spawn(command: string[], extraEnv: Record<string, string> = {}): Bun.Subprocess {
  return Bun.spawn(command, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

async function stopAll(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return
  stopping = true
  for (const child of children) {
    child.kill(signal)
  }
  await Promise.allSettled(children.map(async (child) => await child.exited))
}

function argValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(name + '='))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function proxyHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  return host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host
}
