import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { ChordProView } from '../components/ChordProView'
import { Metronome } from '../components/Metronome'
import { TabViewer } from '../components/TabViewer'
import { useFileBlob } from '../components/SongFiles'
import { useFontSize } from './Song'
import { sortOrdered } from '../lib/ordering'
import { formatDuration } from '../lib/time'
import { prefersFlats, semitonesBetween } from '../lib/transpose'
import type { SetlistDB } from '../lib/db'
import type { SetlistItem, Song, SongFile, SongNote } from '../lib/types'

interface Show {
  title: string
  items: SetlistItem[]
  songs: Map<string, Song>
  notes: Map<string, SongNote>
  files: Map<string, SongFile[]>
  signature: string
}

async function loadShow(db: SetlistDB, kind: string, id: string, userId: string): Promise<Show | null> {
  let items: SetlistItem[]
  let title: string
  if (kind === 'song') {
    const s = await db.songs.get(id)
    if (!s) return null
    title = s.title
    items = [{ id: 'single', band_id: s.band_id, setlist_id: '', position: 'a0', type: 'song', song_id: s.id, label: '', duration_sec: null, key_override: '', version: 0, field_versions: {}, deleted_at: null }]
  } else {
    const sl = await db.setlists.get(id)
    if (!sl) return null
    title = sl.name
    items = sortOrdered(await db.setlist_items.where('setlist_id').equals(id).filter((i) => !i.deleted_at).toArray())
  }
  const ids = items.map((i) => i.song_id).filter(Boolean) as string[]
  const songs = new Map((await db.songs.bulkGet(ids)).filter(Boolean).map((s) => [s!.id, s!]))
  const notes = new Map((await db.song_notes.where('song_id').anyOf(ids).toArray())
    .filter((n) => !n.deleted_at && (!n.user_id || n.user_id === userId)).map((n) => [n.song_id, n]))
  const files = new Map<string, SongFile[]>()
  for (const f of await db.song_files.where('song_id').anyOf(ids).toArray()) {
    if (f.deleted_at) continue
    files.set(f.song_id, [...(files.get(f.song_id) ?? []), f])
  }
  const signature = JSON.stringify([
    title, items.map((i) => [i.id, i.position, i.version]), [...songs.values()].map((s) => [s.id, s.version]),
    [...notes.values()].map((n) => [n.id, n.note]), [...files.values()].flat().map((f) => [f.id, f.version]),
  ])
  return { title, items, songs, notes, files, signature }
}

/**
 * Stage mode: a frozen snapshot of the show. Band edits never rearrange the screen mid-show;
 * they show up as an "apply" banner instead.
 */
export function Stage() {
  const { kind = 'setlist', id } = useParams()
  const { db, user } = useApp()
  const nav = useNavigate()
  const [show, setShow] = useState<Show | null | undefined>(undefined)
  const [idx, setIdx] = useState(0)
  const [font, setFont] = useFontSize()
  const [auto, setAuto] = useState(false)
  const [autoSpeed, setAutoSpeed] = useState(1)
  const [tabOpen, setTabOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => { void loadShow(db, kind, id!, user.id).then(setShow) }, [db, kind, id, user.id])
  const latest = useLiveQuery(() => loadShow(db, kind, id!, user.id), [db, kind, id, user.id])
  const changed = !!show && !!latest && latest.signature !== show.signature

  const items = show?.items ?? []
  const item = items[idx]
  const song = item?.song_id ? show?.songs.get(item.song_id) : undefined
  const next = items.slice(idx + 1).find((i) => i.type === 'song')
  const nextSong = next?.song_id ? show?.songs.get(next.song_id) : undefined
  const songNumber = items.slice(0, idx + 1).filter((i) => i.type === 'song').length
  const songCount = items.filter((i) => i.type === 'song').length
  const playKey = item?.key_override || song?.key || ''
  const transpose = song?.key && item?.key_override ? semitonesBetween(song.key, item.key_override) : 0

  const go = useCallback((d: number) => {
    setIdx((i) => Math.max(0, Math.min(items.length - 1, i + d)))
    setTabOpen(false)
    scroller.current?.scrollTo({ top: 0 })
  }, [items.length])

  const apply = () => {
    if (!latest) return
    // keep the current song in view after the update
    const curId = item?.id
    setShow(latest)
    const ni = latest.items.findIndex((i) => i.id === curId)
    setIdx(ni >= 0 ? ni : Math.min(idx, latest.items.length - 1))
  }

  // Keys: Bluetooth page-turner pedals send arrows / PageUp / PageDown / Space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      const el = scroller.current
      if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1) }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); el?.scrollBy({ top: el.clientHeight * 0.7, behavior: 'smooth' }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); el?.scrollBy({ top: -el.clientHeight * 0.7, behavior: 'smooth' }) }
      else if (e.key === 'Escape') nav(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, nav])

  // Swipe left/right
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let x0 = 0, y0 = 0
    const start = (e: TouchEvent) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY }
    const end = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2 && !tabOpen) go(dx < 0 ? 1 : -1)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end, { passive: true })
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchend', end) }
  }, [go, tabOpen, show])

  // Keep the screen awake
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      try { lock = await navigator.wakeLock?.request('screen') } catch { /* unsupported or denied */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible') void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release() }
  }, [])

  // Auto-scroll: paced so the chart scrolls over the song's duration (×speed)
  useEffect(() => {
    if (!auto) return
    const el = scroller.current
    if (!el) return
    const duration = song?.duration_sec ?? 210
    let last = performance.now()
    let carry = 0
    let raf = 0
    const step = (t: number) => {
      const pxPerSec = ((el.scrollHeight - el.clientHeight) / duration) * autoSpeed
      carry += (pxPerSec * (t - last)) / 1000
      last = t
      if (carry >= 1) { el.scrollTop += Math.floor(carry); carry -= Math.floor(carry) }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [auto, autoSpeed, song, idx])

  const files = song ? show?.files.get(song.id) ?? [] : []
  const tabFile = files.find((f) => f.kind === 'gp' || f.kind === 'musicxml' || f.kind === 'tex')

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  if (show === undefined) return <div className="p-6 text-mute">Loading…</div>
  if (show === null || !items.length) return <div className="p-6 text-mute">Nothing to show. <button className="text-accent" onClick={() => nav(-1)}>Back</button></div>

  return (
    <div className="h-full flex flex-col bg-black text-ink select-none">
      <header className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-line text-sm" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button className="btn-ghost !px-2" onClick={() => nav(-1)} aria-label="Exit stage mode">✕</button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-mute truncate">{show.title} · {songNumber}/{songCount}</div>
          <div className="font-semibold truncate">{song?.title ?? item.label}</div>
        </div>
        {playKey && <span className="chip !text-accent !text-sm font-bold">{playKey}</span>}
        <Metronome bpm={song?.bpm ?? null} timeSig={song?.time_sig} compact />
        <button className="btn !px-2.5 hidden sm:inline-flex" onClick={fullscreen} aria-label="Fullscreen">⛶</button>
      </header>
      {changed && (
        <div className="bg-sky-900 text-sm px-3 py-1.5 flex items-center gap-2">
          <span className="flex-1">Setlist updated by the band.</span>
          <button className="btn !py-1 text-xs" onClick={apply}>Apply</button>
        </div>
      )}
      <div ref={scroller} className="flex-1 overflow-auto px-4 py-4" style={{ fontSize: font }}>
        {item.type === 'song' && song && (
          <div className="max-w-4xl mx-auto flex flex-col gap-3">
            {show.notes.get(song.id)?.note && <div className="rounded-lg bg-amber-950/60 border border-amber-800 px-3 py-2 text-[0.75em] text-amber-200 whitespace-pre-wrap">{show.notes.get(song.id)!.note}</div>}
            {item.label && <div className="text-[0.75em] text-sky-300">{item.label}</div>}
            {song.arrangement && <div className="text-[0.7em] text-mute">{song.arrangement}</div>}
            {tabOpen && tabFile ? <StageTab file={tabFile} /> : (
              <ChordProView src={song.lyrics_chordpro} transpose={transpose} preferFlats={prefersFlats(playKey)} fontSize={font} />
            )}
            <div className="h-[40vh]" />
          </div>
        )}
        {item.type === 'song' && !song && <div className="text-mute text-center mt-20">Song missing on this device</div>}
        {item.type === 'break' && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
            <div className="text-[2em] font-bold">{item.label || 'Break'}</div>
            <div className="text-mute">{formatDuration(item.duration_sec)}</div>
          </div>
        )}
        {item.type === 'section' && (
          <div className="h-full flex items-center justify-center text-[2.5em] font-bold text-accent uppercase">{item.label || 'Next set'}</div>
        )}
      </div>
      <footer className="flex items-center gap-2 px-3 py-2 bg-panel border-t border-line text-sm" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <button className="btn" onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous">◀</button>
        <button className="btn !px-2.5" onClick={() => setFont(Math.max(12, font - 2))}>A−</button>
        <button className="btn !px-2.5" onClick={() => setFont(Math.min(48, font + 2))}>A+</button>
        <button className={auto ? 'btn-primary' : 'btn'} onClick={() => setAuto(!auto)}>Auto-scroll</button>
        {auto && (
          <select className="field !w-auto !py-1" value={autoSpeed} onChange={(e) => setAutoSpeed(+e.target.value)} aria-label="Scroll speed">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        )}
        {tabFile && <button className={tabOpen ? 'btn-primary' : 'btn'} onClick={() => setTabOpen(!tabOpen)}>Tab</button>}
        <div className="flex-1 min-w-0 text-right text-xs text-mute truncate">{nextSong ? <>Next: <b className="text-ink">{nextSong.title}</b></> : 'Last song'}</div>
        <button className="btn-primary" onClick={() => go(1)} disabled={idx >= items.length - 1} aria-label="Next">▶</button>
      </footer>
    </div>
  )
}

function StageTab({ file }: { file: SongFile }) {
  const { blob, error } = useFileBlob(file.kind === 'tex' ? undefined : file)
  const [data, setData] = useState<ArrayBuffer | null>(null)
  useEffect(() => { if (blob) void blob.arrayBuffer().then(setData) }, [blob])
  const source = useMemo(() => (file.kind === 'tex' ? { kind: 'tex' as const, tex: file.tex } : data ? { kind: 'bytes' as const, data } : null), [file, data])
  if (!source) return <p className="text-warn text-sm">{error ?? 'Loading tab…'}</p>
  return <TabViewer source={source} />
}
