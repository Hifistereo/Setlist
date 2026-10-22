import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SyncEngine } from './sync/engine'
import type { Fields, SyncMeta, TableName } from './types'

const SHARED: TableName[] = ['songs', 'song_files', 'setlists', 'setlist_items']
const META_KEYS: (keyof SyncMeta)[] = ['id', 'band_id', 'version', 'field_versions', 'created_by', 'updated_by', 'updated_at']

interface Manifest {
  format: 'setlist-backup'
  version: 1
  band_id: string
  band_name: string
  exported_by: string
  exported_at: string
  tables: Record<string, Record<string, unknown>[]>
  /** only the exporter's own private notes */
  notes: Record<string, unknown>[]
  files: { path: string; zip: string }[]
}

/** Zip of the band's shared repertoire + attachments available on this device + your own private notes. */
export async function exportBackup(engine: SyncEngine, bandName: string): Promise<Blob> {
  const { db } = engine
  const tables: Manifest['tables'] = {}
  for (const t of SHARED) tables[t] = await db.table(t).where('band_id').equals(engine.bandId).toArray()
  const songFiles = tables.song_files as { storage_path: string | null }[]
  const zipFiles: Record<string, Uint8Array> = {}
  const files: Manifest['files'] = []
  for (const f of songFiles) {
    if (!f.storage_path) continue
    let b = (await db.blobs.get(f.storage_path))?.blob
    if (!b && engine.server) {
      try { b = await engine.server.downloadBlob(f.storage_path) } catch { /* skip, listed as missing */ }
    }
    if (!b) continue
    const zipName = `files/${files.length}-${f.storage_path.split('/').pop()}`
    zipFiles[zipName] = new Uint8Array(await b.arrayBuffer())
    files.push({ path: f.storage_path, zip: zipName })
  }
  const notes = (await db.song_notes.toArray()).filter((n) => !n.user_id || n.user_id === engine.userId) as unknown as Record<string, unknown>[]
  const manifest: Manifest = {
    format: 'setlist-backup', version: 1, band_id: engine.bandId, band_name: bandName,
    exported_by: engine.userId, exported_at: new Date().toISOString(), tables, notes, files,
  }
  zipFiles['setlist-backup.json'] = strToU8(JSON.stringify(manifest, null, 1))
  return new Blob([zipSync(zipFiles, { level: 6 }) as BlobPart], { type: 'application/zip' })
}

export interface RestoreReport {
  rows: number
  files: number
  notes: number
  skippedNotes: number
}

function stripMeta(row: Record<string, unknown>) {
  const out = { ...row }
  for (const k of META_KEYS) delete out[k]
  delete out.user_id
  return out
}

/** Re-applies a backup through the normal mutation path (idempotent ids, conflict detection). */
export async function restoreBackup(engine: SyncEngine, zip: ArrayBuffer): Promise<RestoreReport> {
  const files = unzipSync(new Uint8Array(zip))
  const raw = files['setlist-backup.json']
  if (!raw) throw new Error('Not a Setlist backup (setlist-backup.json missing)')
  const m = JSON.parse(strFromU8(raw)) as Manifest
  if (m.format !== 'setlist-backup') throw new Error('Unknown backup format')
  const report: RestoreReport = { rows: 0, files: 0, notes: 0, skippedNotes: 0 }
  for (const f of m.files) {
    const data = files[f.zip]
    if (!data) continue
    // Keep the path's file id but move it under this band's folder.
    const path = [engine.bandId, ...f.path.split('/').slice(1)].join('/')
    await engine.putBlob(path, new Blob([data as BlobPart]))
    report.files++
  }
  for (const t of SHARED) {
    for (const row of m.tables[t] ?? []) {
      const fields = stripMeta(row)
      if (t === 'song_files' && typeof fields.storage_path === 'string') {
        fields.storage_path = [engine.bandId, ...fields.storage_path.split('/').slice(1)].join('/')
      }
      await engine.mutate(t, row.id as string, fields as Fields<typeof t>)
      report.rows++
    }
  }
  for (const n of m.notes) {
    if (m.exported_by !== engine.userId) { report.skippedNotes++; continue }
    await engine.mutate('song_notes', n.id as string, stripMeta(n) as Fields<'song_notes'>)
    report.notes++
  }
  return report
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
