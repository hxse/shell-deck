import { expect, test } from 'playwright/test'

test('run log panel creates recoverable run log, shows folded node logs and restores after reload', async ({ page }) => {
  await page.goto('/?configId=run-log-e2e')
  await expect(page.getByTestId('run-log-panel')).toBeVisible()
  await expect(page.getByTestId('run-list-item')).toHaveCount(0)

  await page.getByTestId('run-create').click()
  await expect(page.getByTestId('run-list-item')).toHaveCount(1)
  await expect(page.getByTestId('run-derived-status')).toHaveText('running')

  await page.getByTestId('run-append-demo').click()
  await expect(page.getByTestId('run-derived-status')).toHaveText('paused')
  await expect(page.getByTestId('run-node-log')).toHaveCount(8)
  await expect(page.getByTestId('run-node-log').first()).not.toHaveAttribute('open', '')

  const nodeCount = await page.getByTestId('run-node-log').count()
  for (let index = 0; index < nodeCount; index += 1) {
    await page.getByTestId('run-node-log').nth(index).locator('summary').click()
  }
  for (const prefix of ['send', 'input', 'sleep', 'capture', 'parser', 'branch', 'control']) {
    await expect(page.getByTestId('run-log-panel')).toContainText(new RegExp('artifacts/' + prefix + '-'))
  }

  await page.locator('.run-ai-trace summary').click()
  await expect(page.getByTestId('run-ai-trace')).toContainText('"nodeLogs"')
  await expect(page.getByTestId('run-ai-trace')).toContainText('"artifactRef"')
  await expect(page.getByTestId('run-ai-trace')).toContainText('"control_transition"')

  await page.reload()
  await expect(page.getByTestId('run-list-item')).toHaveCount(1)
  await expect(page.getByTestId('run-derived-status')).toHaveText('paused')
  await page.getByTestId('run-node-log').nth(1).locator('summary').click()
  await expect(page.getByTestId('run-artifact-ref').first()).toContainText(/artifacts\/send-/)
})
