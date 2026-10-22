import { useMemo } from 'react'
import { parseChordPro, transposeChordPro, type Line } from '../lib/chordpro'

interface Props {
  src: string
  transpose?: number
  preferFlats?: boolean
  fontSize?: number
  showChords?: boolean
}

export function ChordProView({ src, transpose = 0, preferFlats, fontSize = 18, showChords = true }: Props) {
  const parsed = useMemo(() => parseChordPro(transposeChordPro(src, transpose, preferFlats)), [src, transpose, preferFlats])
  const blocks = useMemo(() => groupChorus(parsed.lines), [parsed])
  if (!src.trim()) return <p className="text-mute text-sm">No lyrics or chords yet.</p>
  return (
    <div style={{ fontSize }} className="leading-snug">
      {blocks.map((b, i) =>
        b.chorus ? (
          <div key={i} className="cp-chorus my-2">
            {b.label && <div className="text-mute text-[0.7em] uppercase tracking-wide mb-1">{b.label}</div>}
            {b.lines.map((l, j) => <LineView key={j} line={l} showChords={showChords} />)}
          </div>
        ) : (
          b.lines.map((l, j) => <LineView key={`${i}-${j}`} line={l} showChords={showChords} />)
        ),
      )}
    </div>
  )
}

function groupChorus(lines: Line[]) {
  const out: { chorus: boolean; label?: string; lines: Line[] }[] = []
  let cur: { chorus: boolean; label?: string; lines: Line[] } = { chorus: false, lines: [] }
  for (const l of lines) {
    if (l.kind === 'section' && l.type === 'chorus') {
      out.push(cur)
      cur = l.start ? { chorus: true, label: l.name, lines: [] } : { chorus: false, lines: [] }
      continue
    }
    cur.lines.push(l)
  }
  out.push(cur)
  return out.filter((b) => b.lines.length)
}

function LineView({ line, showChords }: { line: Line; showChords: boolean }) {
  switch (line.kind) {
    case 'empty':
      return <div className="h-[0.8em]" />
    case 'comment':
      return <div className="my-1 text-[0.8em] font-semibold text-sky-300 bg-sky-950/40 rounded px-2 py-0.5 inline-block">{line.text}</div>
    case 'section':
      return line.start && line.type !== 'tab' ? <div className="text-mute text-[0.7em] uppercase tracking-wide mt-2">{line.name}</div> : null
    case 'tab':
      return <pre className="font-mono text-[0.75em] text-ink/90 leading-tight">{line.text}</pre>
    case 'lyrics': {
      const hasChords = showChords && line.segments.some((s) => s.chord)
      return (
        <div className="cp-line">
          {line.segments.map((s, i) => (
            <span key={i} className="cp-seg">
              {hasChords && <span className="cp-chord">{s.chord ?? ''}</span>}
              <span className="cp-lyric">{s.lyric || (hasChords ? ' ' : '')}</span>
            </span>
          ))}
        </div>
      )
    }
  }
}
