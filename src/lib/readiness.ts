import { parseChordPro, songNotation } from './chordpro'
import { isChord } from './transpose'
import type { Song, SongFile } from './types'

/**
 * Chart readiness of a song for the band. This is about the chart itself (is there one, has
 * someone checked it), never about whether this device has it offline — that's Download for gig.
 */
export type ChartStatus = 'ready' | 'needs-review' | 'draft' | 'lyrics-only' | 'tab-only' | 'missing'

export interface Readiness {
  status: ChartStatus
  /** Chords that pass isChord(): section labels like [Verse] don't count. */
  chords: number
  tab: boolean
}

const TAB_KINDS = new Set(['gp', 'musicxml', 'tex'])
const NO_CHORD = /^N\.?C\.?$/i

/** Real chord tokens in a chart, in order of appearance (with repeats). */
export function chartChords(src: string): string[] {
  const out: string[] = []
  for (const line of parseChordPro(src).lines) {
    if (line.kind !== 'lyrics') continue
    for (const seg of line.segments) {
      const c = seg.chord?.trim()
      if (c && !NO_CHORD.test(c) && isChord(c)) out.push(c)
    }
  }
  return out
}

/**
 * Fingerprint of what a member signs off: the chart text and how its chords are named.
 * Whitespace at line ends and blank-line runs don't change it; any other edit does.
 */
export function chartFingerprint(song: Pick<Song, 'lyrics_chordpro' | 'chord_notation'>): string {
  const text = song.lyrics_chordpro.normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
  return `${songNotation(song)}:${cyrb53(text)}`
}

export function hasTab(files: Pick<SongFile, 'kind' | 'deleted_at'>[]): boolean {
  return files.some((f) => !f.deleted_at && TAB_KINDS.has(f.kind))
}

export function readiness(song: Song, files: Pick<SongFile, 'kind' | 'deleted_at'>[] = []): Readiness {
  const chords = chartChords(song.lyrics_chordpro).length
  const tab = hasTab(files)
  let status: ChartStatus
  if (chords > 0) {
    if (!song.chart_verified_hash) status = 'draft'
    else status = song.chart_verified_hash === chartFingerprint(song) ? 'ready' : 'needs-review'
  } else if (tab) status = 'tab-only'
  else if (song.lyrics_chordpro.trim()) status = 'lyrics-only'
  else status = 'missing'
  return { status, chords, tab }
}

export const STATUS_LABEL: Record<ChartStatus, string> = {
  ready: 'Ready',
  'needs-review': 'Needs review',
  draft: 'Draft',
  'lyrics-only': 'Lyrics only',
  'tab-only': 'TAB only',
  missing: 'Find chords',
}

/** A song still needs chart work before the gig. */
export const needsWork = (s: ChartStatus) => s !== 'ready'

/** Small fast string hash (53-bit). Change detection only, not security. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}
