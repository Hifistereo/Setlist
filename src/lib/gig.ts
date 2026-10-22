import { BASE } from './config'
import type { SyncEngine } from './sync/engine'
import { sortOrdered } from './ordering'

export const ALPHATAB_ASSETS = [`${BASE}font/Bravura.woff2`, `${BASE}soundfont/sonivox.sf2`]

export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

async function isCached(url: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    return !!(await caches.match(url, { ignoreSearch: true }))
  } catch {
    return false
  }
}

export interface GigCheck {
  ready: boolean
  songs: number
  files: number
  missing: string[]
  warnings: string[]
  checkedAt: number
}

const gigKey = (setlistId: string) => `gig:${setlistId}`

/** Fetch everything a setlist needs onto this device: songs (already synced), tab files, playback assets. */
export async function downloadForGig(engine: SyncEngine, setlistId: string, onProgress?: (msg: string) => void): Promise<GigCheck> {
  const { db, server } = engine
  if (server) {
    onProgress?.('Syncing latest changes…')
    await engine.syncNow()
  }
  const files = await gigFiles(engine, setlistId)
  let i = 0
  for (const f of files) {
    i++
    if (!f.storage_path || f.tex) continue
    if (await db.blobs.get(f.storage_path)) continue
    if (!server) continue
    onProgress?.(`Downloading ${f.name} (${i}/${files.length})…`)
    try {
      const blob = await server.downloadBlob(f.storage_path)
      await db.blobs.put({ key: f.storage_path, blob })
    } catch { /* reported by the check below */ }
  }
  onProgress?.('Caching playback engine…')
  for (const url of ALPHATAB_ASSETS) {
    try {
      // Goes through the service worker; the precache already holds these in production builds.
      await fetch(url)
    } catch { /* offline */ }
  }
  await requestPersistence()
  const check = await verifyGig(engine, setlistId)
  await db.setMeta(gigKey(setlistId), check)
  return check
}

async function gigFiles(engine: SyncEngine, setlistId: string) {
  const items = await engine.db.setlist_items.where('setlist_id').equals(setlistId).filter((i) => !i.deleted_at).toArray()
  const songIds = items.filter((i) => i.type === 'song' && i.song_id).map((i) => i.song_id!)
  return (await engine.db.song_files.where('song_id').anyOf(songIds).toArray()).filter((f) => !f.deleted_at)
}

export async function verifyGig(engine: SyncEngine, setlistId: string): Promise<GigCheck> {
  const { db } = engine
  const missing: string[] = []
  const warnings: string[] = []
  const setlist = await db.setlists.get(setlistId)
  if (!setlist) missing.push('Setlist itself is not on this device')
  const items = sortOrdered(await db.setlist_items.where('setlist_id').equals(setlistId).filter((i) => !i.deleted_at).toArray())
  let songs = 0
  for (const it of items) {
    if (it.type !== 'song') continue
    songs++
    const song = it.song_id ? await db.songs.get(it.song_id) : undefined
    if (!song || song.deleted_at) missing.push(`Song ${it.label || it.song_id || '(empty slot)'} is missing`)
    else if (!song.lyrics_chordpro.trim()) warnings.push(`“${song.title}” has no lyrics/chords`)
  }
  const files = await gigFiles(engine, setlistId)
  for (const f of files) {
    if (f.tex) continue
    if (!f.storage_path || !(await db.blobs.get(f.storage_path))) missing.push(`File “${f.name}” is not downloaded`)
  }
  if (files.some((f) => f.kind === 'gp' || f.kind === 'musicxml' || f.kind === 'tex')) {
    for (const url of ALPHATAB_ASSETS) {
      if (!(await isCached(url))) {
        const msg = `Playback asset ${url.split('/').pop()} is not cached`
        // In dev there is no service worker; installed builds precache these.
        if (import.meta.env.PROD) missing.push(msg)
        else warnings.push(msg + ' (dev build)')
      }
    }
  }
  if (engine.getStatus().pending > 0) warnings.push(`${engine.getStatus().pending} local change(s) not synced yet`)
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      warnings.push('Browser has not granted persistent storage — keep a backup export')
    }
  } catch { /* ignore */ }
  return { ready: missing.length === 0, songs, files: files.length, missing, warnings, checkedAt: Date.now() }
}

export async function lastGigCheck(engine: SyncEngine, setlistId: string) {
  return engine.db.getMeta<GigCheck | null>(gigKey(setlistId), null)
}
