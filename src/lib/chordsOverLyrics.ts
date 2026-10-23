import { isChord } from './transpose'

/**
 * Convert a "chords over lyrics" sheet (as copied from chord websites) into ChordPro.
 * The format is ambiguous, so the UI always shows a preview and lets the user undo.
 */

const SECTION_RE = /^\s*[[(]?\s*(intro|verse|chorus|pre-?chorus|bridge|solo|outro|interlude|instrumental|refrain|hook|coda|break)(\s*\d+)?\s*[\])]?\s*:?\s*$/i
const TAB_RE = /^\s*[eBGDAEbgdae]?\s*[|:][-0-9|hpbrx/\\~^().\s]{6,}$/

export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return false
  const chordish = tokens.filter((t) => isChord(t.replace(/[|()]/g, '')) || /^[|x/%-]+$/.test(t) || /^x\d+$/i.test(t))
  return chordish.length / tokens.length >= 0.75 && tokens.some((t) => isChord(t.replace(/[|()]/g, '')))
}

/** Insert chords from a chord line at their column positions into the lyric line below. */
export function mergeChordLine(chordLine: string, lyric: string): string {
  const chords: { col: number; chord: string }[] = []
  for (const m of chordLine.matchAll(/\S+/g)) {
    const token = m[0].replace(/[|()]/g, '')
    if (isChord(token)) chords.push({ col: m.index!, chord: token })
  }
  let out = lyric.padEnd(Math.max(lyric.length, ...chords.map((c) => c.col)), ' ')
  for (const c of [...chords].reverse()) out = out.slice(0, c.col) + `[${c.chord}]` + out.slice(c.col)
  return out.trimEnd()
}

function chordOnly(line: string): string {
  return line.trim().split(/\s+/).map((t) => t.replace(/[|()]/g, '')).filter(isChord).map((c) => `[${c}]`).join(' ')
}

export function chordsOverLyricsToChordPro(text: string): string {
  // NFC: text copied from PDFs/some sites stores "ā" as "a" + combining macron, which would shift chord columns.
  const lines = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const out: string[] = []
  let inTab = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (TAB_RE.test(line)) {
      if (!inTab) { out.push('{start_of_tab}'); inTab = true }
      out.push(line)
      continue
    }
    if (inTab) { out.push('{end_of_tab}'); inTab = false }
    const sec = SECTION_RE.exec(line)
    if (sec) {
      const name = line.trim().replace(/^[[(]|[\])]:?$|:$/g, '').trim()
      out.push(/chorus|refrain|hook/i.test(sec[1]) && !/pre/i.test(sec[1]) ? `{start_of_chorus: ${name}}` : `{comment: ${name}}`)
      if (/chorus|refrain|hook/i.test(sec[1]) && !/pre/i.test(sec[1])) {
        // close the chorus at the next blank line or section header
        let j = i + 1
        while (j < lines.length && lines[j].trim() && !SECTION_RE.test(lines[j])) j++
        const body = chordsOverLyricsToChordPro(lines.slice(i + 1, j).join('\n'))
        if (body) out.push(body)
        out.push('{end_of_chorus}')
        i = j - 1
      }
      continue
    }
    if (isChordLine(line)) {
      const next = lines[i + 1]
      if (next !== undefined && next.trim() && !isChordLine(next) && !SECTION_RE.test(next) && !TAB_RE.test(next)) {
        out.push(mergeChordLine(line, next))
        i++
      } else {
        out.push(chordOnly(line))
      }
      continue
    }
    out.push(line.trimEnd())
  }
  if (inTab) out.push('{end_of_tab}')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** True if the text looks like it's already ChordPro (inline [chords] or {directives}). */
export function looksLikeChordPro(text: string): boolean {
  return /\[[A-G][^\]]{0,8}\]/.test(text) || /^\{\w+.*\}$/m.test(text)
}
