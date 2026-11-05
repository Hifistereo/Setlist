import { expect, test, type Page } from '@playwright/test'

const SHEET = `Em          H7
Saule, Pērkons, Daugava`

// "Saule, Pērkons, Daugava" in Windows-1257 (Notepad "ANSI" on Latvian Windows): ē = 0xE7
const cp1257 = (s: string) => Buffer.from([...s].map((c) => ({ ē: 0xe7, ā: 0xe2, ņ: 0xf2, ļ: 0xef, ī: 0xee, š: 0xf0, ž: 0xfe, ū: 0xfb })[c] ?? c.charCodeAt(0)))

type F = { name: string; mimeType: string; buffer: Buffer }
const txt = (name: string, body: string | Buffer): F => ({ name, mimeType: 'text/plain', buffer: typeof body === 'string' ? Buffer.from(body, 'utf8') : body })

async function upload(page: Page, files: F[]) {
  await page.goto('/#/import')
  await page.getByRole('tab', { name: 'Upload .txt files' }).click()
  await page.getByLabel('Choose .txt files').setInputFiles(files)
}
const row = (page: Page, file: string) => page.locator(`li[data-file="${file}"]`)

test('paste chords straight in, without a file', async ({ page }) => {
  await page.goto('/#/import')
  await page.getByLabel('Chords and lyrics').fill(`Jumprava - Ziemeļmeita\nKey: Em\n${SHEET}`)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Ziemeļmeita')
  await expect(page.getByLabel('Artist', { exact: true })).toHaveValue('Jumprava')
  await expect(page.getByText('H notation detected')).toBeVisible()
  await page.getByRole('button', { name: 'Save song' }).click()
  await expect(page).toHaveURL(/#\/songs\/[0-9a-f-]{36}$/)
  await expect(page.locator('.cp-lyric', { hasText: 'Saule, Pērko' })).toBeVisible()
  // H notation: transposing Em up 2 gives F#m, H7 gives C#7
  await page.getByLabel('Transpose up').click()
  await page.getByLabel('Transpose up').click()
  await expect(page.locator('.cp-chord', { hasText: /^C#7$/ })).toBeVisible()
  await expect(page.getByText('Find chords')).toHaveCount(0)
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

test('upload .txt files: encodings, duplicates, bad file', async ({ page }) => {
  await upload(page, [
    txt('Jumprava - Ziemeļmeita.txt', `BPM: 120\n${SHEET}`),
    txt('Līvi - Dzelzs vilks.txt', cp1257(`Am   G\nSaule, Pērkons, Daugava`)),
    txt('jumprava - ziemeļmeita (copy).txt', SHEET),
    txt('JUMPRAVA - ZIEMEĻMEITA.txt', SHEET),
    { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0x14, 0]) },
  ])
  await expect(row(page, 'broken.txt')).toContainText("Can't read")
  await expect(row(page, 'JUMPRAVA - ZIEMEĻMEITA.txt')).toContainText('Same song as “Jumprava - Ziemeļmeita.txt”')
  await expect(row(page, 'JUMPRAVA - ZIEMEĻMEITA.txt').getByRole('checkbox')).not.toBeChecked()
  await expect(row(page, 'Līvi - Dzelzs vilks.txt').getByLabel('Title')).toHaveValue('Dzelzs vilks')
  await row(page, 'Līvi - Dzelzs vilks.txt').getByRole('button', { name: 'Preview' }).click()
  await expect(row(page, 'Līvi - Dzelzs vilks.txt').locator('.cp-lyric', { hasText: 'Pērko' })).toBeVisible()
  await expect(row(page, 'Jumprava - Ziemeļmeita.txt').getByLabel('BPM')).toHaveValue('120')
  // "(copy)" has a different title: imported unless unticked
  await row(page, 'jumprava - ziemeļmeita (copy).txt').getByRole('checkbox').uncheck()
  await page.getByRole('button', { name: 'Import 2 songs' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toContainText('2 saved on this device')

  await page.goto('/#/songs')
  await expect(page.getByText('Ziemeļmeita', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Dzelzs vilks')).toBeVisible()

  // Importing the same song again: flagged, skipped by default, can replace its chords instead
  await upload(page, [txt('Jumprava - Ziemeļmeita.txt', 'Am\nJauni vārdi')])
  const r = row(page, 'Jumprava - Ziemeļmeita.txt')
  await expect(r).toContainText('Already in your songs')
  await expect(page.getByRole('button', { name: 'Import 0 songs' })).toBeDisabled()
  await r.getByLabel(/What to do with/).selectOption('replace')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Import 1 song' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toContainText('1 saved')
  await r.getByRole('link', { name: 'Saved ✓' }).click()
  await expect(page.locator('.cp-lyric', { hasText: 'Jauni vārdi' })).toBeVisible()
  await expect(page.locator('.cp-lyric', { hasText: 'Saule' })).toHaveCount(0)
  await page.goto('/#/songs')
  await expect(page.getByText('Ziemeļmeita', { exact: true })).toHaveCount(1)

  // Two files appended to the same song in one batch: both parts are kept
  await upload(page, [txt('Jumprava - Ziemeļmeita.txt', 'Am\nPirmā daļa'), txt('Jumprava - Ziemeļmeita (2).txt', 'Title: Ziemeļmeita\nArtist: Jumprava\nG\nOtrā daļa')])
  for (const f of ['Jumprava - Ziemeļmeita.txt', 'Jumprava - Ziemeļmeita (2).txt']) await row(page, f).getByLabel(/What to do with/).selectOption('append')
  await page.getByRole('button', { name: 'Import 2 songs' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toContainText('2 saved')
  await row(page, 'Jumprava - Ziemeļmeita.txt').getByRole('link', { name: 'Saved ✓' }).click()
  await expect(page.locator('.cp-lyric', { hasText: 'Jauni vārdi' })).toBeVisible()
  await expect(page.locator('.cp-lyric', { hasText: 'Pirmā daļa' })).toBeVisible()
  await expect(page.locator('.cp-lyric', { hasText: 'Otrā daļa' })).toBeVisible()
})

test('bulk import works offline', async ({ page, context }) => {
  await page.goto('/#/songs')
  await context.setOffline(true)
  await upload(page, [txt('A - Pirmā.txt', SHEET), txt('B - Otrā.txt', SHEET)])
  await page.getByRole('button', { name: 'Import 2 songs' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toContainText('2 saved on this device')
  await page.goto('/#/songs')
  await expect(page.getByText('Pirmā')).toBeVisible()
  await expect(page.getByText('Otrā')).toBeVisible()
  await context.setOffline(false)
})

test('song editor: load .txt, replace vs add, undo restores notation', async ({ page }) => {
  await page.goto('/#/songs/new')
  await page.getByLabel('Load .txt file').setInputFiles([txt('Jumprava - Ziemeļmeita.txt', SHEET)])
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Ziemeļmeita')
  await page.getByRole('button', { name: 'Convert & insert' }).click()
  await expect(page.getByLabel('Chord names')).toHaveValue('h')

  await page.getByRole('button', { name: 'Paste chord sheet' }).click()
  await page.getByPlaceholder(/Here comes the sun/).fill('C    G\nCits teksts')
  await page.getByRole('button', { name: 'Add to end' }).click()
  await expect(page.getByLabel('Lyrics and chords')).toHaveValue(/Saule[\s\S]*Cits .*teksts/)

  await page.getByRole('button', { name: 'Paste chord sheet' }).click()
  await page.getByPlaceholder(/Here comes the sun/).fill('C    G\nTikai šis')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Replace' }).click()
  await expect(page.getByLabel('Lyrics and chords')).toHaveValue('[C]Tikai[G] šis')
  await expect(page.getByLabel('Chord names')).toHaveValue('standard')

  await page.getByRole('button', { name: 'Undo convert' }).click()
  await expect(page.getByLabel('Lyrics and chords')).toHaveValue(/Saule[\s\S]*Cits .*teksts/)
  await expect(page.getByLabel('Chord names')).toHaveValue('h')
})
