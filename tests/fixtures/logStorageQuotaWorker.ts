import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LogStorageRetention } from '../../server/logStorageRetention'
import { initializeUserDataRoot, writePrivateFileAtomic } from '../../server/userDataRoot'

const [root, workerId, limitText, bytesText] = Bun.argv.slice(2)
const limitBytes = Number(limitText)
const bytes = Number(bytesText)
if (!root || !workerId || !Number.isSafeInteger(limitBytes) || !Number.isSafeInteger(bytes)) {
  throw new Error('log_storage_quota_worker_args')
}

const paths = initializeUserDataRoot(root)
const quota = new LogStorageRetention(root, { limitBytes })
writePrivateFileAtomic(join(paths.locks, 'quota-ready-' + workerId), 'ready\n')
while (!existsSync(join(paths.locks, 'quota-go'))) await Bun.sleep(5)

try {
  quota.admitAndPublish(bytes, () => {
    writePrivateFileAtomic(join(paths.agentEvents, workerId + '.data'), 'x'.repeat(bytes))
  })
  process.stdout.write(JSON.stringify({ ok: true }))
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
}
