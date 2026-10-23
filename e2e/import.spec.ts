import { expect, test } from '@playwright/test'

const SHEET = `Em          H7
Saule, Pērkons, Daugava`

test('share target path lands on the import screen and creates a song', async ({ page }) => {
  await page.goto(`/import?title=${encodeURIComponent('Jumprava - Ziemeļmeita | akordi.lv')}&text=${encodeURIComponent(SHEET)}&url=${encodeURIComponent('https://akordi.lv/x')}`)
  await expect(page).toHaveURL(/#\/import\?/)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Ziemeļmeita')
  await expect(page.getByLabel('Artist', { exact: true })).toHaveValue('Jumprava')
  await expect(page.getByText('H notation detected')).toBeVisible()
  await expect(page.locator('.cp-chord', { hasText: /^H7$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Create song' }).click()
  // Saving is async: wait until we're on the new song, not the import screen (which shows the same text).
  await expect(page).toHaveURL(/#\/songs\/[0-9a-f-]{36}$/)
  await expect(page.locator('.cp-lyric', { hasText: 'Saule, Pērko' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Source: akordi\.lv/ })).toHaveAttribute('href', 'https://akordi.lv/x')
  // H notation: transposing Em up 2 gives F#m, H7 gives C#7
  await page.getByLabel('Transpose up').click()
  await page.getByLabel('Transpose up').click()
  await expect(page.locator('.cp-chord', { hasText: /^C#7$/ })).toBeVisible()
})

test('paste from clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#/import')
  await page.evaluate((t) => navigator.clipboard.writeText(t), `Prāta Vētra – Tu jau esi\n${SHEET}`)
  await page.getByRole('button', { name: 'Paste from clipboard' }).click()
  await expect(page.getByLabel('Artist', { exact: true })).toHaveValue('Prāta Vētra')
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Tu jau esi')
  await expect(page.locator('.cp-chord', { hasText: /^Em$/ })).toBeVisible()
})

test('Send to Setlist bookmarklet grabs the chord block of a page', async ({ page, context, baseURL }) => {
  await page.goto('/#/band')
  const code = await page.getByRole('link', { name: 'Send to Setlist' }).getAttribute('href')
  expect(code).toMatch(/^javascript:/)
  // A chord site page: the chart is in a <pre>, surrounded by other text.
  const site = await context.newPage()
  await site.route('https://chords.example/**', (r) => r.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<html><head><title>Jumprava - Ziemeļmeita akordi</title></head><body><nav>Menu Login</nav><pre>${SHEET}</pre><footer>Ads</footer></body></html>`,
  }))
  await site.goto('https://chords.example/song')
  const popup = context.waitForEvent('page')
  await site.evaluate((js) => { (0, eval)(decodeURIComponent(js.slice('javascript:'.length))) }, code!)
  const app = await popup
  await app.waitForLoadState()
  expect(app.url().startsWith(baseURL!)).toBe(true)
  await expect(app.getByLabel('Title', { exact: true })).toHaveValue('Ziemeļmeita')
  await expect(app.getByLabel('Imported text')).toHaveValue(SHEET)
})
