import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { readiness, STATUS_LABEL, type ChartStatus, type Readiness } from '../lib/readiness'
import { finderLinks } from '../lib/finder'
import { setPendingImport } from '../lib/pendingImport'
import { FILE_ACCEPT, uploadSongFile } from './SongFiles'
import type { Song, SongFile } from '../lib/types'

/** Readiness for a set of songs, live (charts and tab files can change on other devices). */
export function useReadiness(songs: Song[]): Map<string, Readiness> {
  const { db } = useApp()
  const ids = songs.map((s) => s.id)
  const files = useLiveQuery(
    () => (ids.length ? db.song_files.where('song_id').anyOf(ids).filter((f) => !f.deleted_at).toArray() : []),
    [db, ids.join(',')], [] as SongFile[],
  )
  const bySong = new Map<string, SongFile[]>()
  for (const f of files) bySong.set(f.song_id, [...(bySong.get(f.song_id) ?? []), f])
  return new Map(songs.map((s) => [s.id, readiness(s, bySong.get(s.id))]))
}

const TONE: Record<ChartStatus, string> = {
  ready: '!text-ok !border-ok/40',
  'needs-review': '!text-warn !border-warn/50',
  draft: '!text-sky-300',
  'lyrics-only': '!text-warn',
  'tab-only': '!text-sky-300',
  missing: '!text-bad !border-bad/50',
}

export function ChartBadge({ r, onClick }: { r: Readiness; onClick?: () => void }) {
  const label = STATUS_LABEL[r.status]
  const cls = `chip ${TONE[r.status]} whitespace-nowrap`
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {onClick
        ? <button type="button" className={`${cls} hover:bg-panel`} onClick={onClick} aria-label={`Chart: ${label}`}>{label}</button>
        : <span className={cls}>{label}</span>}
      {r.tab && r.status !== 'tab-only' && <span className="chip !text-sky-300" title="Has a Guitar Pro / MusicXML / alphaTex tab">TAB</span>}
    </span>
  )
}

/**
 * Focused "get this song's chart" sheet, opened from a setlist row: search links prefilled with
 * the song, paste a chart straight into it, or attach a tab file.
 */
export function FindChartSheet({ song, r, setlistId, onClose }: { song: Song; r: Readiness; setlistId: string | null; onClose: () => void }) {
  const { engine, bandId, user } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const from = setlistId ? `&from=setlist:${setlistId}` : ''
  // Remember the song while the user is on a chord site, so a share / bookmarklet back lands on it.
  const remember = () => setPendingImport({ userId: user.id, bandId, songId: song.id, setlistId })
  const hasChart = r.chords > 0

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="card w-full md:max-w-lg max-h-[85vh] overflow-auto p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label={`Chart for ${song.title}`}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold truncate">{song.title || 'Untitled'}</h2>
            <p className="text-xs text-mute truncate">{song.artist || 'No artist'}</p>
          </div>
          <ChartBadge r={r} />
          <button className="btn-ghost text-xs" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {hasChart && <Link className="btn-primary" to={`/songs/${song.id}`}>View chart</Link>}
        <div className="grid grid-cols-2 gap-2">
          {finderLinks(song.title, song.artist).map((l) => (
            <a key={l.id} href={l.href} target="_blank" rel="noreferrer" onClick={remember} className="btn !justify-start flex-col !items-start !gap-0">
              <span>{l.label} ↗</span>
              <span className="text-[11px] text-mute font-normal">{l.what}</span>
            </a>
          ))}
        </div>
        <p className="text-[11px] text-mute">Copy the chart on the site, come back and tap <b>Paste chart</b>. Or use Share → Setlist / the Send to Setlist bookmark.</p>
        <div className="flex flex-wrap gap-2">
          <Link className={hasChart ? 'btn' : 'btn-primary'} to={`/import?song=${song.id}${from}`}>Paste chart</Link>
          <button className="btn" onClick={() => input.current?.click()}>Import TAB</button>
          <input ref={input} type="file" hidden accept={FILE_ACCEPT}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSongFile(engine, bandId, song.id, f); e.target.value = '' }} />
        </div>
      </div>
    </div>
  )
}
