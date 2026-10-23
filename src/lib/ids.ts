/** A uuid derived from its parts: the same parts always give the same id, on any device. */
export async function derivedId(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join(':'))
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16)
  h[6] = (h[6] & 0x0f) | 0x50 // version 5-style
  h[8] = (h[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Each member has at most one private note per song (unique (song_id, user_id) on the server).
 * Deriving the id from that pair means two offline devices create the *same* record,
 * so the second write merges/conflicts instead of being rejected as a duplicate.
 */
export function noteId(songId: string, userId: string): Promise<string> {
  return derivedId('song-note', songId, userId)
}
