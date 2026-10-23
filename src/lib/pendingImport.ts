/**
 * Which song a chart is being fetched for, while the user is away on a chord site.
 * Stored per user and band with an expiry. It only helps when the chart comes back into the same
 * browser storage (often not true for share sheets or an installed iOS app vs Safari), so the
 * Import screen must still let the user pick, and never guess, when it can't be used.
 */
export interface PendingImport {
  userId: string
  bandId: string
  songId: string
  setlistId: string | null
  expires: number
}

const TTL = 30 * 60_000
const key = (userId: string, bandId: string) => `setlist.pendingImport:${userId}:${bandId}`

export function setPendingImport(p: Omit<PendingImport, 'expires'>, now = Date.now()) {
  try { localStorage.setItem(key(p.userId, p.bandId), JSON.stringify({ ...p, expires: now + TTL })) } catch { /* storage unavailable */ }
}

export function clearPendingImport(userId: string, bandId: string) {
  try { localStorage.removeItem(key(userId, bandId)) } catch { /* ignore */ }
}

export type PendingResult = { ok: true; value: PendingImport } | { ok: false; reason: 'none' | 'expired' | 'other-account' | 'song-gone' }

/**
 * The stored context, if it is still valid for this user, band and song.
 * `songExists` must say whether this device has the song and it isn't deleted.
 */
export function readPendingImport(userId: string, bandId: string, songExists: (id: string) => boolean, now = Date.now()): PendingResult {
  let p: PendingImport | null = null
  try { p = JSON.parse(localStorage.getItem(key(userId, bandId)) ?? 'null') } catch { p = null }
  if (!p || typeof p.songId !== 'string') return { ok: false, reason: 'none' }
  if (p.userId !== userId || p.bandId !== bandId) return { ok: false, reason: 'other-account' }
  if (!(p.expires > now)) return { ok: false, reason: 'expired' }
  if (!songExists(p.songId)) return { ok: false, reason: 'song-gone' }
  return { ok: true, value: p }
}
