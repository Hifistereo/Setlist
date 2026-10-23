import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../state/app'
import { Layout } from '../components/Layout'
import { ChordProView } from '../components/ChordProView'
import { Conflicts } from '../components/Conflicts'
import { chordsOverLyricsToChordPro, looksLikeChordPro } from '../lib/chordsOverLyrics'
import { formatDuration, parseDuration } from '../lib/time'
import { ALL_KEYS, ALL_KEYS_H, detectNotation, type Notation } from '../lib/transpose'
import { chordsUsed } from '../lib/chordpro'
import { emptyRow, type Fields, type Song } from '../lib/types'

interface Form {
  title: string
  artist: string
  key: string
  bpm: string
  time_sig: string
  duration: string
  tags: string
  arrangement: string
  lyrics_chordpro: string
  chord_notation: Notation
}

const toForm = (s: Song): Form => ({
  title: s.title, artist: s.artist, key: s.key, bpm: s.bpm ? String(s.bpm) : '', time_sig: s.time_sig,
  duration: s.duration_sec ? formatDuration(s.duration_sec) : '', tags: s.tags.join(', '),
  arrangement: s.arrangement, lyrics_chordpro: s.lyrics_chordpro, chord_notation: s.chord_notation ?? 'standard',
})

/** Only changed fields are sent, so concurrent edits to other fields never conflict. */
function diff(orig: Song, f: Form): Fields<'songs'> {
  const next: Fields<'songs'> = {
    title: f.title.trim(), artist: f.artist.trim(), key: f.key.trim(), bpm: parseInt(f.bpm) || null,
    time_sig: f.time_sig.trim() || '4/4', duration_sec: parseDuration(f.duration),
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), arrangement: f.arrangement, lyrics_chordpro: f.lyrics_chordpro,
    chord_notation: f.chord_notation,
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(next)) {
    const before = k === 'chord_notation' ? orig.chord_notation ?? 'standard' : orig[k as keyof Song]
    if (JSON.stringify(v) !== JSON.stringify(before)) out[k] = v
  }
  return out as Fields<'songs'>
}

const convertPaste = (text: string) => (looksLikeChordPro(text) ? text.normalize('NFC') : chordsOverLyricsToChordPro(text))

export function SongEdit() {
  const { id } = useParams()
  const isNew = !id
  const { db, engine, bandId } = useApp()
  const nav = useNavigate()
  const [orig, setOrig] = useState<Song | null>(isNew ? emptyRow('songs', '', bandId) : null)
  const [form, setForm] = useState<Form | null>(isNew ? toForm(emptyRow('songs', '', bandId)) : null)
  const [paste, setPaste] = useState<string | null>(null)
  const [undo, setUndo] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    if (isNew) return
    void db.songs.get(id!).then((s) => { if (s) { setOrig(s); setForm(toForm(s)) } })
  }, [db, id, isNew])

  if (!form || !orig) return <Layout title="Edit song"><p className="text-mute">Loading…</p></Layout>
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return alert('Title is required')
    const changes = diff(orig, form)
    const songId = Object.keys(changes).length || isNew ? await engine.mutate('songs', isNew ? null : orig.id, changes) : orig.id
    nav(`/songs/${songId}`, { replace: true })
  }

  const remove = async () => {
    if (!confirm(`Delete “${orig.title}”? It can be restored from Songs → Deleted.`)) return
    await engine.remove('songs', orig.id)
    nav('/songs', { replace: true })
  }

  const applyPaste = () => {
    if (paste == null) return
    setUndo(form.lyrics_chordpro)
    const converted = convertPaste(paste)
    const lyrics = form.lyrics_chordpro.trim() ? `${form.lyrics_chordpro.trimEnd()}\n\n${converted}` : converted
    // A sheet with H chords is in H notation (H = B, B = B flat); switch the song so transposing stays correct.
    const notation = detectNotation(chordsUsed(converted)) === 'h' ? 'h' : form.chord_notation
    setForm({ ...form, lyrics_chordpro: lyrics, chord_notation: notation })
    setPaste(null)
  }

  return (
    <Layout title={isNew ? 'New song' : `Edit · ${orig.title}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        {!isNew && <Conflicts recordId={orig.id} />}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="col-span-2"><span className="label">Title</span><input className="field" required value={form.title} onChange={set('title')} autoFocus={isNew} /></label>
          <label className="col-span-2"><span className="label">Artist</span><input className="field" value={form.artist} onChange={set('artist')} /></label>
          <label><span className="label">Key</span>
            <input className="field" list="keys" value={form.key} onChange={set('key')} placeholder="E, F#m…" />
            <datalist id="keys">{(form.chord_notation === 'h' ? ALL_KEYS_H : ALL_KEYS).map((k) => <option key={k} value={k} />)}</datalist>
          </label>
          <label><span className="label">BPM</span><input className="field" inputMode="numeric" value={form.bpm} onChange={set('bpm')} /></label>
          <label><span className="label">Time signature</span><input className="field" value={form.time_sig} onChange={set('time_sig')} /></label>
          <label><span className="label">Duration (m:ss)</span><input className="field" value={form.duration} onChange={set('duration')} placeholder="3:45" /></label>
          <label className="col-span-2 md:col-span-4"><span className="label">Chord names</span>
            <select className="field" value={form.chord_notation} onChange={set('chord_notation')}>
              <option value="standard">Standard — B, Bb (B♭)</option>
              <option value="h">H notation — H, B (B♭) · Latvian / German charts</option>
            </select>
          </label>
          <label className="col-span-2 md:col-span-4"><span className="label">Tags (comma-separated)</span><input className="field" value={form.tags} onChange={set('tags')} placeholder="rock, dance, opener" /></label>
          <label className="col-span-2 md:col-span-4"><span className="label">Arrangement / structure</span>
            <input className="field" value={form.arrangement} onChange={set('arrangement')} placeholder="Intro · V1 · C · V2 · C · Solo · C ×2 · Outro" /></label>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label !mb-0 flex-1">Lyrics &amp; chords (ChordPro: <code>[Am]word</code>, <code>{'{soc}'}</code>…<code>{'{eoc}'}</code> chorus, <code>{'{c: Solo}'}</code>)</span>
            <button type="button" className="btn text-xs" onClick={() => setPaste('')}>Paste chord sheet</button>
            {undo !== null && <button type="button" className="btn text-xs" onClick={() => { setForm({ ...form, lyrics_chordpro: undo }); setUndo(null) }}>Undo convert</button>}
            <button type="button" className={preview ? 'btn-primary text-xs' : 'btn text-xs'} onClick={() => setPreview(!preview)}>Preview</button>
          </div>
          {paste !== null && (
            <div className="card p-3 flex flex-col gap-2">
              <p className="text-xs text-mute">Paste chords-over-lyrics text. Check the converted preview — this format is ambiguous. You can undo after applying.</p>
              <div className="grid md:grid-cols-2 gap-2">
                <textarea className="field font-mono text-xs min-h-56" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'G         D\nHere comes the sun…'} autoFocus />
                <div className="rounded-lg bg-panel2 p-2 overflow-auto max-h-80">
                  <ChordProView src={convertPaste(paste)} fontSize={14} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" onClick={applyPaste} disabled={!paste.trim()}>Convert &amp; insert</button>
                <button type="button" className="btn" onClick={() => setPaste(null)}>Cancel</button>
              </div>
            </div>
          )}
          <div className={preview ? 'grid md:grid-cols-2 gap-3' : ''}>
            <textarea className="field font-mono text-sm min-h-80 w-full" spellCheck={false} value={form.lyrics_chordpro} onChange={set('lyrics_chordpro')} aria-label="Lyrics and chords" />
            {preview && <div className="card p-3 overflow-auto max-h-[32rem]"><ChordProView src={form.lyrics_chordpro} fontSize={15} /></div>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 sticky bottom-20 bg-bg/90 py-2">
          <button className="btn-primary">Save</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
          <div className="flex-1" />
          {!isNew && <button type="button" className="btn-danger" onClick={remove}>Delete</button>}
        </div>
      </form>
    </Layout>
  )
}
