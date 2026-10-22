import type { SyncEngine } from './sync/engine'
import { generateNKeysBetween } from 'fractional-indexing'

const DEMO_CHART = `{title: Demo Groove}
{key: E}
{tempo: 104}
{comment: Intro — riff x2 (see tab)}

{start_of_verse}
[E7]Lights go down and the [A7]crowd starts to sway
[E7]Five of us standing where the [B7]spotlights play
{end_of_verse}

{start_of_chorus}
[A]Turn it up, [E]turn it loud
[C#m]Sing it back, [B]sing it proud
{end_of_chorus}

{comment: Solo over verse changes, then chorus x2}
`

export const DEMO_RIFF_TEX = `\\title "Demo Groove riff"
\\tempo 104
.
:8 0.6 0.6 3.6 0.6 2.5 0.6 3.6 2.5 | 0.6 0.6 3.6 0.6 2.5 4.5 2.5 0.6 |
:8 0.5 0.5 3.5 0.5 2.4 0.5 3.5 2.4 | :4 2.5 4.5 :2 2.4`

const COVERS: [string, string, string, number, number, string[]][] = [
  ['Superstition', 'Stevie Wonder', 'Ebm', 100, 245, ['funk', 'opener']],
  ['Valerie', 'Amy Winehouse', 'Eb', 104, 219, ['soul']],
  ['Sweet Child O\' Mine', 'Guns N\' Roses', 'D', 125, 356, ['rock']],
  ['Uptown Funk', 'Bruno Mars', 'Dm', 115, 270, ['funk', 'dance']],
  ['Seven Nation Army', 'The White Stripes', 'Em', 124, 232, ['rock']],
  ['Dancing Queen', 'ABBA', 'A', 101, 231, ['disco', 'dance']],
  ['Mr. Brightside', 'The Killers', 'Db', 148, 222, ['rock', 'closer']],
]

/** Populate the demo database once. Covers carry metadata only — add your own charts. */
let seeding: Promise<void> | null = null
export function seedDemo(engine: SyncEngine) {
  seeding ??= doSeed(engine)
  return seeding
}

async function doSeed(engine: SyncEngine) {
  const { db } = engine
  if (await db.getMeta('seeded', false)) return
  await db.setMeta('seeded', true)
  await db.members.put({ band_id: engine.bandId, user_id: engine.userId, display_name: 'You', instrument: 'guitar', role: 'admin' })
  await db.bands.put({ id: engine.bandId, name: 'Demo Band' })
  const demo = await engine.mutate('songs', null, {
    title: 'Demo Groove', artist: 'Demo Band', key: 'E', bpm: 104, duration_sec: 210,
    lyrics_chordpro: DEMO_CHART, arrangement: 'Intro riff ×2 · V · C · V · C · Solo · C ×2 · Outro', tags: ['original'],
  })
  await engine.mutate('song_files', null, { song_id: demo, kind: 'tex', name: 'Main riff', part: 'Guitar', tex: DEMO_RIFF_TEX })
  await engine.mutate('song_notes', null, { song_id: demo, note: 'My note: watch Anna for the stop before the last chorus.' })
  const ids = [demo]
  for (const [title, artist, key, bpm, duration_sec, tags] of COVERS) {
    ids.push(await engine.mutate('songs', null, { title, artist, key, bpm, duration_sec, tags }))
  }
  const sl = await engine.mutate('setlists', null, { name: 'Saturday club gig', venue: 'The Venue', start_time: '21:00', gig_date: new Date().toISOString().slice(0, 10) })
  const keys = generateNKeysBetween(null, null, ids.length + 2)
  let k = 0
  for (const [i, id] of ids.entries()) {
    if (i === 4) await engine.mutate('setlist_items', null, { setlist_id: sl, position: keys[k++], type: 'break', label: 'Break', duration_sec: 900 })
    if (i === 4) await engine.mutate('setlist_items', null, { setlist_id: sl, position: keys[k++], type: 'section', label: 'Set 2' })
    await engine.mutate('setlist_items', null, { setlist_id: sl, position: keys[k++], type: 'song', song_id: id })
  }
}
