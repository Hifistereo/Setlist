import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useApp } from '../state/app'
import { Layout } from '../components/Layout'
import { Conflicts } from '../components/Conflicts'
import { planMove, positionFor, sortOrdered } from '../lib/ordering'
import { addToClock, formatDuration, parseDuration, setlistTotals } from '../lib/time'
import { downloadForGig, lastGigCheck, type GigCheck } from '../lib/gig'
import { duplicateSetlist } from './Setlists'
import type { Setlist, SetlistItem, Song } from '../lib/types'

export function useSetlistData(id: string | undefined) {
  const { db } = useApp()
  const setlist = useLiveQuery(async () => (await db.setlists.get(id!)) ?? null, [db, id])
  const items = useLiveQuery(
    async () => sortOrdered(await db.setlist_items.where('setlist_id').equals(id!).filter((i) => !i.deleted_at).toArray()),
    [db, id], [] as SetlistItem[],
  )
  const songs = useLiveQuery(async () => {
    const ids = items.map((i) => i.song_id).filter(Boolean) as string[]
    return new Map((await db.songs.bulkGet(ids)).filter(Boolean).map((s) => [s!.id, s!]))
  }, [db, items], new Map<string, Song>())
  return { setlist, items, songs }
}

export function itemDuration(it: SetlistItem, songs: Map<string, Song>) {
  return it.duration_sec ?? (it.song_id ? songs.get(it.song_id)?.duration_sec ?? null : null)
}

export function SetlistEdit() {
  const { id } = useParams()
  const { engine, db, bandId } = useApp()
  const nav = useNavigate()
  const { setlist, items, songs } = useSetlistData(id)
  const [picker, setPicker] = useState(false)
  const [gig, setGig] = useState<GigCheck | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => { if (id) void lastGigCheck(engine, id).then(setGig) }, [engine, id])

  const totals = useMemo(() => setlistTotals(items.map((i) => ({ type: i.type, duration: itemDuration(i, songs) }))), [items, songs])

  if (setlist === undefined) return <Layout title="Setlist"><p className="text-mute">Loading…</p></Layout>
  if (setlist === null) return <Layout title="Setlist"><p className="text-mute">Setlist not found. <Link className="text-accent" to="/setlists">Back</Link></p></Layout>

  const update = (f: Partial<Setlist>) => engine.mutate('setlists', setlist.id, f)

  const add = async (fields: Partial<SetlistItem>) => {
    // Read fresh rows: several quick adds must not reuse the same position.
    const current = sortOrdered(await db.setlist_items.where('setlist_id').equals(setlist.id).filter((i) => !i.deleted_at).toArray())
    const { position, rekey } = positionFor(current)
    for (const r of rekey) await engine.mutate('setlist_items', r.id, { position: r.position })
    await engine.mutate('setlist_items', null, { setlist_id: setlist.id, type: 'song', ...fields, position })
  }

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const to = items.findIndex((i) => i.id === e.over!.id)
    for (const u of planMove(items, String(e.active.id), to)) await engine.mutate('setlist_items', u.id, { position: u.position })
  }

  const download = async () => {
    setProgress('Starting…')
    try {
      setGig(await downloadForGig(engine, setlist.id, setProgress))
    } finally {
      setProgress(null)
    }
  }

  // Running clock per item
  let clock = 0
  const startsAt = items.map((it) => {
    const at = clock
    if (it.type !== 'section') clock += itemDuration(it, songs) ?? 0
    return at
  })
  let setNo = 1
  let songNo = 0

  return (
    <Layout title={setlist.name || 'Setlist'} actions={<Link to={`/stage/setlist/${setlist.id}`} className="btn-primary">Stage</Link>}>
      <div className="flex flex-col gap-4">
        <Conflicts recordId={setlist.id} />
        <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <BlurInput className="col-span-2" label="Name" value={setlist.name} onSave={(v) => update({ name: v })} />
          <BlurInput label="Date" type="date" value={setlist.gig_date ?? ''} onSave={(v) => update({ gig_date: v || null })} />
          <BlurInput label="Start time" type="time" value={setlist.start_time} onSave={(v) => update({ start_time: v })} />
          <BlurInput className="col-span-2" label="Venue" value={setlist.venue} onSave={(v) => update({ venue: v })} />
          <BlurInput className="col-span-2" label="Notes" value={setlist.notes} onSave={(v) => update({ notes: v })} />
        </div>

        <div className="card p-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
          <span><b>{totals.songs}</b> songs</span>
          <span>Music <b>{formatDuration(totals.music)}</b></span>
          {totals.breaks > 0 && <span>Breaks <b>{formatDuration(totals.breaks)}</b></span>}
          <span>Total <b>{formatDuration(totals.total)}</b></span>
          {setlist.start_time && <span>Ends ≈ <b>{addToClock(setlist.start_time, totals.total)}</b></span>}
          {totals.sets.length > 1 && totals.sets.map((s) => <span key={s.index} className="text-mute">Set {s.index}: {formatDuration(s.seconds)}</span>)}
          {totals.unknown > 0 && <span className="text-warn">{totals.unknown} song(s) without duration</span>}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="card divide-y divide-line">
              {items.length === 0 && <li className="p-4 text-sm text-mute">Empty. Add songs below.</li>}
              {items.map((it, idx) => {
                if (it.type === 'section') { setNo++; songNo = 0 }
                if (it.type === 'song') songNo++
                return (
                  <Row key={it.id} item={it} song={it.song_id ? songs.get(it.song_id) : undefined} number={it.type === 'song' ? songNo : undefined}
                    setNo={setNo} startsAt={setlist.start_time ? addToClock(setlist.start_time, startsAt[idx]) : formatDuration(startsAt[idx])} />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>

        <div className="flex flex-wrap gap-2 no-print">
          <button className="btn-primary" onClick={() => setPicker(true)}>+ Songs</button>
          <button className="btn" onClick={() => add({ type: 'break', label: 'Break', duration_sec: 900 })}>+ Break</button>
          <button className="btn" onClick={() => add({ type: 'section', label: `Set ${totals.sets.length + 1}` })}>+ Set divider</button>
        </div>

        <section className="card p-4 flex flex-col gap-2 no-print">
          <h2 className="font-semibold">Gig mode</h2>
          <p className="text-xs text-mute">Downloads every song, tab and the playback engine to this device, then checks that the show works without internet.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={download} disabled={!!progress}>{progress ? 'Downloading…' : 'Download for gig'}</button>
            {gig && (gig.ready
              ? <span className="chip !text-ok">Offline ready ✓ · {new Date(gig.checkedAt).toLocaleString()}</span>
              : <span className="chip !text-bad">Download incomplete</span>)}
          </div>
          {progress && <p className="text-xs text-mute">{progress}</p>}
          {gig && gig.missing.length > 0 && <ul className="text-sm text-bad list-disc pl-5">{gig.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
          {gig && gig.warnings.length > 0 && <ul className="text-xs text-warn list-disc pl-5">{gig.warnings.map((m) => <li key={m}>{m}</li>)}</ul>}
        </section>

        <div className="flex flex-wrap gap-2 no-print">
          <Link className="btn" to={`/setlists/${setlist.id}/print`}>Print / PDF</Link>
          <button className="btn" onClick={async () => nav(`/setlists/${await duplicateSetlist(engine, setlist)}`)}>Duplicate</button>
          <div className="flex-1" />
          <button className="btn-danger" onClick={async () => {
            if (!confirm(`Delete setlist “${setlist.name}”?`)) return
            await engine.remove('setlists', setlist.id)
            nav('/setlists', { replace: true })
          }}>Delete</button>
        </div>
      </div>
      {picker && <SongPicker db={db} bandId={bandId} inSetlist={new Set(items.map((i) => i.song_id!).filter(Boolean))}
        onAdd={(songId) => add({ type: 'song', song_id: songId })} onClose={() => setPicker(false)} />}
    </Layout>
  )
}

function BlurInput({ label, value, onSave, type = 'text', className = '' }: { label: string; value: string; onSave: (v: string) => void; type?: string; className?: string }) {
  const [v, setV] = useState<string | null>(null)
  return (
    <label className={className}>
      <span className="label">{label}</span>
      <input className="field" type={type} value={v ?? value} onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== null && v !== value) onSave(v); setV(null) }} />
    </label>
  )
}

function Row({ item, song, number, startsAt, setNo }: { item: SetlistItem; song?: Song; number?: number; startsAt: string | null; setNo: number }) {
  const { engine } = useApp()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const [open, setOpen] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }
  const remove = () => engine.remove('setlist_items', item.id)

  if (item.type === 'section') {
    return (
      <li ref={setNodeRef} style={style} className="flex items-center gap-2 px-3 py-2 bg-panel2">
        <span {...attributes} {...listeners} className="cursor-grab touch-none px-1 text-mute" aria-label="Drag">⠿</span>
        <input key={item.label} className="bg-transparent font-semibold text-accent flex-1 min-w-0 uppercase text-sm tracking-wide" defaultValue={item.label || `Set ${setNo}`}
          onBlur={(e) => e.target.value !== item.label && engine.mutate('setlist_items', item.id, { label: e.target.value })} aria-label="Set name" />
        <button className="btn-ghost text-xs" onClick={remove} aria-label="Remove">✕</button>
      </li>
    )
  }
  if (item.type === 'break') {
    return (
      <li ref={setNodeRef} style={style} className="flex items-center gap-2 px-3 py-2 text-mute bg-bg/40">
        <span {...attributes} {...listeners} className="cursor-grab touch-none px-1" aria-label="Drag">⠿</span>
        <span className="text-xs tabular-nums w-12">{startsAt}</span>
        <input key={item.label} className="bg-transparent italic flex-1 min-w-0 text-sm" defaultValue={item.label}
          onBlur={(e) => e.target.value !== item.label && engine.mutate('setlist_items', item.id, { label: e.target.value })} aria-label="Break label" />
        <input key={item.duration_sec ?? -1} className="field !w-16 !py-1 text-xs shrink-0" defaultValue={formatDuration(item.duration_sec)} aria-label="Break length"
          onBlur={(e) => { const d = parseDuration(e.target.value); if (d !== item.duration_sec) void engine.mutate('setlist_items', item.id, { duration_sec: d }) }} />
        <button className="btn-ghost text-xs" onClick={remove} aria-label="Remove">✕</button>
      </li>
    )
  }
  return (
    <li ref={setNodeRef} style={style} className={`px-3 py-2 ${isDragging ? 'bg-panel2 shadow-lg' : ''}`}>
      <div className="flex items-center gap-2">
        <span {...attributes} {...listeners} className="cursor-grab touch-none px-1 text-mute" aria-label="Drag">⠿</span>
        <span className="text-xs text-mute tabular-nums w-12">{startsAt}</span>
        <span className="text-xs text-mute w-5 text-right">{number}</span>
        {song ? (
          <Link to={`/songs/${song.id}`} className="flex-1 min-w-0">
            <div className={`truncate ${song.deleted_at ? 'line-through text-mute' : ''}`}>{song.title}</div>
            <div className="text-xs text-mute truncate">{song.artist}</div>
          </Link>
        ) : <div className="flex-1 text-mute italic">Missing song</div>}
        <span className="text-xs tabular-nums text-right">
          {(item.key_override || song?.key) && <span className="text-accent font-semibold mr-2">{item.key_override || song?.key}</span>}
          {formatDuration(item.duration_sec ?? song?.duration_sec)}
        </span>
        <button className="btn-ghost text-xs !px-2" onClick={() => setOpen(!open)} aria-label="Options">⋯</button>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-2 mt-2 pl-8">
          <label className="text-xs"><span className="label">Key for this gig</span>
            <input className="field !w-24 !py-1" defaultValue={item.key_override} placeholder={song?.key}
              onBlur={(e) => e.target.value !== item.key_override && engine.mutate('setlist_items', item.id, { key_override: e.target.value.trim() })} /></label>
          <label className="text-xs"><span className="label">Length override</span>
            <input className="field !w-24 !py-1" defaultValue={item.duration_sec ? formatDuration(item.duration_sec) : ''} placeholder={formatDuration(song?.duration_sec)}
              onBlur={(e) => { const d = parseDuration(e.target.value); if (d !== item.duration_sec) void engine.mutate('setlist_items', item.id, { duration_sec: d }) }} /></label>
          <label className="text-xs flex-1 min-w-40"><span className="label">Note for this gig</span>
            <input className="field !py-1" defaultValue={item.label} placeholder="e.g. segue into next, extended solo"
              onBlur={(e) => e.target.value !== item.label && engine.mutate('setlist_items', item.id, { label: e.target.value })} /></label>
          <button className="btn-danger text-xs" onClick={remove}>Remove</button>
        </div>
      )}
      {!open && item.label && <div className="text-xs text-sky-300 pl-[5.5rem] truncate">{item.label}</div>}
    </li>
  )
}

function SongPicker({ db, bandId, inSetlist, onAdd, onClose }: {
  db: ReturnType<typeof useApp>['db']; bandId: string; inSetlist: Set<string>; onAdd: (id: string) => Promise<void>; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const songs = useLiveQuery(() => db.songs.where('band_id').equals(bandId).filter((s) => !s.deleted_at).sortBy('title'), [db, bandId], [] as Song[])
  const needle = q.toLowerCase()
  const list = songs.filter((s) => `${s.title} ${s.artist} ${s.tags.join(' ')}`.toLowerCase().includes(needle))
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="card w-full md:max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add songs">
        <div className="p-3 border-b border-line flex gap-2">
          <input className="field" autoFocus type="search" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
        <ul className="overflow-auto divide-y divide-line">
          {list.map((s) => {
            const n = added.filter((a) => a === s.id).length
            return (
              <li key={s.id}>
                <button className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-panel2"
                  onClick={async () => { await onAdd(s.id); setAdded((x) => [...x, s.id]) }}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{s.title}</span>
                    <span className="block text-xs text-mute truncate">{s.artist} · {s.key} · {formatDuration(s.duration_sec)}</span>
                  </span>
                  {(inSetlist.has(s.id) || n > 0) && <span className="chip !text-ok">in set{n > 1 ? ` ×${n}` : ''}</span>}
                  <span className="text-accent text-lg">+</span>
                </button>
              </li>
            )
          })}
          {!list.length && <li className="p-4 text-sm text-mute">No songs found.</li>}
        </ul>
      </div>
    </div>
  )
}
