import { parseDuration } from './time'

/** RFC-4180-ish CSV parser (quotes, escaped quotes, newlines in quotes, ; or , delimiters). */
export function parseCsv(text: string): string[][] {
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

export interface ImportedSong {
  title: string
  artist: string
  key: string
  bpm: number | null
  duration_sec: number | null
  tags: string[]
}

const COLS: Record<keyof ImportedSong, RegExp> = {
  title: /^(title|song|name|dziesma|nosaukums)$/i,
  artist: /^(artist|band|performer|izpild)/i,
  key: /^(key|tonality|tonalitāte)$/i,
  bpm: /^(bpm|tempo)$/i,
  duration_sec: /^(duration|length|time|ilgums)$/i,
  tags: /^(tags?|genre|style|žanrs)$/i,
}

export function csvToSongs(text: string): ImportedSong[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const idx = Object.fromEntries(
    (Object.keys(COLS) as (keyof ImportedSong)[]).map((k) => [k, header.findIndex((h) => COLS[k].test(h.trim()))]),
  ) as Record<keyof ImportedSong, number>
  if (idx.title < 0) idx.title = 0
  const get = (r: string[], k: keyof ImportedSong) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
  return rows
    .map((r) => ({
      title: get(r, 'title'),
      artist: get(r, 'artist'),
      key: get(r, 'key'),
      bpm: parseInt(get(r, 'bpm')) || null,
      duration_sec: parseDuration(get(r, 'duration_sec')),
      tags: get(r, 'tags').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
    }))
    .filter((s) => s.title)
}
