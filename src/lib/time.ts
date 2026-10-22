export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '–'
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** "3:45", "225", "1:02:03", "4m" → seconds; null when empty/invalid. */
export function parseDuration(input: string): number | null {
  const t = input.trim()
  if (!t) return null
  if (/^\d+m$/i.test(t)) return parseInt(t) * 60
  if (/^\d+$/.test(t)) return parseInt(t)
  const parts = t.split(':').map((p) => p.trim())
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + parseInt(p), 0)
}

export interface TimedItem {
  type: 'song' | 'break' | 'section'
  duration: number | null
}

export interface SetTotals {
  sets: { index: number; songs: number; seconds: number }[]
  songs: number
  music: number
  breaks: number
  total: number
  unknown: number
}

/** Sections start a new set; breaks count toward total but not music time. */
export function setlistTotals(items: TimedItem[]): SetTotals {
  const sets: SetTotals['sets'] = []
  let cur = { index: 1, songs: 0, seconds: 0 }
  let music = 0, breaks = 0, songs = 0, unknown = 0
  for (const it of items) {
    if (it.type === 'section') {
      if (cur.songs || cur.seconds) sets.push(cur)
      cur = { index: sets.length + 1, songs: 0, seconds: 0 }
    } else if (it.type === 'break') {
      breaks += it.duration ?? 0
    } else {
      songs++
      cur.songs++
      if (it.duration == null) unknown++
      cur.seconds += it.duration ?? 0
      music += it.duration ?? 0
    }
  }
  if (cur.songs || cur.seconds || !sets.length) sets.push(cur)
  return { sets, songs, music, breaks, total: music + breaks, unknown }
}

/** "21:00" + seconds → "23:15" (wraps past midnight). */
export function addToClock(start: string, seconds: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start.trim())
  if (!m) return null
  const mins = (parseInt(m[1]) * 60 + parseInt(m[2]) + Math.round(seconds / 60)) % (24 * 60)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}
