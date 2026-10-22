import { useEffect, useRef, useState } from 'react'

interface Props {
  bpm: number | null
  timeSig?: string
  compact?: boolean
}

/** Visual + optional audible click, scheduled on the Web Audio clock so it stays steady. */
export function Metronome({ bpm, timeSig = '4/4', compact }: Props) {
  const beats = Math.max(1, parseInt(timeSig) || 4)
  const [on, setOn] = useState(false)
  const [sound, setSound] = useState(false)
  const [beat, setBeat] = useState(-1)
  const ctx = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!on || !bpm) { setBeat(-1); return }
    const interval = 60 / bpm
    let ac: AudioContext | null = null
    if (sound) {
      ac = ctx.current ?? new AudioContext()
      ctx.current = ac
      void ac.resume()
    }
    const start = ac ? ac.currentTime + 0.05 : performance.now() / 1000
    let n = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const now = ac ? ac.currentTime : performance.now() / 1000
      while (start + n * interval < now + 0.1) {
        const at = start + n * interval
        const idx = n % beats
        if (ac) {
          const osc = ac.createOscillator()
          const gain = ac.createGain()
          osc.frequency.value = idx === 0 ? 1500 : 1000
          gain.gain.setValueAtTime(0.6, at)
          gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
          osc.connect(gain).connect(ac.destination)
          osc.start(at)
          osc.stop(at + 0.06)
        }
        const delay = Math.max(0, (at - now) * 1000)
        setTimeout(() => setBeat(idx), delay)
        n++
      }
      timer = setTimeout(tick, 25)
    }
    tick()
    return () => clearTimeout(timer)
  }, [on, sound, bpm, beats])

  if (!bpm) return null
  return (
    <div className="flex items-center gap-2">
      <button className={on ? 'btn-primary' : 'btn'} onClick={() => setOn(!on)} aria-pressed={on} title="Metronome">
        ♩ {bpm}
      </button>
      {on && (
        <>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: beats }, (_, i) => (
              <span key={i} className={`rounded-full transition-colors ${compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} ${
                beat === i ? (i === 0 ? 'bg-accent' : 'bg-ink') : 'bg-line'}`} />
            ))}
          </div>
          <button className={sound ? 'btn-primary !px-2' : 'btn !px-2'} onClick={() => setSound(!sound)} title="Audible click">
            {sound ? '🔊' : '🔈'}
          </button>
        </>
      )}
    </div>
  )
}
