import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { matchSong, parseSongLines, planBulkImport, runBulkPlan, type ResolvedRow } from './bulkSongs'
import { chartChords, chartFingerprint, readiness } from './readiness'
import { clearPendingImport, readPendingImport, setPendingImport } from './pendingImport'
import { setlistTotals } from './time'
import { emptyRow, type Song } from './types'
import { SetlistDB } from './db'
import { SyncEngine } from './sync/engine'
import { FakeBackend } from './sync/fakeServer'

// vitest runs in node: give pendingImport a minimal localStorage.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const m = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  } as Storage
}

const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song =>
  ({ ...emptyRow('songs', id, 'band'), title, artist, ...extra })

const LIB = [
  song('s1', 'Superstition', 'Stevie Wonder'),
  song('s2', 'Valerie', 'Amy Winehouse'),
  song('s3', 'Valerie', 'The Zutons'),
  song('s4', 'Tu jau esi', 'Prāta Vētra'),
  song('s5', 'Laternas', ''),
  song('s6', "Sweet Child O' Mine", "Guns N' Roses"),
  song('s7', 'Deleted', 'X', { deleted_at: '2026-01-01' }),
]

describe('parseSongLines', () => {
  it('reads numbering, separators, "by" and sections in either order', () => {
    const lines = parseSongLines('Set 1\n1. Superstition – Stevie Wonder\n2) Sex Bomb - Tom Jones\n\nValerie by Amy Winehouse\n---\nLaternas\nencore:', 'title-artist')
    expect(lines.map((l) => l.kind === 'song' ? [l.title, l.artist] : ['§', l.label])).toEqual([
      ['§', 'Set 1'], ['Superstition', 'Stevie Wonder'], ['Sex Bomb', 'Tom Jones'], ['Valerie', 'Amy Winehouse'], ['§', ''], ['Laternas', ''], ['§', 'encore'],
    ])
    const flipped = parseSongLines('Stevie Wonder – Superstition\nValerie by Amy Winehouse', 'artist-title')
    expect(flipped[0]).toMatchObject({ title: 'Superstition', artist: 'Stevie Wonder' })
    expect(flipped[1]).toMatchObject({ title: 'Valerie', artist: 'Amy Winehouse' })
  })

  it('treats only explicit dividers as sections', () => {
    const lines = parseSongLines('Set Fire to the Rain – Adele\nSettle Down\nSet II:\n2. komplekts\n3. Encore\nEncore Une Fois – Sash!\n===', 'title-artist')
    expect(lines.map((l) => l.kind === 'song' ? l.title : `§${l.label}`)).toEqual(
      ['Set Fire to the Rain', 'Settle Down', '§Set II', '§2. komplekts', '§Encore', 'Encore Une Fois', '§'])
  })

  it('keeps hyphenated titles that have no spaced separator', () => {
    expect(parseSongLines('Ob-La-Di, Ob-La-Da', 'title-artist')[0]).toMatchObject({ title: 'Ob-La-Di, Ob-La-Da', artist: '' })
  })
})

describe('matchSong', () => {
  it('matches exact title+artist ignoring case and punctuation', () => {
    expect(matchSong({ title: 'superstition', artist: 'STEVIE WONDER' }, LIB)).toMatchObject({ status: 'exact', song: { id: 's1' } })
    expect(matchSong({ title: 'Sweet Child O Mine', artist: 'Guns N Roses' }, LIB)).toMatchObject({ status: 'exact', song: { id: 's6' } })
  })

  it('matches swapped title/artist when unique', () => {
    expect(matchSong({ title: 'Stevie Wonder', artist: 'Superstition' }, LIB)).toMatchObject({ status: 'exact', song: { id: 's1' } })
  })

  it('matches a unique title alone, and a library song with no artist', () => {
    expect(matchSong({ title: 'Superstition', artist: '' }, LIB)).toMatchObject({ status: 'exact', song: { id: 's1' } })
    expect(matchSong({ title: 'Laternas', artist: 'Sudden Lights' }, LIB)).toMatchObject({ status: 'exact', song: { id: 's5' } })
  })

  it('asks when a title alone fits several songs', () => {
    const m = matchSong({ title: 'Valerie', artist: '' }, LIB)
    expect(m.status).toBe('suggested')
    expect(m.candidates.map((s) => s.id).sort()).toEqual(['s2', 's3'])
  })

  it('never matches an explicitly different artist on title alone', () => {
    const m = matchSong({ title: 'Superstition', artist: 'Beck, Bogert & Appice' }, LIB)
    expect(m.status).toBe('new')
    expect(m.candidates.map((s) => s.id)).toEqual(['s1'])
  })

  it('only suggests accent-insensitive hits', () => {
    expect(matchSong({ title: 'Tu jau esi', artist: 'Prata Vetra' }, LIB)).toMatchObject({ status: 'suggested', candidates: [{ id: 's4' }] })
  })

  it('ignores deleted songs and unknown titles', () => {
    expect(matchSong({ title: 'Deleted', artist: 'X' }, LIB)).toEqual({ status: 'new', candidates: [] })
    expect(matchSong({ title: 'Sex Bomb', artist: 'Tom Jones' }, LIB)).toEqual({ status: 'new', candidates: [] })
  })
})

describe('planBulkImport', () => {
  const rows: ResolvedRow[] = [
    { kind: 'section', label: '' },
    { kind: 'song', songId: 's1', title: 'Superstition', artist: 'Stevie Wonder' },
    { kind: 'song', songId: null, title: 'Sex Bomb', artist: 'Tom Jones' },
    { kind: 'song', songId: null, title: 'sex bomb', artist: 'TOM JONES' },
    { kind: 'section', label: '' },
    { kind: 'song', songId: null, title: 'Laternas', artist: 'Sudden Lights' },
  ]
  const opts = { importId: 'imp-1', setlistId: 'sl', rows, lastPosition: null, currentSet: 1, currentSetHasSongs: false }

  it('creates one song for a repeated line but two setlist entries, with ordered positions', async () => {
    const plan = await planBulkImport(opts)
    expect(plan.songs.map((s) => s.title)).toEqual(['Sex Bomb', 'Laternas'])
    const songItems = plan.items.filter((i) => i.type === 'song')
    expect(songItems[1].song_id).toBe(songItems[2].song_id)
    expect(plan.items.map((i) => i.position)).toEqual([...plan.items.map((i) => i.position)].sort())
    // A leading divider names set 1 instead of starting set 2.
    expect(plan.items.filter((i) => i.type === 'section').map((i) => i.label)).toEqual(['Set 1', 'Set 2'])
  })

  it('is deterministic: the same import gives the same ids', async () => {
    expect(await planBulkImport(opts)).toEqual(await planBulkImport(opts))
    expect((await planBulkImport({ ...opts, importId: 'imp-2' })).items[0].id).not.toBe((await planBulkImport(opts)).items[0].id)
  })

  it('appends after existing items and continues set numbering', async () => {
    const plan = await planBulkImport({ ...opts, lastPosition: 'a5', currentSet: 2, currentSetHasSongs: true })
    expect(plan.items.every((i) => i.position > 'a5')).toBe(true)
    expect(plan.items.filter((i) => i.type === 'section').map((i) => i.label)).toEqual(['Set 3', 'Set 4'])
  })
})

describe('runBulkPlan', () => {
  let backend: FakeBackend
  beforeEach(() => {
    backend = new FakeBackend()
    backend.members = [{ band_id: 'band', user_id: 'anna', display_name: 'anna', instrument: '', role: 'member' }]
  })

  it('a retried plan creates no duplicates and keeps edits made in between', async () => {
    const engine = new SyncEngine(new SetlistDB(`bulk-${Math.random()}`), backend.client('anna'), 'anna', 'band')
    const sl = await engine.mutate('setlists', null, { name: 'Gig' })
    const plan = await planBulkImport({
      importId: 'x', setlistId: sl, lastPosition: null, currentSet: 1, currentSetHasSongs: false,
      rows: [{ kind: 'song', songId: null, title: 'Sex Bomb', artist: 'Tom Jones' }, { kind: 'song', songId: null, title: 'Kiss', artist: 'Prince' }],
    })
    // Partial run: only the first song made it.
    await runBulkPlan(engine, { ...plan, songs: plan.songs.slice(0, 1), items: [] })
    await engine.mutate('songs', plan.songs[0].id, { key: 'C' })
    await runBulkPlan(engine, plan)
    await runBulkPlan(engine, plan)
    await engine.syncNow()
    const rows = [...backend.rows.values()]
    expect(rows.filter((r) => r.table === 'songs')).toHaveLength(2)
    expect(rows.filter((r) => r.table === 'setlist_items')).toHaveLength(2)
    expect(backend.rows.get(plan.songs[0].id)?.row.key).toBe('C')
  })
})

describe('setlistTotals', () => {
  it('a leading set divider does not create an empty set', () => {
    const t = setlistTotals([{ type: 'section', duration: null }, { type: 'song', duration: 100 }, { type: 'section', duration: null }, { type: 'song', duration: 50 }])
    expect(t.sets.map((s) => s.index)).toEqual([1, 2])
  })
})

describe('readiness', () => {
  const chart = '{start_of_verse}\n[Am]Hello [F]world\n{end_of_verse}'

  it('counts only real chords', () => {
    expect(chartChords('[Verse]\n[Intro] la la\n[Am]x [N.C.] y [Hm7]z')).toEqual(['Am', 'Hm7'])
  })

  it('tells empty, lyrics-only, label-only, TAB-only and charted songs apart', () => {
    expect(readiness(song('a', 'A', '')).status).toBe('missing')
    expect(readiness(song('a', 'A', '', { lyrics_chordpro: 'Just words' })).status).toBe('lyrics-only')
    expect(readiness(song('a', 'A', '', { lyrics_chordpro: '[Verse]\nwords [Chorus]' })).status).toBe('lyrics-only')
    const tabbed = readiness(song('a', 'A', ''), [{ kind: 'gp', deleted_at: null }])
    expect(tabbed).toEqual({ status: 'tab-only', chords: 0, tab: true })
    expect(readiness(song('a', 'A', ''), [{ kind: 'pdf', deleted_at: null }, { kind: 'gp', deleted_at: '2026-01-01' }]).tab).toBe(false)
    expect(readiness(song('a', 'A', '', { lyrics_chordpro: chart })).status).toBe('draft')
  })

  it('verification follows the chart content, not other fields', () => {
    const s = song('a', 'A', '', { lyrics_chordpro: chart })
    const verified = { ...s, chart_verified_hash: chartFingerprint(s) }
    expect(readiness(verified).status).toBe('ready')
    expect(readiness({ ...verified, key: 'C', title: 'Renamed', bpm: 99 }).status).toBe('ready')
    expect(readiness({ ...verified, lyrics_chordpro: `${chart}  \n\n\n` }).status).toBe('ready')
    expect(readiness({ ...verified, lyrics_chordpro: chart.replace('[F]', '[G]') }).status).toBe('needs-review')
    expect(readiness({ ...verified, chord_notation: 'h' }).status).toBe('needs-review')
  })

  it('respects H notation', () => {
    const s = song('a', 'A', '', { lyrics_chordpro: '[H7]x [B]y', chord_notation: 'h' })
    expect(chartChords(s.lyrics_chordpro)).toEqual(['H7', 'B'])
    expect(chartFingerprint(s)).not.toBe(chartFingerprint({ ...s, chord_notation: 'standard', lyrics_chordpro: '[B7]x [Bb]y' }))
  })
})

describe('pendingImport', () => {
  const exists = (id: string) => id === 'song-1'
  beforeEach(() => localStorage.clear())

  it('restores a fresh context for the same user, band and song', () => {
    setPendingImport({ userId: 'u', bandId: 'b', songId: 'song-1', setlistId: 'sl' }, 1000)
    expect(readPendingImport('u', 'b', exists, 2000)).toMatchObject({ ok: true, value: { songId: 'song-1', setlistId: 'sl' } })
  })

  it('rejects expired, other-account and deleted-song contexts', () => {
    setPendingImport({ userId: 'u', bandId: 'b', songId: 'song-1', setlistId: null }, 0)
    expect(readPendingImport('u', 'b', exists, 31 * 60_000)).toEqual({ ok: false, reason: 'expired' })
    expect(readPendingImport('other', 'b', exists, 1)).toEqual({ ok: false, reason: 'none' })
    expect(readPendingImport('u', 'other-band', exists, 1)).toEqual({ ok: false, reason: 'none' })
    expect(readPendingImport('u', 'b', () => false, 1)).toEqual({ ok: false, reason: 'song-gone' })
    clearPendingImport('u', 'b')
    expect(readPendingImport('u', 'b', exists, 1)).toEqual({ ok: false, reason: 'none' })
  })
})
