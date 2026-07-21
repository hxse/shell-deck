import { expect } from 'playwright/test'

async function openTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

function deferredGate() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}

async function forceInput(input: import('playwright/test').Locator, value: string) {
  await input.evaluate((element, next) => {
    const target = element as HTMLInputElement
    target.disabled = false
    target.value = next
    target.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

export {
  openTemplateDrawer,
  deferredGate,
  forceInput,
}
