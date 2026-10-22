const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
// Keys conventionally written with flats
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'])

const NOTE_RE = /^([A-G])([#b]?)/

export function noteIndex(note: string): number {
  const m = NOTE_RE.exec(note)
  if (!m) return -1
  const base = SHARPS.indexOf(m[1])
  return (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
}

function spell(index: number, preferFlats: boolean) {
  return (preferFlats ? FLATS : SHARPS)[((index % 12) + 12) % 12]
}

/** Chord symbol: root, quality/extensions, optional slash bass. */
export const CHORD_RE = /^([A-G][#b]?)((?:maj|min|m|M|dim|aug|sus|add|º|°|ø|\+|-|\d|\(|\)|b|#|\/(?![A-G]))*)(?:\/([A-G][#b]?))?$/

export function isChord(token: string): boolean {
  const t = token.trim()
  if (!t || t === 'N.C.' || t === 'NC') return t.length > 0
  return CHORD_RE.test(t)
}

export function transposeChord(chord: string, semitones: number, preferFlats = false): string {
  const m = CHORD_RE.exec(chord.trim())
  if (!m || semitones % 12 === 0) return chord
  const root = spell(noteIndex(m[1]) + semitones, preferFlats)
  const bass = m[3] ? '/' + spell(noteIndex(m[3]) + semitones, preferFlats) : ''
  return root + (m[2] ?? '') + bass
}

export function transposeKey(key: string, semitones: number): string {
  if (!key) return key
  const minor = /m$/.test(key) && !/maj$/.test(key)
  const idx = noteIndex(key)
  if (idx < 0) return key
  const target = spell(idx + semitones, false) + (minor ? 'm' : '')
  const flat = spell(idx + semitones, true) + (minor ? 'm' : '')
  return FLAT_KEYS.has(flat) ? flat : target
}

export function prefersFlats(key: string): boolean {
  return FLAT_KEYS.has(key) || /b/.test(key.slice(1, 2))
}

/** Semitones needed to go from one key to another (−5…+6). */
export function semitonesBetween(from: string, to: string): number {
  const a = noteIndex(from), b = noteIndex(to)
  if (a < 0 || b < 0) return 0
  let d = (b - a + 12) % 12
  if (d > 6) d -= 12
  return d
}

export const ALL_KEYS = [
  'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
]
