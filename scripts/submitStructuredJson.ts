import { isJsonValue } from '../src/lib/macro/structuredJson'

type SubmitJsonEnvironment = Record<string, string | undefined>
type SubmitJsonResult = { exitCode: number; stdout: string; stderr: string }
type SubmitJsonFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const REQUIRED_ENV = [
  'SHELL_DECK_SUBMIT_JSON_URL',
  'SHELL_DECK_INGEST_TOKEN',
  'SHELL_DECK_ROOM_GENERATION',
  'SHELL_DECK_TERMINAL_ID',
  'SHELL_DECK_LAUNCH_ID',
] as const

export async function submitStructuredJson(
  stdin: string,
  env: SubmitJsonEnvironment,
  fetchImpl: SubmitJsonFetch = fetch,
): Promise<SubmitJsonResult> {
  if (REQUIRED_ENV.some((name) => !env[name])) {
    return failure('structured_json_room_context_required')
  }
  let value: unknown
  try {
    value = JSON.parse(stdin)
  } catch {
    return failure('structured_json_invalid_json')
  }
  if (!isJsonValue(value)) return failure('structured_json_invalid_json')

  let response: Response
  try {
    response = await fetchImpl(env.SHELL_DECK_SUBMIT_JSON_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': env.SHELL_DECK_INGEST_TOKEN!,
      },
      body: JSON.stringify({
        protocolVersion: 1,
        roomGeneration: env.SHELL_DECK_ROOM_GENERATION,
        terminalId: env.SHELL_DECK_TERMINAL_ID,
        launchId: env.SHELL_DECK_LAUNCH_ID,
        value,
      }),
    })
  } catch {
    return failure('structured_json_submit_failed')
  }
  const responseBody = await response.json().catch(() => null) as {
    error?: unknown
    issues?: unknown
  } | null
  if (!response.ok) {
    const error = typeof responseBody?.error === 'string'
      ? responseBody.error
      : 'structured_json_submit_failed'
    const issues = responseBody?.issues === undefined
      ? ''
      : '\n' + JSON.stringify(responseBody.issues, null, 2)
    return failure(error + issues)
  }
  return { exitCode: 0, stdout: 'structured_json_submitted\n', stderr: '' }
}

function failure(message: string): SubmitJsonResult {
  return { exitCode: 1, stdout: '', stderr: message + '\n' }
}

if (import.meta.main) {
  const result = process.argv.length > 2
    ? failure('structured_json_arguments_not_supported')
    : await submitStructuredJson(await Bun.stdin.text(), process.env)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
