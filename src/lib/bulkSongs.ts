import { generateNKeysBetween } from 'fractional-indexing'
import { derivedId } from './ids'
import type { SyncEngine } from './sync/engine'
import type { Song } from './types'

/** Pasting a whole setlist: one song per line, matched against the band library before anything is saved. */

export type LineOrder = 'title-artist' | 'artist-title'

export type PastedLine =
  | { kind: 'song'; index: number; raw: string; title: string; artist: string }
  | { kind: 'section'; index: number; raw: string; label: string }

const NUMBERING = /^\s*(?:\d{1,3}\s*[.):]\s*|[-*•·]\s+)/
// Only explicit dividers: "Set 2", "Set II:", "2. komplekts", "Encore", "---". Not "Set Fire to the Rain".
const SECTION = /^(?:(?:set|komplekts)\s*(?:\d{1,2}|[ivx]{1,4})|\d{1,2}\.?\s*(?:set|komplekts)|encore|piedeva|bis|-{3,}|={3,}|_{3,})\s*[:.]?$/i
const BY = /^(.+?)\s+by\s+(.+)$/i
const SEP = /\s+[–—-]\s+|\s*\t\s*|\s+\|\s+/

export function parseSongLines(text: string, order: LineOrder): PastedLine[] {
  const out: PastedLine[] = []
  text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n').forEach((rawLine, index) => {
    const raw = rawLine.trim()
    if (!raw) return
    const line = raw.replace(NUMBERING, '').trim()
    if (!line) return
    const section = SECTION.test(raw) ? raw : SECTION.test(line) ? line : null
    if (section) {
      out.push({ kind: 'section', index, raw, label: /^[-=_]+$/.test(section) ? '' : section.replace(/[:.\s]+$/, '') })
      return
    }
    const by = BY.exec(line)
    if (by) return void out.push({ kind: 'song', index, raw, title: by[1].trim(), artist: by[2].trim() })
    const m = SEP.exec(line)
    if (!m) return void out.push({ kind: 'song', index, raw, title: line, artist: '' })
    const a = line.slice(0, m.index).trim(), b = line.slice(m.index + m[0].length).trim()
    out.push(order === 'title-artist' ? { kind: 'song', index, raw, title: a, artist: b } : { kind: 'song', index, raw, title: b, artist: a })
  })
  return out
}

/** Comparison key: case, punctuation, "&"/"and" and a leading "The" don't matter. Accents do. */
export function normKey(s: string): string {
  return s.normalize('NFC').toLowerCase()
    .replace(/[’'`´"“”]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the\s+/, '')
}

/** Looser key for *suggestions* only: also ignores accents (ā = a, ö = o). */
export function looseKey(s: string): string {
  return normKey(s).normalize('NFD').replace(/\p{M}/gu, '')
}

export interface Match {
  /** exact: safe to use without asking · suggested: user must confirm · new: create a song */
  status: 'exact' | 'suggested' | 'new'
  song?: Song
  candidates: Song[]
}

export function matchSong(line: { title: string; artist: string }, songs: Song[]): Match {
  const live = songs.filter((s) => !s.deleted_at)
  if (!normKey(line.title)) return { status: 'new', candidates: [] }
  const find = (key: (s: string) => string) => {
    const t = key(line.title), a = key(line.artist)
    const byTitle = live.filter((s) => key(s.title) === t)
    return {
      byTitle,
      pair: a ? byTitle.filter((s) => key(s.artist) === a) : [],
      swapped: a ? live.filter((s) => key(s.title) === a && key(s.artist) === t) : [],
      // A library song without an artist is the same song as a line that names one.
      noArtist: byTitle.filter((s) => !s.artist.trim()),
      hasArtist: !!a,
    }
  }
  const strict = find(normKey)
  const one = (xs: Song[]): Match | null => (xs.length === 1 ? { status: 'exact', song: xs[0], candidates: xs } : null)
  const exact = strict.hasArtist
    ? one(unique([...strict.pair, ...strict.swapped])) ?? (strict.pair.length + strict.swapped.length === 0 && strict.byTitle.length === 1 ? one(strict.noArtist) : null)
    : one(strict.byTitle)
  if (exact) return exact
  // Anything else needs the user's confirmation: duplicates, accent-only differences, artist-less titles.
  const loose = find(looseKey)
  const suggested = unique(loose.hasArtist ? [...loose.pair, ...loose.swapped, ...loose.noArtist] : loose.byTitle)
  if (suggested.length) return { status: 'suggested', candidates: unique([...suggested, ...loose.byTitle]) }
  // Same title, explicitly different artist: never matched silently — a new song, with the others offered.
  return { status: 'new', candidates: loose.byTitle }
}

const unique = (xs: Song[]) => [...new Map(xs.map((s) => [s.id, s])).values()]

/** A preview row after the user has resolved it. */
export type ResolvedRow =
  | { kind: 'song'; songId: string | null; title: string; artist: string }
  | { kind: 'section'; label: string }

export interface BulkPlan {
  importId: string
  setlistId: string
  songs: { id: string; title: string; artist: string }[]
  items: { id: string; type: 'song' | 'section'; song_id: string | null; label: string; position: string }[]
}

/**
 * Turns resolved rows into fixed ids and positions. Ids derive from the import id, so running the
 * same plan twice (a retry after a partial failure) writes the same rows instead of new ones, and a
 * song listed twice becomes one song with two setlist entries.
 */
export async function planBulkImport(opts: {
  importId: string
  setlistId: string
  rows: ResolvedRow[]
  lastPosition: string | null
  /** set number currently being filled, and whether it already has songs (for "Set N" labels) */
  currentSet: number
  currentSetHasSongs: boolean
}): Promise<BulkPlan> {
  const { importId, setlistId, rows } = opts
  const songs = new Map<string, BulkPlan['songs'][number]>()
  const keys = rows.length ? generateNKeysBetween(opts.lastPosition, null, rows.length) : []
  let set = Math.max(1, opts.currentSet)
  let hasSongs = opts.currentSetHasSongs
  const items: BulkPlan['items'] = []
  for (const [i, row] of rows.entries()) {
    const id = await derivedId('bulk-item', importId, String(i))
    if (row.kind === 'section') {
      // A divider before any song (e.g. a leading "Set 1") names the current set instead of starting another.
      if (hasSongs) set++
      hasSongs = false
      items.push({ id, type: 'section', song_id: null, label: row.label || `Set ${set}`, position: keys[i] })
      continue
    }
    hasSongs = true
    let songId = row.songId
    if (!songId) {
      songId = await derivedId('bulk-song', importId, normKey(row.title), normKey(row.artist))
      if (!songs.has(songId)) songs.set(songId, { id: songId, title: row.title.trim(), artist: row.artist.trim() })
    }
    items.push({ id, type: 'song', song_id: songId, label: '', position: keys[i] })
  }
  return { importId, setlistId, songs: [...songs.values()], items }
}

/**
 * Applies a plan. Rows that already exist on this device are skipped, so it can be resumed safely
 * and never overwrites edits made since. Songs first, so no item points at a missing song.
 */
export async function runBulkPlan(engine: SyncEngine, plan: BulkPlan, onProgress?: (done: number, total: number) => void) {
  const total = plan.songs.length + plan.items.length
  let done = 0
  for (const s of plan.songs) {
    if (!(await engine.db.songs.get(s.id))) await engine.mutate('songs', s.id, { title: s.title, artist: s.artist })
    onProgress?.(++done, total)
  }
  for (const it of plan.items) {
    if (!(await engine.db.setlist_items.get(it.id))) {
      await engine.mutate('setlist_items', it.id, { setlist_id: plan.setlistId, type: it.type, song_id: it.song_id, label: it.label, position: it.position })
    }
    onProgress?.(++done, total)
  }
}

const planKey = (bandId: string, setlistId: string) => `setlist.bulk:${bandId}:${setlistId}`

/** An unfinished plan survives a reload or crash so it can be resumed or discarded. */
export const pendingPlan = {
  get(bandId: string, setlistId: string): BulkPlan | null {
    try {
      const p = JSON.parse(localStorage.getItem(planKey(bandId, setlistId)) ?? 'null') as BulkPlan | null
      return p && p.setlistId === setlistId && Array.isArray(p.items) ? p : null
    } catch { return null }
  },
  set(bandId: string, plan: BulkPlan) {
    try { localStorage.setItem(planKey(bandId, plan.setlistId), JSON.stringify(plan)) } catch { /* storage unavailable: plan just isn't resumable */ }
  },
  clear(bandId: string, setlistId: string) {
    try { localStorage.removeItem(planKey(bandId, setlistId)) } catch { /* ignore */ }
  },
}
