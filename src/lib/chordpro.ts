import { transposeChord } from './transpose'

export interface Segment {
  chord: string | null
  lyric: string
}

export type Line =
  | { kind: 'lyrics'; segments: Segment[] }
  | { kind: 'comment'; text: string }
  | { kind: 'section'; name: string; type: 'chorus' | 'verse' | 'bridge' | 'tab' | 'other'; start: boolean }
  | { kind: 'tab'; text: string }
  | { kind: 'empty' }

export interface ParsedSong {
  meta: Record<string, string>
  lines: Line[]
}

const DIRECTIVE = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i
const ALIASES: Record<string, string> = {
  t: 'title', st: 'subtitle', c: 'comment', ci: 'comment', cb: 'comment',
  soc: 'start_of_chorus', eoc: 'end_of_chorus', sov: 'start_of_verse', eov: 'end_of_verse',
  sob: 'start_of_bridge', eob: 'end_of_bridge', sot: 'start_of_tab', eot: 'end_of_tab',
}
const META = new Set(['title', 'subtitle', 'artist', 'key', 'tempo', 'time', 'capo', 'duration', 'album', 'year'])

export function parseChordPro(src: string): ParsedSong {
  const meta: Record<string, string> = {}
  const lines: Line[] = []
  let inTab = false
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const d = DIRECTIVE.exec(line.trim())
    if (d) {
      const name = ALIASES[d[1].toLowerCase()] ?? d[1].toLowerCase()
      const value = d[2] ?? ''
      if (META.has(name)) { meta[name] = value; continue }
      if (name === 'comment' || name === 'comment_italic' || name === 'comment_box' || name === 'highlight') {
        lines.push({ kind: 'comment', text: value }); continue
      }
      const sec = /^(start|end)_of_(\w+)$/.exec(name)
      if (sec) {
        const t = sec[2] as string
        const type = (['chorus', 'verse', 'bridge', 'tab'].includes(t) ? t : 'other') as 'chorus'
        if (t === 'tab') inTab = sec[1] === 'start'
        lines.push({ kind: 'section', name: value || t[0].toUpperCase() + t.slice(1), type, start: sec[1] === 'start' })
        continue
      }
      continue // unknown directive: ignore
    }
    if (inTab) { lines.push({ kind: 'tab', text: raw }); continue }
    if (!line.trim()) { lines.push({ kind: 'empty' }); continue }
    if (line.trim().startsWith('#')) continue
    lines.push({ kind: 'lyrics', segments: parseLyricLine(line) })
  }
  return { meta, lines }
}

export function parseLyricLine(line: string): Segment[] {
  const segments: Segment[] = []
  const re = /\[([^\]]*)\]/g
  let last = 0
  let chord: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const lyric = line.slice(last, m.index)
    if (lyric || chord !== null) segments.push({ chord, lyric })
    chord = m[1]
    last = m.index + m[0].length
  }
  const tail = line.slice(last)
  if (tail || chord !== null) segments.push({ chord, lyric: tail })
  return segments
}

export function transposeChordPro(src: string, semitones: number, preferFlats = false): string {
  if (!semitones) return src
  return src
    .split('\n')
    .map((l) => (DIRECTIVE.test(l.trim()) ? l : l.replace(/\[([^\]]+)\]/g, (_, c: string) => `[${transposeChord(c, semitones, preferFlats)}]`)))
    .join('\n')
}

/** Unique chords used, in order of first appearance. */
export function chordsUsed(src: string): string[] {
  const seen = new Set<string>()
  for (const m of src.matchAll(/\[([^\]]+)\]/g)) seen.add(m[1])
  return [...seen]
}
