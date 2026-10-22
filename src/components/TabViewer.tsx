import { useEffect, useRef, useState } from 'react'
import * as alphaTab from '@coderline/alphatab'
import { BASE } from '../lib/config'

export type TabSource = { kind: 'tex'; tex: string } | { kind: 'bytes'; data: ArrayBuffer }

interface Props {
  source: TabSource
  /** Hide the player (e.g. editor preview) */
  playerless?: boolean
  scale?: number
  onError?: (msg: string | null) => void
}

const SPEEDS = [0.5, 0.6, 0.75, 0.9, 1, 1.25]

/**
 * Guitar Pro / MusicXML / alphaTex renderer + player. Works offline: the worker, worklet,
 * Bravura font and SoundFont are bundled and precached by the service worker.
 */
export function TabViewer({ source, playerless, scale = 0.9, onError }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const api = useRef<alphaTab.AlphaTabApi | null>(null)
  const [tracks, setTracks] = useState<alphaTab.model.Track[]>([])
  const [track, setTrack] = useState(0)
  const [ready, setReady] = useState(false)
  const [loadPct, setLoadPct] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [hasRange, setHasRange] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!host.current) return
    const a = new alphaTab.AlphaTabApi(host.current, {
      core: { fontDirectory: `${BASE}font/`, engine: 'svg' },
      display: { scale, layoutMode: alphaTab.LayoutMode.Page, staveProfile: alphaTab.StaveProfile.Default },
      player: {
        enablePlayer: !playerless,
        playerMode: playerless ? alphaTab.PlayerMode.Disabled : alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: `${BASE}soundfont/sonivox.sf2`,
        scrollElement: scroller.current ?? undefined,
        enableCursor: true,
        enableUserInteraction: true,
      },
    } as alphaTab.json.SettingsJson)
    api.current = a
    a.scoreLoaded.on((score) => {
      setTracks(score.tracks)
      setError(null)
      onErrorRef.current?.(null)
    })
    a.error.on((e) => {
      const msg = e?.message ?? String(e)
      setError(msg)
      onErrorRef.current?.(msg)
    })
    a.soundFontLoad.on((e) => setLoadPct(Math.round((e.loaded / Math.max(1, e.total)) * 100)))
    a.playerReady.on(() => setReady(true))
    a.playerStateChanged.on((e) => setPlaying(e.state === alphaTab.synth.PlayerState.Playing))
    a.playbackRangeHighlightChanged.on((e) => {
      setHasRange(!!e.startBeat)
      if (e.startBeat) a.applyPlaybackRangeFromHighlight()
    })
    return () => {
      a.destroy()
      api.current = null
    }
  }, [playerless, scale])

  useEffect(() => {
    const a = api.current
    if (!a) return
    try {
      if (source.kind === 'tex') a.tex(source.tex)
      else a.load(new Uint8Array(source.data))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      onErrorRef.current?.(msg)
    }
    setTrack(0)
  }, [source, playerless, scale])

  const pickTrack = (i: number) => {
    setTrack(i)
    const t = tracks[i]
    if (t && api.current) api.current.renderTracks([t])
  }

  const apply = (fn: (a: alphaTab.AlphaTabApi) => void) => api.current && fn(api.current)

  return (
    <div className="flex flex-col gap-2">
      {!playerless && (
        <div className="flex flex-wrap items-center gap-2 no-print">
          <button className="btn-primary min-w-20" disabled={!ready} onClick={() => apply((a) => a.playPause())}>
            {!ready ? `Loading ${loadPct}%` : playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button className="btn" disabled={!ready} onClick={() => apply((a) => a.stop())}>■</button>
          <label className="flex items-center gap-1 text-xs text-mute">
            Speed
            <select className="field !w-auto !py-1" value={speed}
              onChange={(e) => { const v = +e.target.value; setSpeed(v); apply((a) => { a.playbackSpeed = v }) }}>
              {SPEEDS.map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
            </select>
          </label>
          <button className={loop ? 'btn-primary' : 'btn'} title="Loop the selected bars (drag across the notation to select)"
            onClick={() => { const v = !loop; setLoop(v); apply((a) => { a.isLooping = v }) }}>
            ⟲ Loop{hasRange ? ' selection' : ''}
          </button>
          {hasRange && (
            <button className="btn-ghost text-xs" onClick={() => apply((a) => { a.clearPlaybackRangeHighlight(); a.playbackRange = null })}>
              Clear selection
            </button>
          )}
          <button className={metronome ? 'btn-primary' : 'btn'}
            onClick={() => { const v = !metronome; setMetronome(v); apply((a) => { a.metronomeVolume = v ? 1 : 0 }) }}>
            Click
          </button>
          <button className={countIn ? 'btn-primary' : 'btn'}
            onClick={() => { const v = !countIn; setCountIn(v); apply((a) => { a.countInVolume = v ? 1 : 0 }) }}>
            Count-in
          </button>
          {tracks.length > 1 && (
            <select className="field !w-auto !py-1" value={track} onChange={(e) => pickTrack(+e.target.value)}>
              {tracks.map((t, i) => <option key={i} value={i}>{t.name || `Track ${i + 1}`}</option>)}
            </select>
          )}
        </div>
      )}
      {error && <p className="text-bad text-sm">Could not read this tab: {error}</p>}
      <div ref={scroller} className="overflow-auto max-h-[70vh] rounded-lg bg-white">
        <div ref={host} className="text-black" />
      </div>
    </div>
  )
}
