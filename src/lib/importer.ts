import { chordsOverLyricsToChordPro, isChordLine, looksLikeChordPro } from './chordsOverLyrics'
import { chordsUsed } from './chordpro'
import { detectNotation, isChord, type Notation } from './transpose'

/** Pasted text or a .txt file → ChordPro (already-ChordPro text is kept as is). */
export function toChordPro(text: string): string {
  return looksLikeChordPro(text) ? text.normalize('NFC') : chordsOverLyricsToChordPro(text)
}

/**
 * Bytes of a Notepad file → text. Handles UTF-16 ("Unicode"), UTF-8 with or without BOM,
 * and falls back to Windows-1257 — what Notepad saves as "ANSI" on Latvian Windows.
 */
export function decodeText(input: ArrayBuffer | Uint8Array): string {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  let text: string
  if (b[0] === 0xff && b[1] === 0xfe) text = new TextDecoder('utf-16le').decode(b.subarray(2))
  else if (b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder('utf-16be').decode(b.subarray(2))
  else if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = new TextDecoder('utf-8').decode(b.subarray(3))
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(b)
    } catch {
      text = new TextDecoder('windows-1257').decode(b)
    }
  }
  if (text.includes('\u0000')) throw new Error('Not a text file')
  return text.normalize('NFC').replace(/\r\n?/g, '\n')
}

export interface Header {
  title: string
  artist: string
  key: string
  bpm: number | null
  /** The text with the recognised header lines removed. Everything else is untouched. */
  body: string
}

const HEADER_RE = /^\s*(title|nosaukums|dziesma|artist|izpildītājs|grupa|key|tonalitāte|toņkārta|bpm|temps|tempo)\s*[:=]\s*(.*?)\s*$/i

/**
 * Optional "Key: Am" / "BPM: 120" (also Latvian: Tonalitāte, Temps, Nosaukums, Izpildītājs) lines
 * at the very top of the text. Parsing stops at the first line that isn't a valid header,
 * so song lines are never taken as metadata.
 */
export function parseHeader(text: string): Header {
  const lines = text.split('\n')
  const h: Header = { title: '', artist: '', key: '', bpm: null, body: text }
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  const start = i
  for (; i < lines.length; i++) {
    const m = HEADER_RE.exec(lines[i])
    if (!m || !m[2]) break
    const field = m[1].toLowerCase()
    const value = m[2]
    if (/^(title|nosaukums|dziesma)$/.test(field)) h.title = value
    else if (/^(artist|izpildītājs|grupa)$/.test(field)) h.artist = value
    else if (/^(key|tonalitāte|toņkārta)$/.test(field)) {
      if (!isChord(value)) break
      h.key = value
    } else {
      const bpm = /^\d{2,3}$/.test(value) ? parseInt(value) : NaN
      if (!(bpm >= 30 && bpm <= 300)) break
      h.bpm = bpm
    }
  }
  if (i > start) h.body = lines.slice(i).join('\n')
  return h
}

/** "Prāta Vētra - Tu jau esi.txt" → artist + title. Without " - " the whole name is the title. */
export function guessFromFile(name: string): { title: string; artist: string } {
  const base = name.normalize('NFC').replace(/\.(txt|text|chopro|cho|crd|pro)$/i, '').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim()
  const parts = base.split(/\s[-–—]\s/)
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
  return { title: base, artist: '' }
}

/** A first line like "Artist – Song" becomes artist/title and is removed from the text. */
export function guessFromText(text: string): { title: string; artist: string; text: string } {
  const lines = text.split('\n')
  const first = lines.findIndex((l) => l.trim())
  if (first >= 0) {
    const line = lines[first].trim()
    const parts = line.split(/\s[-–—]\s/)
    if (line.length <= 80 && parts.length >= 2 && !isChordLine(line) && !/[[{]/.test(line)) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), text: lines.slice(first + 1).join('\n') }
    }
  }
  return { title: '', artist: '', text }
}

export interface PreparedSong {
  title: string
  artist: string
  key: string
  bpm: number | null
  /** Text as written, without header lines — what the user sees in the paste box. */
  body: string
  chordpro: string
  notation: Notation
}

/** One pipeline for pasted text, a single .txt file and bulk .txt imports. */
export function prepareSong(input: { name?: string; text: string }): PreparedSong {
  const h = parseHeader(input.text.normalize('NFC').replace(/\r\n?/g, '\n'))
  let { title, artist, body } = h
  if (!title) {
    const g = input.name ? { ...guessFromFile(input.name), text: body } : guessFromText(body)
    title = g.title
    artist ||= g.artist
    body = g.text
  }
  body = body.replace(/^\n+|\s+$/g, '')
  const chordpro = toChordPro(body)
  return { title, artist, key: h.key, bpm: h.bpm, body, chordpro, notation: detectNotation(chordsUsed(chordpro)) }
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

/** Same title, and same artist — or one of them has no artist. */
export function isSameSong(a: { title: string; artist: string }, b: { title: string; artist: string }): boolean {
  if (!norm(a.title) || norm(a.title) !== norm(b.title)) return false
  return !norm(a.artist) || !norm(b.artist) || norm(a.artist) === norm(b.artist)
}

/** Read the system clipboard (needs a tap; iOS shows a "Paste" confirmation). */
export async function readClipboard(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

/** Read a picked .txt file through the shared pipeline. */
export async function readSongFile(file: File): Promise<PreparedSong> {
  const p = prepareSong({ name: file.name, text: decodeText(await file.arrayBuffer()) })
  if (!p.body.trim()) throw new Error('File is empty')
  return p
}
