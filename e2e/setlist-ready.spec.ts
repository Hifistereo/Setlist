import { expect, test, type Page } from '@playwright/test'

const LIST = `Set 1
1. Superstition – Stevie Wonder
2. Amy Winehouse – Valerie
3. Dancing Queen – ÅBBA
4. Sex Bomb – Tom Jones
5. Laternas – Sudden Lights
---
6. Sex Bomb – Tom Jones`

const CHART = `Am          F
Very superstitious
C           G
Writing's on the wall`

const row = (page: Page, title: string) => page.locator('[data-song-row]').filter({ hasText: title }).first()

test('paste a setlist, see what is missing, fill a chart, verify it', async ({ page, context }) => {
  // Finder links open external sites; keep them offline-safe.
  await context.route(/^https:\/\/(?!localhost)/, (r) => r.fulfill({ contentType: 'text/html', body: '<p>chord site</p>' }))
  await page.goto('/')
  await expect(page.getByText('Saturday club gig')).toBeVisible()
  await page.getByRole('navigation').getByRole('link', { name: /Setlists/ }).click()
  await page.getByRole('button', { name: '+ Setlist' }).click()
  await expect(page).toHaveURL(/#\/setlists\/[0-9a-f-]{36}$/)
  const setlistUrl = page.url()

  // ── Bulk paste with matching ──
  await page.getByRole('button', { name: 'Paste songs' }).click()
  await page.getByLabel('Song list').fill(LIST)
  const rows = page.getByTestId('bulk-row')
  await expect(rows).toHaveCount(6)
  await expect(rows.nth(0)).toContainText('Matched')
  await expect(rows.nth(1)).toContainText('Matched') // swapped title/artist
  await expect(rows.nth(2)).toContainText('Confirm?') // accents differ: must be confirmed
  await expect(rows.nth(3)).toContainText('New song')
  const add = page.getByRole('button', { name: 'Add to setlist' })
  await expect(add).toBeDisabled()
  await page.getByLabel('Match for Dancing Queen').selectOption({ label: 'Dancing Queen – ABBA' })
  await expect(add).toBeEnabled()
  await add.click()
  await expect(page.getByRole('dialog', { name: 'Paste songs' })).toBeHidden()

  await expect(page.locator('[data-song-row]')).toHaveCount(6)
  await expect(page.getByTestId('chart-summary')).toHaveText('0 of 6 charts ready')
  await expect(row(page, 'Superstition').getByRole('button', { name: 'Chart: Find chords' })).toBeVisible()
  await expect(page.getByText('Set 1', { exact: false }).first()).toBeVisible()

  // The duplicate line became one song, used twice.
  await page.getByRole('navigation').getByRole('link', { name: /Songs/ }).click()
  await expect(page.getByRole('link', { name: /Sex Bomb/ })).toHaveCount(1)
  await expect(page.getByRole('link', { name: /Dancing Queen/ })).toHaveCount(1)
  await page.goto(setlistUrl)

  // ── Find chords → Paste chart lands on the right song and returns to the setlist ──
  await row(page, 'Superstition').getByRole('button', { name: 'Chart: Find chords' }).click()
  const sheet = page.getByRole('dialog', { name: 'Chart for Superstition' })
  await expect(sheet.getByRole('link', { name: /Ultimate Guitar/ })).toHaveAttribute('href', /Stevie%20Wonder%20Superstition/)
  await sheet.getByRole('link', { name: 'Paste chart' }).click()
  await expect(page).toHaveURL(/#\/import\?song=.+&from=setlist:/)
  await expect(page.getByRole('status', { name: 'Import target' })).toContainText('Superstition – Stevie Wonder')
  await page.getByLabel('Imported text').fill(CHART)
  await page.getByRole('button', { name: 'Add to song' }).click()
  await expect(page).toHaveURL(/#\/setlists\/[0-9a-f-]{36}\?highlight=/)
  await expect(row(page, 'Superstition')).toHaveClass(/ring-accent/)
  await expect(row(page, 'Superstition').getByRole('button', { name: 'Chart: Draft' })).toBeVisible()

  // ── Verify → Ready; edit the chart → Needs review ──
  await row(page, 'Superstition').getByRole('link').first().click()
  await page.getByTestId('chart-check').getByRole('button', { name: 'Mark verified' }).click()
  await expect(page.getByTestId('chart-check')).toContainText('Ready')
  await page.goto(setlistUrl)
  await expect(page.getByTestId('chart-summary')).toHaveText('1 of 6 charts ready')
  await page.getByLabel('Show missing only').check()
  await expect(page.locator('[data-song-row]')).toHaveCount(5)
  await page.getByLabel('Show missing only').uncheck()

  await row(page, 'Superstition').getByRole('link').first().click()
  await page.getByRole('link', { name: 'Edit' }).click()
  const lyrics = page.getByLabel('Lyrics and chords')
  await lyrics.fill((await lyrics.inputValue()).replace('[F]', '[Dm]'))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('chart-check')).toContainText('Needs review')

  // ── Handoff via "Find chords" remembered on this device ──
  await page.goto(setlistUrl)
  await row(page, 'Laternas').getByRole('button', { name: 'Chart: Find chords' }).click()
  const popup = context.waitForEvent('page')
  await page.getByRole('dialog', { name: 'Chart for Laternas' }).getByRole('link', { name: /akordi\.lv/ }).click()
  await (await popup).close()
  // Coming back through a share/bookmarklet opens /import without ?song=
  await page.goto('/#/import')
  await expect(page.getByRole('status', { name: 'Import target' })).toContainText('Laternas – Sudden Lights')
  await expect(page.getByText('Remembered from “Find chords”')).toBeVisible()

  // An expired context is never guessed: the user must pick.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('setlist.pendingImport:')) localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k)!), expires: 1 }))
    }
  })
  await page.reload()
  await expect(page.getByText(/pick the song below/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to song' })).toBeDisabled()
  await page.getByLabel('Save to').selectOption({ label: 'New song' })
  await expect(page.getByRole('button', { name: 'Create song' })).toBeEnabled()

  // ── Offline: song and import screens still work; chart status is not an offline claim ──
  await page.goto(setlistUrl)
  await context.setOffline(true)
  await expect(page.getByTestId('chart-summary')).not.toContainText(/offline/i)
  await row(page, 'Superstition').getByRole('button', { name: 'Chart: Needs review' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'View chart' }).click()
  await expect(page.locator('.cp-chord', { hasText: /^Dm$/ }).first()).toBeVisible()
  await page.evaluate(() => { location.hash = '#/import' })
  await expect(page.getByRole('button', { name: 'Paste from clipboard' })).toBeVisible()
  await context.setOffline(false)
})
