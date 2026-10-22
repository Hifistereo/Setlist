export type TableName = 'songs' | 'song_notes' | 'song_files' | 'setlists' | 'setlist_items'

export const TABLES: TableName[] = ['songs', 'song_notes', 'song_files', 'setlists', 'setlist_items']

/** Server-owned bookkeeping present on every synced row. */
export interface SyncMeta {
  id: string
  band_id: string
  version: number
  field_versions: Record<string, number>
  created_by?: string | null
  updated_by?: string | null
  updated_at?: string
  deleted_at: string | null
}

export interface SongLink {
  label: string
  url: string
}

export interface Song extends SyncMeta {
  title: string
  artist: string
  key: string
  bpm: number | null
  time_sig: string
  duration_sec: number | null
  lyrics_chordpro: string
  arrangement: string
  tags: string[]
  links: SongLink[]
}

export interface SongNote extends SyncMeta {
  song_id: string
  user_id?: string
  note: string
}

export type FileKind = 'gp' | 'musicxml' | 'tex' | 'pdf' | 'audio' | 'other'

export interface SongFile extends SyncMeta {
  song_id: string
  kind: FileKind
  name: string
  part: string
  storage_path: string | null
  tex: string
  size_bytes: number | null
}

export interface Setlist extends SyncMeta {
  name: string
  gig_date: string | null
  start_time: string
  venue: string
  notes: string
}

export type ItemType = 'song' | 'break' | 'section'

export interface SetlistItem extends SyncMeta {
  setlist_id: string
  position: string
  type: ItemType
  song_id: string | null
  label: string
  duration_sec: number | null
  key_override: string
}

export interface RowByTable {
  songs: Song
  song_notes: SongNote
  song_files: SongFile
  setlists: Setlist
  setlist_items: SetlistItem
}

export type Fields<T extends TableName> = Partial<Omit<RowByTable[T], keyof SyncMeta>> & { deleted_at?: string | null }

export interface OutboxEntry {
  seq?: number
  mutation_id: string
  table: TableName
  band_id: string
  record_id: string
  fields: Record<string, unknown>
  /** field → field version the client last saw */
  base: Record<string, number>
  created_at: number
  attempts: number
  /** set when the server permanently rejected it; kept until the user decides */
  error?: string
  in_flight?: number
}

export interface Conflict {
  id?: number
  table: TableName
  record_id: string
  field: string
  server_value: unknown
  client_value: unknown
  at: number
}

export interface Blob_ {
  /** storage path, or `local:<file_id>` before upload */
  key: string
  blob: Blob
  pending_upload?: boolean
}

export interface Member {
  band_id: string
  user_id: string
  display_name: string
  instrument: string
  role: 'admin' | 'member'
}

export interface Band {
  id: string
  name: string
}

export interface MutationResult {
  status: 'applied' | 'partial' | 'conflict' | 'noop'
  version: number
  applied: string[]
  conflicts: { field: string; server_value: unknown; client_value: unknown }[]
  row: Record<string, unknown>
}

export interface ChangeRow {
  seq: number
  table_name: TableName
  data: Record<string, unknown>
}

export function emptyRow<T extends TableName>(table: T, id: string, band_id: string): RowByTable[T] {
  const meta: SyncMeta = { id, band_id, version: 0, field_versions: {}, deleted_at: null }
  const defaults: { [K in TableName]: Omit<RowByTable[K], keyof SyncMeta> } = {
    songs: { title: '', artist: '', key: '', bpm: null, time_sig: '4/4', duration_sec: null, lyrics_chordpro: '', arrangement: '', tags: [], links: [] },
    song_notes: { song_id: '', note: '' },
    song_files: { song_id: '', kind: 'gp', name: '', part: '', storage_path: null, tex: '', size_bytes: null },
    setlists: { name: '', gig_date: null, start_time: '', venue: '', notes: '' },
    setlist_items: { setlist_id: '', position: 'a0', type: 'song', song_id: null, label: '', duration_sec: null, key_override: '' },
  }
  return { ...meta, ...defaults[table] } as RowByTable[T]
}
