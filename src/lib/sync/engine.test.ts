import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { SetlistDB } from '../db'
import { SyncEngine } from './engine'
import { FakeBackend } from './fakeServer'

const BAND = 'band-1'
let backend: FakeBackend
let n = 0

function device(user: string) {
  const db = new SetlistDB(`test-${user}-${++n}`)
  return new SyncEngine(db, backend.client(user), user, BAND)
}

beforeEach(() => {
  backend = new FakeBackend()
  backend.members = ['anna', 'bob'].map((u) => ({ band_id: BAND, user_id: u, display_name: u, instrument: '', role: 'member' as const }))
})

describe('sync engine', () => {
  it('propagates edits between members', async () => {
    const a = device('anna'), b = device('bob')
    const id = await a.mutate('songs', null, { title: 'Superstition', artist: 'Stevie Wonder', bpm: 100 })
    await a.syncNow()
    await b.syncNow()
    const song = await b.db.songs.get(id)
    expect(song?.title).toBe('Superstition')
    expect(song?.version).toBe(1)
  })

  it('keeps offline edits and sends them on reconnect', async () => {
    const a = device('anna')
    backend.offline = true
    const id = await a.mutate('songs', null, { title: 'Offline song' })
    await a.syncNow()
    expect((await a.db.outbox.count())).toBe(1)
    expect((await a.db.songs.get(id))?.title).toBe('Offline song')
    backend.offline = false
    await a.syncNow()
    expect(await a.db.outbox.count()).toBe(0)
    expect(backend.rows.get(id)?.row.title).toBe('Offline song')
  })

  it('records a conflict instead of overwriting a concurrent edit', async () => {
    const a = device('anna'), b = device('bob')
    const id = await a.mutate('songs', null, { title: 'Song', lyrics_chordpro: 'v1' })
    await a.syncNow(); await b.syncNow()
    backend.offline = true
    await a.mutate('songs', id, { lyrics_chordpro: 'anna lyrics' })
    await b.mutate('songs', id, { lyrics_chordpro: 'bob lyrics', key: 'E' })
    backend.offline = false
    await a.syncNow()
    await b.syncNow()
    expect(backend.rows.get(id)?.row.lyrics_chordpro).toBe('anna lyrics')
    expect(backend.rows.get(id)?.row.key).toBe('E')
    const conflicts = await b.db.conflicts.toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].client_value).toBe('bob lyrics')
    // Bob chooses his version → it is applied on top of Anna's
    await b.resolveConflict(conflicts[0].id!, 'mine')
    await b.syncNow()
    expect(backend.rows.get(id)?.row.lyrics_chordpro).toBe('bob lyrics')
    expect(await b.db.conflicts.count()).toBe(0)
  })

  it('does not conflict with its own consecutive edits', async () => {
    const a = device('anna')
    const id = await a.mutate('songs', null, { title: 'One' })
    await a.syncNow()
    await a.mutate('songs', id, { title: 'Two' })
    // simulate the second edit queued while the first is in flight
    const entry = (await a.db.outbox.toArray())[0]
    await a.db.outbox.update(entry.seq!, { in_flight: Date.now() })
    await a.mutate('songs', id, { title: 'Three' })
    await a.db.outbox.update(entry.seq!, { in_flight: undefined })
    await a.syncNow()
    expect(await a.db.conflicts.count()).toBe(0)
    expect(backend.rows.get(id)?.row.title).toBe('Three')
  })

  it('detects a remote edit between two of my queued edits', async () => {
    const a = device('anna'), b = device('bob')
    const id = await a.mutate('songs', null, { title: 'T', key: 'A' })
    await a.syncNow(); await b.syncNow()
    await b.mutate('songs', id, { key: 'B' }); await b.syncNow()
    // Anna (offline, stale) edits title, then key in a separate in-flight-split entry
    await a.mutate('songs', id, { title: 'T2' })
    const first = (await a.db.outbox.toArray())[0]
    await a.db.outbox.update(first.seq!, { in_flight: 1 })
    await a.mutate('songs', id, { key: 'C' })
    await a.db.outbox.update(first.seq!, { in_flight: undefined })
    await a.syncNow()
    expect(backend.rows.get(id)?.row.key).toBe('B')
    expect((await a.db.conflicts.toArray()).map((c) => c.field)).toEqual(['key'])
  })

  it('retries are idempotent when the response was lost', async () => {
    const a = device('anna')
    const id = await a.mutate('songs', null, { title: 'X' })
    backend.loseNextResponse = true
    await a.syncNow()
    expect(await a.db.outbox.count()).toBe(1)
    await a.syncNow()
    expect(await a.db.outbox.count()).toBe(0)
    expect(backend.rows.get(id)?.row.version).toBe(1)
    expect(backend.log.filter((l) => l.id === id)).toHaveLength(1)
  })

  it('survives a restart with an in-flight entry', async () => {
    const a = device('anna')
    const id = await a.mutate('songs', null, { title: 'Crash' })
    await a.db.outbox.toCollection().modify({ in_flight: Date.now() })
    // "restart": new engine on the same database
    const again = new SyncEngine(a.db, backend.client('anna'), 'anna', BAND)
    await again.recover()
    await again.syncNow()
    expect(backend.rows.get(id)?.row.title).toBe('Crash')
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('keeps the outbox when the session expires', async () => {
    const a = device('anna')
    await a.mutate('songs', null, { title: 'Later' })
    backend.expired.add('anna')
    await a.syncNow()
    expect(a.getStatus().authError).toBe(true)
    expect(await a.db.outbox.count()).toBe(1)
    backend.expired.delete('anna')
    await a.syncNow()
    expect(a.getStatus().authError).toBe(false)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('keeps rejected mutations until the user decides', async () => {
    const a = device('anna')
    backend.members = backend.members.filter((m) => m.user_id !== 'anna')
    await a.mutate('songs', null, { title: 'Nope' })
    await a.syncNow()
    const [e] = await a.db.outbox.toArray()
    expect(e.error).toBeTruthy()
    expect(a.getStatus().failed).toBe(1)
  })

  it('pulls in pages and resumes from the cursor', async () => {
    const a = device('anna'), b = device('bob')
    for (let i = 0; i < 520; i++) await a.mutate('songs', null, { title: `S${i}` })
    await a.syncNow()
    await b.syncNow()
    expect(await b.db.songs.count()).toBe(520)
    const id = await a.mutate('songs', null, { title: 'one more' })
    await a.syncNow(); await b.syncNow()
    expect((await b.db.songs.get(id))?.title).toBe('one more')
  })

  it('propagates deletes as tombstones', async () => {
    const a = device('anna'), b = device('bob')
    const id = await a.mutate('songs', null, { title: 'Bye' })
    await a.syncNow(); await b.syncNow()
    await a.remove('songs', id); await a.syncNow(); await b.syncNow()
    expect((await b.db.songs.get(id))?.deleted_at).toBeTruthy()
  })

  it('keeps private notes private', async () => {
    const a = device('anna'), b = device('bob')
    const song = await a.mutate('songs', null, { title: 'S' })
    await a.mutate('song_notes', null, { song_id: song, note: 'mine' })
    await a.syncNow(); await b.syncNow()
    expect(await b.db.song_notes.count()).toBe(0)
  })

  it('keeps local unsent edits when a remote change arrives', async () => {
    const a = device('anna'), b = device('bob')
    const id = await a.mutate('songs', null, { title: 'T', artist: 'X' })
    await a.syncNow(); await b.syncNow()
    await b.mutate('songs', id, { artist: 'Y' }); await b.syncNow()
    backend.offline = true
    await a.mutate('songs', id, { title: 'Local' })
    backend.offline = false
    await a.pull()
    const s = await a.db.songs.get(id)
    expect(s?.title).toBe('Local')
    expect(s?.artist).toBe('Y')
  })

  it('notifies when someone else reorders a setlist', async () => {
    const a = device('anna'), b = device('bob')
    const sl = await a.mutate('setlists', null, { name: 'Gig' })
    const item = await a.mutate('setlist_items', null, { setlist_id: sl, position: 'a0', type: 'song' })
    await a.syncNow(); await b.syncNow()
    const notices: string[] = []
    a.onNotice((x) => notices.push(x.message))
    await b.mutate('setlist_items', item, { position: 'a5' }); await b.syncNow()
    await a.syncNow()
    expect(notices).toHaveLength(1)
  })
})
