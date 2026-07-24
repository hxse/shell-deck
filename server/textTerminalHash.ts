import { createHash } from 'node:crypto'

export function textTerminalHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
}
