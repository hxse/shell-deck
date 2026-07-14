import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeUserDataRoot, writePrivateFileAtomic } from '../server/userDataRoot'
import { relocateNotificationConfig } from '../server/notificationConfigRelocation'

const location = relocateNotificationConfig()
const paths = initializeUserDataRoot(location.paths.root)
if (existsSync(paths.notificationProfiles)) {
  console.log('notification config already exists: ' + paths.notificationProfiles)
  process.exit(0)
}
const example = resolve(import.meta.dir, '..', 'config', 'notification-profiles.example.json')
writePrivateFileAtomic(paths.notificationProfiles, readFileSync(example))
console.log('notification config created: ' + paths.notificationProfiles)
