import { useNavigate, useParams } from 'react-router-dom'
import { useSetlistData, itemDuration } from './SetlistEdit'
import { formatDuration, setlistTotals } from '../lib/time'

/** Big-type setlist for taping to the floor; use the browser's Print → Save as PDF. */
export function Print() {
  const { id } = useParams()
  const nav = useNavigate()
  const { setlist, items, songs } = useSetlistData(id)
  if (!setlist) return null
  const totals = setlistTotals(items.map((i) => ({ type: i.type, duration: itemDuration(i, songs) })))
  let n = 0
  return (
    <div className="min-h-full bg-white text-black p-8">
      <div className="no-print flex gap-2 mb-6">
        <button className="btn" onClick={() => window.print()}>Print / Save PDF</button>
        <button className="btn" onClick={() => nav(-1)}>Back</button>
      </div>
      <h1 className="text-2xl font-bold">{setlist.name}</h1>
      <p className="text-sm text-gray-600 mb-6">{[setlist.gig_date, setlist.start_time, setlist.venue].filter(Boolean).join(' · ')} · {totals.songs} songs · {formatDuration(totals.total)}</p>
      <ol className="flex flex-col gap-1">
        {items.map((it) => {
          if (it.type === 'section') { n = 0; return <li key={it.id} className="text-xl font-bold uppercase mt-6 border-b-2 border-black">{it.label}</li> }
          if (it.type === 'break') return <li key={it.id} className="text-lg italic text-gray-600 my-2">— {it.label || 'Break'} ({formatDuration(it.duration_sec)}) —</li>
          const s = it.song_id ? songs.get(it.song_id) : undefined
          n++
          return (
            <li key={it.id} className="text-3xl font-bold leading-tight flex gap-3">
              <span className="w-10 text-right text-gray-400">{n}</span>
              <span className="flex-1">{s?.title ?? '?'}</span>
              <span className="text-xl text-gray-600 self-end">{it.key_override || s?.key}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
