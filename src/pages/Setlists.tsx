import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { Empty, Layout } from '../components/Layout'
import { sortOrdered } from '../lib/ordering'
import { formatDuration, setlistTotals } from '../lib/time'
import type { Setlist, SetlistItem, Song } from '../lib/types'
import type { SyncEngine } from '../lib/sync/engine'

export async function duplicateSetlist(engine: SyncEngine, s: Setlist): Promise<string> {
  const id = await engine.mutate('setlists', null, { name: `${s.name} (copy)`, gig_date: null, start_time: s.start_time, venue: s.venue, notes: s.notes })
  const items = sortOrdered(await engine.db.setlist_items.where('setlist_id').equals(s.id).filter((i) => !i.deleted_at).toArray())
  for (const it of items) {
    await engine.mutate('setlist_items', null, {
      setlist_id: id, position: it.position, type: it.type, song_id: it.song_id, label: it.label,
      duration_sec: it.duration_sec, key_override: it.key_override,
    })
  }
  return id
}

export function Setlists() {
  const { db, bandId, engine } = useApp()
  const nav = useNavigate()
  const setlists = useLiveQuery(() => db.setlists.where('band_id').equals(bandId).filter((s) => !s.deleted_at).toArray(), [db, bandId], [] as Setlist[])
  const items = useLiveQuery(() => db.setlist_items.where('band_id').equals(bandId).filter((i) => !i.deleted_at).toArray(), [db, bandId], [] as SetlistItem[])
  const songs = useLiveQuery(() => db.songs.where('band_id').equals(bandId).toArray(), [db, bandId], [] as Song[])

  const today = new Date().toISOString().slice(0, 10)
  const { upcoming, past } = useMemo(() => {
    const sorted = [...setlists].sort((a, b) => (a.gig_date ?? '9999').localeCompare(b.gig_date ?? '9999') || a.name.localeCompare(b.name))
    return { upcoming: sorted.filter((s) => !s.gig_date || s.gig_date >= today), past: sorted.filter((s) => s.gig_date && s.gig_date < today).reverse() }
  }, [setlists, today])

  const summary = (s: Setlist) => {
    const songById = new Map(songs.map((x) => [x.id, x]))
    const its = sortOrdered(items.filter((i) => i.setlist_id === s.id))
    const t = setlistTotals(its.map((i) => ({ type: i.type, duration: i.duration_sec ?? (i.song_id ? songById.get(i.song_id)?.duration_sec ?? null : null) })))
    return `${t.songs} songs · ${formatDuration(t.music)}${t.sets.length > 1 ? ` · ${t.sets.length} sets` : ''}`
  }

  const create = async () => {
    const id = await engine.mutate('setlists', null, { name: 'New setlist', gig_date: today })
    nav(`/setlists/${id}`)
  }

  const row = (s: Setlist) => (
    <li key={s.id} className="flex items-center gap-3 px-4 py-3">
      <Link to={`/setlists/${s.id}`} className="flex-1 min-w-0">
        <div className="font-medium truncate">{s.name || 'Untitled'}</div>
        <div className="text-xs text-mute truncate">{[s.gig_date, s.start_time, s.venue].filter(Boolean).join(' · ')}</div>
        <div className="text-xs text-mute">{summary(s)}</div>
      </Link>
      <Link to={`/stage/setlist/${s.id}`} className="btn text-xs">Stage</Link>
    </li>
  )

  return (
    <Layout title="Setlists" actions={<button className="btn-primary" onClick={create}>+ Setlist</button>}>
      <div className="flex flex-col gap-4">
        {!setlists.length && <Empty>No setlists yet. Create one for your next gig.</Empty>}
        {upcoming.length > 0 && <section><h2 className="text-xs uppercase text-mute mb-2">Upcoming</h2><ul className="card divide-y divide-line">{upcoming.map(row)}</ul></section>}
        {past.length > 0 && <section><h2 className="text-xs uppercase text-mute mb-2">Past</h2><ul className="card divide-y divide-line">{past.map(row)}</ul></section>}
      </div>
    </Layout>
  )
}
