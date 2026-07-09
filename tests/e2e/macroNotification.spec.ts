import { expect, test } from 'playwright/test'

async function openTemplateDrawer(page: { getByTestId: (id: string) => any }) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

test('notify action can be inserted from macro editor palette', async ({ page, request }) => {
  const configId = 'macro-notify-editor-' + Date.now()
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await page.goto('/?configId=' + configId)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-notify').click()
  await expect(page.getByTestId('notify-level')).toBeVisible()
  await expect(page.getByTestId('notify-title')).toHaveValue('Macro notification')
  await expect(page.getByTestId('notify-channel-app')).toBeChecked()
  await expect(page.getByTestId('notify-app-sound')).toHaveValue('success')
  await expect(page.getByTestId('notify-app-sound')).toContainText('bell')
  await expect(page.getByTestId('notify-app-sound')).toContainText('chime')
  await expect(page.getByTestId('notify-app-sound')).toContainText('ping')
  await expect(page.getByTestId('notify-app-sound')).toContainText('pulse')
  await expect(page.getByTestId('notify-app-sound')).toContainText('success')
  await expect(page.getByTestId('notify-app-sound')).toContainText('warning')
  await expect(page.getByTestId('notify-app-sound')).toContainText('alert')
  await page.getByTestId('notify-channel-telegram').check()
  await expect(page.getByTestId('notify-telegram-profile')).toHaveValue('default')
  await expect(page.locator('input[data-testid="notify-telegram-profile"]')).toHaveCount(0)
  await expect(page.locator('select[data-testid="notify-telegram-profile"]')).toHaveCount(1)
})

test('app notify channel shows built-in floating notice during run', async ({ page, request }) => {
  const configId = 'macro-notify-run-' + Date.now()
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/templates/import', {
    data: {
      schemaVersion: 2,
      id: 'notify_app_template',
      name: 'Notify App Template',
      description: '',
      configId,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
      body: [
        { id: 'notify_first', type: 'notify', level: 'info', title: 'First Notice', message: { parts: [{ kind: 'text', text: 'First body' }] }, channels: [{ kind: 'app', toast: true, sound: 'none' }], onFailure: 'continue' },
        { id: 'notify_done', type: 'notify', level: 'success', title: 'Run Done', message: { parts: [{ kind: 'text', text: 'Macro notification body' }] }, channels: [{ kind: 'app', toast: true, sound: 'none' }], onFailure: 'continue' },
        { id: 'finish_done', type: 'finish', reason: 'done' },
      ],
    },
  })
  await page.goto('/?configId=' + configId)
  await expect(page.locator('.brand-line')).toContainText('connected')
  await request.post('/api/configs/' + configId + '/runner/start', { data: { templateId: 'notify_app_template' } })
  await expect(page.getByTestId('notice-item')).toHaveCount(1)
  await expect(page.getByTestId('notice-item')).toContainText('title: Run Done')
  await expect(page.getByTestId('notice-item')).toContainText('message: Macro notification body')
  await expect(page.getByTestId('notice-item')).toContainText('level: success')
  await expect(page.getByTestId('notice-item')).not.toContainText('First Notice')
  await expect(page.getByTestId('notice-item')).toContainText('time: ')
  await expect(page.getByTestId('notice-item')).toContainText('notification_id: notif_notify_done_')
  await expect(page.getByTestId('notice-item')).toContainText('run_id: run_')
  await expect(page.getByTestId('notice-item')).toContainText('step_id: notify_done')
  await page.waitForTimeout(300)
  await expect(page.getByTestId('notice-item')).toBeVisible()
  await page.mouse.click(4, 4)
  await expect(page.getByTestId('notice-item')).toHaveCount(0)
})


test('system notify channel requests browser permission and reports fallback', async ({ page, request }) => {
  const configId = 'macro-notify-system-' + Date.now()
  await page.addInitScript(() => {
    class MockNotification {
      static permission = 'default'
      static async requestPermission() {
        ;(window as unknown as { __notificationPermissionRequests?: number }).__notificationPermissionRequests = ((window as unknown as { __notificationPermissionRequests?: number }).__notificationPermissionRequests ?? 0) + 1
        MockNotification.permission = 'denied'
        return 'denied' as NotificationPermission
      }
      constructor(_title: string, _options?: NotificationOptions) {}
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true })
  })
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/templates/import', {
    data: {
      schemaVersion: 2,
      id: 'notify_system_template',
      name: 'Notify System Template',
      description: '',
      configId,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
      body: [
        { id: 'notify_system', type: 'notify', level: 'warning', title: 'System Only', message: { parts: [{ kind: 'text', text: 'Browser permission fallback' }] }, channels: [{ kind: 'system' }], onFailure: 'continue' },
        { id: 'finish_system', type: 'finish', reason: 'done' },
      ],
    },
  })
  await page.goto('/?configId=' + configId)
  await expect(page.locator('.brand-line')).toContainText('connected')
  await request.post('/api/configs/' + configId + '/runner/start', { data: { templateId: 'notify_system_template' } })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notificationPermissionRequests?: number }).__notificationPermissionRequests ?? 0)).toBe(1)
  await expect(page.getByTestId('notice-item')).toContainText('title: System Only')
  await expect(page.getByTestId('notice-item')).toContainText('message: System notification was not delivered.')
  await expect(page.getByTestId('notice-item')).toContainText('system_status: permission-denied')
  await expect(page.getByTestId('notice-item')).toContainText('notification_id: notif_notify_system_')
  await expect(page.getByTestId('notice-item')).toContainText('step_id: notify_system')
})


test('app notify is shown while browser system permission request is still pending', async ({ page, request }) => {
  const configId = 'macro-notify-app-system-pending-' + Date.now()
  await page.addInitScript(() => {
    class MockNotification {
      static permission = 'default'
      static async requestPermission() {
        ;(window as unknown as { __notificationPermissionRequests?: number }).__notificationPermissionRequests = ((window as unknown as { __notificationPermissionRequests?: number }).__notificationPermissionRequests ?? 0) + 1
        return new Promise<NotificationPermission>((resolve) => {
          ;(window as unknown as { __resolveNotificationPermission?: () => void }).__resolveNotificationPermission = () => {
            MockNotification.permission = 'denied'
            resolve('denied')
          }
        })
      }
      constructor(_title: string, _options?: NotificationOptions) {}
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true })
  })
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/templates/import', {
    data: {
      schemaVersion: 2,
      id: 'notify_app_system_template',
      name: 'Notify App System Template',
      description: '',
      configId,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
      body: [
        { id: 'notify_app_system', type: 'notify', level: 'info', title: 'App First', message: { parts: [{ kind: 'text', text: 'App body before permission resolves' }] }, channels: [{ kind: 'app', toast: true, sound: 'none' }, { kind: 'system' }], onFailure: 'continue' },
        { id: 'finish_app_system', type: 'finish', reason: 'done' },
      ],
    },
  })
  await page.goto('/?configId=' + configId)
  await expect(page.locator('.brand-line')).toContainText('connected')
  await request.post('/api/configs/' + configId + '/runner/start', { data: { templateId: 'notify_app_system_template' } })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notificationPermissionRequests?: number }).__notificationPermissionRequests ?? 0)).toBe(1)
  await expect(page.getByTestId('notice-item')).toContainText('title: App First')
  await expect(page.getByTestId('notice-item')).toContainText('message: App body before permission resolves')
  await expect(page.getByTestId('notice-item')).not.toContainText('system_status:')
  await page.evaluate(() => (window as unknown as { __resolveNotificationPermission?: () => void }).__resolveNotificationPermission?.())
  await expect(page.getByTestId('notice-item')).toContainText('system_status: permission-denied')
})

test('telegram profile load failure does not block macro editor', async ({ page, request }) => {
  const configId = 'macro-notify-profile-failure-' + Date.now()
  await page.route('**/api/notification-profiles/telegram', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, profiles: [], error: 'notification_profiles_invalid_json' }) })
  })
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await page.goto('/?configId=' + configId)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-notify').click()
  await page.getByTestId('notify-channel-telegram').check()
  await expect(page.getByTestId('notify-telegram-profile')).toHaveValue('default')
  await expect(page.getByTestId('notify-telegram-profile-status')).toContainText('notification_profiles_invalid_json')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
})
