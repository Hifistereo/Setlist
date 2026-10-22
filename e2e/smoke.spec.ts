import { expect, test } from '@playwright/test'

const MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Lead Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`

const SHEET = `[Verse]
G                D
Walking down the empty street
Em               C
Nothing here but you and me`

async function expectTabRendered(page: import('@playwright/test').Page) {
  // alphaTab renders lazily when the score is on screen, so keep scrolling it into view while waiting.
  const surface = page.locator('.at-surface').first()
  await expect(surface).toBeAttached({ timeout: 20_000 })
  await expect.poll(async () => {
    await surface.scrollIntoViewIfNeeded().catch(() => {})
    return page.locator('.at-surface svg').count()
  }, { timeout: 20_000 }).toBeGreaterThan(0)
}

test('demo: song → chord sheet → tabs → setlist → gig download → offline stage', async ({ page, context }) => {
  const shots = process.env.SHOTS
  await page.goto('/')
  await expect(page.getByText('DEMO — data stays in this browser')).toBeVisible()
  await expect(page.getByText('Saturday club gig')).toBeVisible()
  // let the service worker install & take control so the offline part is real
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  // New song from a pasted chord sheet
  await page.getByRole('navigation').getByRole('link', { name: /Songs/ }).click()
  await page.getByRole('button', { name: '+ Song' }).click()
  await page.getByLabel('Title').fill('Empty Street')
  await page.getByLabel('Artist').fill('Henrix Band')
  await page.getByLabel('Key').fill('G')
  await page.getByLabel('BPM').fill('96')
  await page.getByLabel('Duration (m:ss)').fill('3:30')
  await page.getByRole('button', { name: 'Paste chord sheet' }).click()
  await page.getByPlaceholder(/Here comes the sun/).fill(SHEET)
  await page.getByRole('button', { name: 'Convert & insert' }).click()
  await expect(page.getByLabel('Lyrics and chords')).toHaveValue(/\[G\]Walking down the \[D\]empty street/)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.cp-chord', { hasText: /^D$/ }).first()).toBeVisible()
  // transpose up 2 → G becomes A
  await page.getByLabel('Transpose up').click()
  await page.getByLabel('Transpose up').click()
  await expect(page.getByText('Key A (orig. G)')).toBeVisible()
  await expect(page.locator('.cp-chord', { hasText: /^E$/ }).first()).toBeVisible()
  // private note
  await page.getByPlaceholder('Capo, effects, cues, reminders…').fill('Capo 2 on the acoustic')
  await page.getByPlaceholder('Capo, effects, cues, reminders…').blur()

  // Import a MusicXML file and see it rendered by alphaTab
  await page.locator('input[type=file]').setInputFiles({ name: 'solo.musicxml', mimeType: 'application/xml', buffer: Buffer.from(MUSICXML) })
  await expectTabRendered(page)
  await expect(page.getByText('Could not read this tab')).toHaveCount(0)
  if (shots) await page.screenshot({ path: `${shots}/song.png`, fullPage: true })

  // alphaTex riff editor with live preview
  await page.getByRole('button', { name: '+ Riff / solo (alphaTex)' }).click()
  await expect(page.getByLabel('alphaTex source')).toBeVisible()
  await expectTabRendered(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // Add it to the setlist and reorder with the keyboard
  await page.getByRole('navigation').getByRole('link', { name: /Setlists/ }).click()
  await page.getByText('Saturday club gig').click()
  await page.getByRole('button', { name: '+ Songs' }).click()
  await page.getByPlaceholder('Search songs…').fill('Empty')
  await page.getByRole('dialog').getByRole('button', { name: /Empty Street/ }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  const rows = page.locator('li', { has: page.getByLabel('Drag') })
  await expect(rows.last()).toContainText('Empty Street')
  const firstBefore = await rows.nth(0).innerText()
  const handle = rows.nth(1).getByLabel('Drag')
  await handle.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(300)
  await page.keyboard.press('Space')
  await expect(rows.nth(1)).toContainText(firstBefore.split('\n').find((l) => /[a-z]/i.test(l) && !/^\d/.test(l))!)
  await expect(page.getByText(/Ends ≈ \d\d:\d\d/)).toBeVisible()

  // Gig download + verification
  await page.getByRole('button', { name: 'Download for gig' }).click()
  await expect(page.getByText('Offline ready ✓')).toBeVisible({ timeout: 30_000 })
  if (shots) await page.screenshot({ path: `${shots}/setlist.png`, fullPage: true })

  // Go offline, reload, play the show
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Saturday club gig')).toBeVisible()
  await page.getByRole('link', { name: 'Stage' }).first().click()
  // after the reorder above, Demo Groove is the second song
  await expect(page.getByText('Next: Demo Groove')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('My note: watch Anna')).toBeVisible()
  await page.getByRole('button', { name: 'Tab' }).click()
  await expectTabRendered(page)
  await expect(page.getByRole('button', { name: /Play/ })).toBeEnabled({ timeout: 20_000 })
  if (shots) await page.screenshot({ path: `${shots}/stage-tab.png` })
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText(/Next:/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Stage' }).first().click()
  await expect(page.getByText(/Next:/)).toBeVisible()
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Last song')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  if (shots) await page.screenshot({ path: `${shots}/stage.png` })
})
