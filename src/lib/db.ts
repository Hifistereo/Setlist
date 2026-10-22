import Dexie, { type Table } from 'dexie'
import type { Blob_, Conflict, Member, OutboxEntry, Setlist, SetlistItem, Song, SongFile, SongNote, Band } from './types'

export interface Meta {
  key: string
  value: unknown
}

export class SetlistDB extends Dexie {
  songs!: Table<Song, string>
  song_notes!: Table<SongNote, string>
  song_files!: Table<SongFile, string>
  setlists!: Table<Setlist, string>
  setlist_items!: Table<SetlistItem, string>
  outbox!: Table<OutboxEntry, number>
  conflicts!: Table<Conflict, number>
  blobs!: Table<Blob_, string>
  members!: Table<Member, [string, string]>
  bands!: Table<Band, string>
  meta!: Table<Meta, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      songs: 'id, band_id, title, artist, deleted_at',
      song_notes: 'id, song_id, band_id',
      song_files: 'id, song_id, band_id',
      setlists: 'id, band_id, gig_date',
      setlist_items: 'id, setlist_id, song_id, band_id',
      outbox: '++seq, record_id, mutation_id',
      conflicts: '++id, record_id',
      blobs: 'key',
      members: '[band_id+user_id], band_id',
      bands: 'id',
      meta: 'key',
    })
    // v2: conflicts are scoped to a band (a user's database holds all of their bands)
    this.version(2).stores({ conflicts: '++id, record_id, band_id' }).upgrade(async (tx) => {
      // Keep existing conflicts: take the band from the record they belong to.
      for (const c of await tx.table('conflicts').toArray()) {
        const row = await tx.table(c.table).get(c.record_id)
        if (row) await tx.table('conflicts').update(c.id, { band_id: row.band_id })
      }
    })
  }

  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const row = await this.meta.get(key)
    return row ? (row.value as T) : fallback
  }

  async setMeta(key: string, value: unknown) {
    await this.meta.put({ key, value })
  }
}

export const DEMO_DB_NAME = 'setlist-demo'
export const cloudDbName = (userId: string) => `setlist-cloud-${userId}`
