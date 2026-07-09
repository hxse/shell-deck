import { NotificationService } from '../server/notificationService'

const profileId = process.argv[2] ?? 'default'
const service = new NotificationService()
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
