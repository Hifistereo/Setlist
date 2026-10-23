const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
// Keys conventionally written with flats
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'])

/**
 * Chord naming. 'standard': B = B natural, Bb = B flat.
 * 'h' (Latvian/German/Central European): H = B natural, B = B flat.
 */
export type Notation = 'standard' | 'h'

const NOTE_RE = /^([A-H])([#b]?)/

export function noteIndex(note: string, notation: Notation = 'standard'): number {
  const m = NOTE_RE.exec(note)
  if (!m) return -1
  if (m[1] === 'H') return (11 + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
  // In H notation a plain B (or a redundant "Bb") is B flat.
  if (m[1] === 'B' && notation === 'h' && m[2] !== '#') return 10
  const base = SHARPS.indexOf(m[1])
  return (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
}

function spell(index: number, preferFlats: boolean, notation: Notation = 'standard') {
  const i = ((index % 12) + 12) % 12
  if (notation === 'h' && i === 11) return 'H'
  if (notation === 'h' && i === 10) return 'B'
  return (preferFlats ? FLATS : SHARPS)[i]
}

/** Chord symbol: root, quality/extensions, optional slash bass. */
export const CHORD_RE = /^([A-H][#b]?)((?:maj|min|m|M|dim|aug|sus|add|º|°|ø|\+|-|\d|\(|\)|b|#|\/(?![A-H]))*)(?:\/([A-H][#b]?))?$/

export function isChord(token: string): boolean {
  const t = token.trim()
  if (!t || t === 'N.C.' || t === 'NC') return t.length > 0
  return CHORD_RE.test(t)
}

/** A chart that uses H chords is written in H notation. */
export function detectNotation(chords: string[]): Notation {
  return chords.some((c) => /^H/.test(c.trim()) || /\/H/.test(c)) ? 'h' : 'standard'
}

export function transposeChord(chord: string, semitones: number, preferFlats = false, notation: Notation = 'standard'): string {
  const m = CHORD_RE.exec(chord.trim())
  if (!m || semitones % 12 === 0) return chord
  const root = spell(noteIndex(m[1], notation) + semitones, preferFlats, notation)
  const bass = m[3] ? '/' + spell(noteIndex(m[3], notation) + semitones, preferFlats, notation) : ''
  return root + (m[2] ?? '') + bass
}

/** Rewrite a chord's B/H letters from one notation to the other (pitch unchanged). */
export function convertChordNotation(chord: string, from: Notation, to: Notation): string {
  if (from === to) return chord
  const m = CHORD_RE.exec(chord.trim())
  if (!m) return chord
  const note = (n: string) => {
    if (to === 'h') return n === 'B' ? 'H' : n === 'Bb' ? 'B' : n // standard → H notation
    return n === 'H' ? 'B' : n === 'B' ? 'Bb' : n // H notation → standard
  }
  return note(m[1]) + (m[2] ?? '') + (m[3] ? '/' + note(m[3]) : '')
}

export function transposeKey(key: string, semitones: number, notation: Notation = 'standard'): string {
  if (!key) return key
  const minor = /m$/.test(key) && !/maj$/.test(key)
  const idx = noteIndex(key, notation)
  if (idx < 0) return key
  const target = spell(idx + semitones, false) + (minor ? 'm' : '')
  const flat = spell(idx + semitones, true) + (minor ? 'm' : '')
  const name = FLAT_KEYS.has(flat) ? flat : target
  return notation === 'h' ? toNotation(name, 'h') : name
}

/** Rewrite a standard-notation note/key/chord name for display in the given notation. */
export function toNotation(name: string, notation: Notation): string {
  if (notation !== 'h') return name
  return name.replace(/^Bb/, '\u0000').replace(/^B(?![b#])/, 'H').replace('\u0000', 'B')
}

export function prefersFlats(key: string, notation: Notation = 'standard'): boolean {
  if (notation === 'h' && /^B(?![#])/.test(key)) return true
  return FLAT_KEYS.has(key) || /b/.test(key.slice(1, 2))
}

/** Semitones needed to go from one key to another (−5…+6). */
export function semitonesBetween(from: string, to: string, notation: Notation = 'standard'): number {
  const a = noteIndex(from, notation), b = noteIndex(to, notation)
  if (a < 0 || b < 0) return 0
  let d = (b - a + 12) % 12
  if (d > 6) d -= 12
  return d
}

export const ALL_KEYS = [
  'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
]

export const ALL_KEYS_H = ALL_KEYS.map((k) => toNotation(k, 'h')).filter((k, i, a) => a.indexOf(k) === i)
