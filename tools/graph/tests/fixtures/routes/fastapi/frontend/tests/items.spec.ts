import { test } from '@playwright/test'

test('items', async ({ page }) => {
  await page.goto('/items')
})
