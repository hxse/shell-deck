import { NotificationService } from '../server/notificationService'
import { relocateNotificationConfig } from '../server/notificationConfigRelocation'

const profileId = process.argv[2] ?? 'default'
const location = relocateNotificationConfig()
const service = new NotificationService(location.paths.root)
const result = await service.sendTelegram({
  profileId,
  level: 'info',
  title: 'shell-deck Telegram smoke',
  message: 'notification-telegram-smoke profile=' + profileId + ' at ' + new Date().toISOString(),
})

if (!result.ok) {
  console.error(result.code + ': ' + result.message)
  process.exit(1)
}

console.log('Telegram notification delivered with HTTP ' + result.status + ' using profile ' + profileId)
