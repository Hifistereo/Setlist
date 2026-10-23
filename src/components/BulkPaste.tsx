import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { matchSong, parseSongLines, pendingPlan, planBulkImport, runBulkPlan, type BulkPlan, type LineOrder, type ResolvedRow } from '../lib/bulkSongs'
import type { SetTotals } from '../lib/time'
import type { SetlistItem, Song } from '../lib/types'

const ORDER_KEY = 'setlist.bulkOrder'
const loadOrder = (): LineOrder => { try { return localStorage.getItem(ORDER_KEY) === 'artist-title' ? 'artist-title' : 'title-artist' } catch { return 'title-artist' } }

/**
 * Paste a whole setlist. Every line is matched against the band library first; only unambiguous
 * matches are taken as is, everything else waits for the user. Nothing is saved before "Add".
 */
export function BulkPaste({ setlistId, items, totals, onClose }: { setlistId: string; items: SetlistItem[]; totals: SetTotals; onClose: () => void }) {
  const { db, bandId, engine } = useApp()
  const library = useLiveQuery(() => db.songs.where('band_id').equals(bandId).filter((s) => !s.deleted_at).toArray(), [db, bandId], [] as Song[])
  const [text, setText] = useState('')
  const [order, setOrderState] = useState<LineOrder>(loadOrder)
  // Per-row decisions are keyed by the line's text (and the line order), not its position, so editing
  // the list can never carry a choice over to a different song.
  const [flipped, setFlipped] = useState<Set<string>>(new Set())
  const [choice, setChoice] = useState<Map<string, string>>(new Map())
  // Once Add has started, the plan is fixed: a retry reruns exactly it, never a rebuilt one.
  const [plan, setPlan] = useState<BulkPlan | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setOrder = (o: LineOrder) => {
    setOrderState(o)
    try { localStorage.setItem(ORDER_KEY, o) } catch { /* ignore */ }
  }

  const rows = useMemo(() => {
    const seen = new Map<string, number>()
    return parseSongLines(text, order).map((line) => {
      const n = (seen.get(line.raw) ?? 0) + 1
      seen.set(line.raw, n)
      const key = `${order}|${n}|${line.raw}`
      if (line.kind === 'section') return { key, line, match: null }
      const l = flipped.has(key) ? { ...line, title: line.artist, artist: line.title } : line
      return { key, line: l, match: matchSong(l, library) }
    })
  }, [text, order, flipped, library])

  /** '' = still needs a decision, 'new' = create, otherwise an existing song id */
  const decided = (key: string, m: NonNullable<(typeof rows)[number]['match']>) =>
    choice.get(key) ?? (m.status === 'exact' ? m.song!.id : m.status === 'new' ? 'new' : '')
  const open = rows.filter((r) => r.match && !decided(r.key, r.match)).length
  const locked = !!plan
  const songCount = rows.filter((r) => r.match).length

  const build = async (): Promise<BulkPlan> => {
    const resolved: ResolvedRow[] = rows.map(({ key, line, match }) => {
      if (line.kind === 'section') return { kind: 'section', label: line.label }
      const d = decided(key, match!)
      return { kind: 'song', songId: d === 'new' ? null : d, title: line.title, artist: line.artist }
    })
    const current = items[items.length - 1]
    const last = totals.sets[totals.sets.length - 1]
    const p = await planBulkImport({
      importId: crypto.randomUUID(), setlistId, rows: resolved, lastPosition: current?.position ?? null,
      currentSet: totals.sets.length, currentSetHasSongs: (last?.songs ?? 0) > 0,
    })
    pendingPlan.set(bandId, p)
    return p
  }

  const add = async () => {
    setError(null)
    const p = plan ?? await build()
    setPlan(p)
    try {
      await runBulkPlan(engine, p, (done, total) => setProgress(`Adding ${done}/${total}…`))
      pendingPlan.clear(bandId, setlistId)
      onClose()
    } catch (e) {
      setError(`Stopped part-way: ${e instanceof Error ? e.message : String(e)}. Press Finish adding — the same list is used again, so nothing is added twice.`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="card w-full md:max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Paste songs">
        <div className="p-3 border-b border-line flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold flex-1">Paste songs</h2>
            <button className="btn-ghost text-xs" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <textarea className="field min-h-32 text-sm" autoFocus value={text} readOnly={locked} onChange={(e) => setText(e.target.value)} aria-label="Song list"
            placeholder={'One song per line, e.g.\nSet 1\nSuperstition – Stevie Wonder\nSex Bomb – Tom Jones\n---\nLaternas – Sudden Lights'} />
          <label className="text-xs text-mute flex items-center gap-2">Lines are
            <select className="field !w-auto !py-1" value={order} disabled={locked} onChange={(e) => setOrder(e.target.value as LineOrder)} aria-label="Line order">
              <option value="title-artist">Title – Artist</option>
              <option value="artist-title">Artist – Title</option>
            </select>
          </label>
        </div>
        <ul className="overflow-auto divide-y divide-line flex-1">
          {rows.map(({ key, line, match }) => {
            if (line.kind === 'section') {
              return <li key={key} className="px-3 py-1.5 bg-panel2 text-xs font-semibold uppercase tracking-wide text-accent">{line.label || 'Set divider'}</li>
            }
            const d = decided(key, match!)
            const status = d === '' ? 'Confirm?' : d === 'new' ? 'New song' : 'Matched'
            return (
              <li key={key} className="px-3 py-2 flex flex-wrap items-center gap-2" data-testid="bulk-row">
                <div className="flex-1 min-w-40">
                  <div className="truncate text-sm">{line.title}</div>
                  <div className="text-xs text-mute truncate">{line.artist || '—'}</div>
                </div>
                {line.artist && (
                  <button type="button" className="btn-ghost text-xs !px-2" disabled={locked} title="Swap title and artist" aria-label={`Swap title and artist for ${line.title}`}
                    onClick={() => {
                      setFlipped((f) => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n })
                      setChoice((c) => { const n = new Map(c); n.delete(key); return n })
                    }}>⇄</button>
                )}
                <span className={`chip ${d === '' ? '!text-warn !border-warn/50' : d === 'new' ? '!text-sky-300' : '!text-ok'}`}>{status}</span>
                {match!.candidates.length > 0 && (
                  <select className="field !w-auto !py-1 text-xs max-w-56" value={d} disabled={locked} aria-label={`Match for ${line.title}`}
                    onChange={(e) => setChoice((c) => new Map(c).set(key, e.target.value))}>
                    {d === '' && <option value="" disabled>Choose…</option>}
                    {match!.candidates.map((s) => <option key={s.id} value={s.id}>{s.title}{s.artist ? ` – ${s.artist}` : ''}</option>)}
                    <option value="new">New song</option>
                  </select>
                )}
              </li>
            )
          })}
          {!rows.length && <li className="p-4 text-sm text-mute">Matches with your song library show up here before anything is added.</li>}
        </ul>
        <div className="p-3 border-t border-line flex flex-wrap items-center gap-2">
          {error && <p className="w-full text-sm text-bad">{error}</p>}
          <span className="text-xs text-mute flex-1">{progress ?? (open ? `${open} line${open > 1 ? 's' : ''} to confirm` : songCount ? `${songCount} songs` : '')}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={add} disabled={!rows.length || (!locked && open > 0) || !!progress}>{locked ? 'Finish adding' : 'Add to setlist'}</button>
        </div>
      </div>
    </div>
  )
}
