import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { Layout } from '../components/Layout'
import { ChordProView } from '../components/ChordProView'
import { Metronome } from '../components/Metronome'
import { SongFiles } from '../components/SongFiles'
import { Conflicts } from '../components/Conflicts'
import { formatDuration } from '../lib/time'
import { prefersFlats, transposeKey } from '../lib/transpose'
import { songNotation } from '../lib/chordpro'
import { finderLinks } from '../lib/finder'
import { noteId } from '../lib/ids'
import type { Song as SongT, SongLink } from '../lib/types'

export function useFontSize() {
  const [size, setSize] = useState(() => {
    try { return +(localStorage.getItem('setlist.font') ?? 18) || 18 } catch { return 18 }
  })
  useEffect(() => { try { localStorage.setItem('setlist.font', String(size)) } catch { /* ignore */ } }, [size])
  return [size, setSize] as const
}

export function Song() {
  const { id } = useParams()
  const { db } = useApp()
  const nav = useNavigate()
  const song = useLiveQuery(async () => (await db.songs.get(id!)) ?? null, [db, id])
  const [transpose, setTranspose] = useState(0)
  const [font, setFont] = useFontSize()

  if (song === undefined) return <Layout title="Song"><p className="text-mute">Loading…</p></Layout>
  if (song === null) return <Layout title="Song"><p className="text-mute">Song not found on this device. <Link className="text-accent" to="/songs">Back to songs</Link></p></Layout>
  const notation = songNotation(song)
  const key = transposeKey(song.key, transpose, notation)

  return (
    <Layout title={song.title || 'Untitled'} actions={<Link className="btn" to={`/songs/${song.id}/edit`}>Edit</Link>}>
      <div className="flex flex-col gap-4">
        {song.deleted_at && <div className="card p-3 text-sm text-warn">This song is deleted.</div>}
        <Conflicts recordId={song.id} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-mute">{song.artist}</span>
          {song.key && <span className="chip !text-accent font-semibold">Key {key}{transpose ? ` (orig. ${song.key})` : ''}</span>}
          <span className="chip">{song.time_sig}</span>
          <span className="chip">{formatDuration(song.duration_sec)}</span>
          {song.tags.map((t) => <span key={t} className="chip">{t}</span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="flex items-center gap-1" role="group" aria-label="Transpose">
            <button className="btn !px-2.5" onClick={() => setTranspose(transpose - 1)} aria-label="Transpose down">−</button>
            <span className="text-xs text-mute w-16 text-center">{transpose > 0 ? `+${transpose}` : transpose} st</span>
            <button className="btn !px-2.5" onClick={() => setTranspose(transpose + 1)} aria-label="Transpose up">+</button>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Text size">
            <button className="btn !px-2.5" onClick={() => setFont(Math.max(12, font - 2))}>A−</button>
            <button className="btn !px-2.5" onClick={() => setFont(Math.min(40, font + 2))}>A+</button>
          </div>
          <Metronome bpm={song.bpm} timeSig={song.time_sig} />
          <button className="btn" onClick={() => nav(`/stage/song/${song.id}`)}>Stage view</button>
        </div>
        {song.arrangement && <div className="card p-3 text-sm"><span className="text-mute text-xs block mb-1">Arrangement</span>{song.arrangement}</div>}
        <MyNote songId={song.id} />
        <div className="card p-4"><ChordProView src={song.lyrics_chordpro} transpose={transpose} preferFlats={prefersFlats(key, notation)} notation={notation} fontSize={font} /></div>
        <SongFiles songId={song.id} />
        <Finder song={song} />
      </div>
    </Layout>
  )
}

function MyNote({ songId }: { songId: string }) {
  const { db, engine, user } = useApp()
  const note = useLiveQuery(() => db.song_notes.where('song_id').equals(songId).filter((n) => !n.user_id || n.user_id === user.id).first(), [db, songId, user.id])
  const [text, setText] = useState<string | null>(null)
  const value = text ?? note?.note ?? ''
  const save = async () => {
    if (text === null || text === (note?.note ?? '')) return
    await engine.mutate('song_notes', note?.id ?? (await noteId(songId, user.id)), note ? { note: text } : { song_id: songId, note: text })
    setText(null)
  }
  return (
    <label className="card p-3 block">
      <span className="text-xs text-mute">My private note <span className="opacity-60">(only you see this)</span></span>
      <textarea className="w-full bg-transparent border-0 resize-y text-sm mt-1 min-h-10 focus:outline-none" rows={Math.min(6, Math.max(1, value.split('\n').length))}
        placeholder="Capo, effects, cues, reminders…" value={value} onChange={(e) => setText(e.target.value)} onBlur={save} />
    </label>
  )
}

function Finder({ song }: { song: SongT }) {
  const { engine } = useApp()
  const links = finderLinks(song.title, song.artist)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const save = (next: SongLink[]) => engine.mutate('songs', song.id, { links: next })
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^https?:\/\//i.test(url.trim())) return alert('Enter a full link starting with https://')
    void save([...song.links, { label: label.trim() || new URL(url.trim()).hostname, url: url.trim() }])
    setLabel(''); setUrl('')
  }
  return (
    <section className="card p-4 flex flex-col gap-3 no-print">
      <h2 className="font-semibold">Find chords, tabs &amp; recordings</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {links.map((l) => (
          <a key={l.id} href={l.href} target="_blank" rel="noreferrer" className="btn !justify-start flex-col !items-start !gap-0">
            <span>{l.label} ↗</span>
            <span className="text-[11px] text-mute font-normal">{l.what}</span>
          </a>
        ))}
      </div>
      <p className="text-[11px] text-mute">Found a chord sheet? Copy it, then use <b>Edit → Paste chord sheet</b> to convert it. Downloaded a Guitar Pro file? Import it under Tabs.</p>
      {song.links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {song.links.map((l, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <a href={l.url} target="_blank" rel="noreferrer" className="text-accent truncate flex-1">{l.label} ↗</a>
              <button className="btn-ghost text-xs" onClick={() => save(song.links.filter((_, j) => j !== i))} aria-label={`Remove ${l.label}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input className="field !w-32 flex-none" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="field flex-1 min-w-40" placeholder="Save a link (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn">Save link</button>
      </form>
    </section>
  )
}
