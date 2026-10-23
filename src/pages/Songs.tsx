import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { Empty, Layout } from '../components/Layout'
import { formatDuration } from '../lib/time'
import { csvToSongs } from '../lib/csv'
import { ChartBadge, useReadiness } from '../components/ChartStatus'
import type { Song } from '../lib/types'

type Sort = 'title' | 'artist' | 'recent' | 'key'

export function Songs() {
  const { db, bandId, engine } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<Sort>('title')
  const [showDeleted, setShowDeleted] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const songs = useLiveQuery(() => db.songs.where('band_id').equals(bandId).toArray(), [db, bandId], [] as Song[])

  const tags = useMemo(() => [...new Set(songs.filter((s) => !s.deleted_at).flatMap((s) => s.tags))].sort(), [songs])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return songs
      .filter((s) => (showDeleted ? !!s.deleted_at : !s.deleted_at))
      .filter((s) => !tag || s.tags.includes(tag))
      .filter((s) => !needle || `${s.title} ${s.artist} ${s.key} ${s.tags.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === 'recent') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
        if (sort === 'artist') return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
        if (sort === 'key') return a.key.localeCompare(b.key) || a.title.localeCompare(b.title)
        return a.title.localeCompare(b.title)
      })
  }, [songs, q, tag, sort, showDeleted])
  const ready = useReadiness(list)

  const importCsv = async (file: File) => {
    const rows = csvToSongs(await file.text())
    if (!rows.length) return alert('No songs found. The first row must be a header with at least a “Title” column.')
    if (!confirm(`Import ${rows.length} songs?`)) return
    for (const r of rows) await engine.mutate('songs', null, r)
  }

  return (
    <Layout title="Songs" actions={<>
      <button className="btn" onClick={() => nav('/import')}>Import</button>
      <button className="btn-primary" onClick={() => nav('/songs/new')}>+ Song</button>
    </>}>
      <div className="flex flex-col gap-3">
        <input className="field" type="search" placeholder={`Search ${songs.filter((s) => !s.deleted_at).length} songs…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-2 items-center">
          <select className="field !w-auto !py-1" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="title">A–Z</option>
            <option value="artist">Artist</option>
            <option value="key">Key</option>
            <option value="recent">Recently changed</option>
          </select>
          {tags.length > 0 && (
            <select className="field !w-auto !py-1" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">All tags</option>
              {tags.map((t) => <option key={t}>{t}</option>)}
            </select>
          )}
          <label className="text-xs text-mute flex items-center gap-1">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Deleted
          </label>
          <div className="flex-1" />
          <button className="btn-ghost text-xs" onClick={() => fileInput.current?.click()}>Import CSV</button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = '' }} />
        </div>
        {!list.length ? (
          <Empty>{songs.length ? 'No songs match.' : <>No songs yet. <Link className="text-accent" to="/songs/new">Add your first song</Link> or import a CSV.</>}</Empty>
        ) : (
          <ul className="card divide-y divide-line">
            {list.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/songs/${s.id}`} className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.title || 'Untitled'}</div>
                  <div className="text-xs text-mute truncate">{s.artist}{s.tags.length ? ` · ${s.tags.join(', ')}` : ''}</div>
                </Link>
                {!showDeleted && ready.get(s.id) && <ChartBadge r={ready.get(s.id)!} />}
                <div className="text-right text-xs text-mute shrink-0 tabular-nums">
                  <div>{s.key && <span className="text-accent font-semibold">{s.key}</span>} {s.bpm ? `${s.bpm} bpm` : ''}</div>
                  <div>{formatDuration(s.duration_sec)}</div>
                </div>
                {showDeleted && <button className="btn text-xs" onClick={() => engine.restore('songs', s.id)}>Restore</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  )
}
