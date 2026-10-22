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
