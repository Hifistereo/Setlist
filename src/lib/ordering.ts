import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

export interface Ordered {
  id: string
  position: string
}

/** Deterministic order on every device: position, then id as tie-breaker. */
export function compareOrdered(a: Ordered, b: Ordered): number {
  if (a.position < b.position) return -1
  if (a.position > b.position) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortOrdered<T extends Ordered>(items: T[]): T[] {
  return [...items].sort(compareOrdered)
}

function safeBetween(a: string | null, b: string | null): string | null {
  try {
    return generateKeyBetween(a, b)
  } catch {
    return null
  }
}

/**
 * Position updates needed to place `movingId` at `toIndex` within `sorted` (which still contains it).
 * Usually one update; if neighbours share a key (concurrent offline inserts) the list is re-keyed.
 */
export function planMove<T extends Ordered>(sorted: T[], movingId: string, toIndex: number): { id: string; position: string }[] {
  const rest = sorted.filter((i) => i.id !== movingId)
  const idx = Math.max(0, Math.min(toIndex, rest.length))
  const before = rest[idx - 1]?.position ?? null
  const after = rest[idx]?.position ?? null
  const key = before !== null && before === after ? null : safeBetween(before, after)
  if (key !== null) return [{ id: movingId, position: key }]
  const order = [...rest.slice(0, idx), { id: movingId } as T, ...rest.slice(idx)]
  const keys = generateNKeysBetween(null, null, order.length)
  return order.map((it, i) => ({ id: it.id, position: keys[i] })).filter((u, i) => u.id === movingId || order[i].position !== u.position)
}

/** Key for appending/inserting a new item at `index` (default: end). */
export function positionFor(sorted: Ordered[], index = sorted.length): { position: string; rekey: { id: string; position: string }[] } {
  const before = sorted[index - 1]?.position ?? null
  const after = sorted[index]?.position ?? null
  const key = before !== null && before === after ? null : safeBetween(before, after)
  if (key !== null) return { position: key, rekey: [] }
  const keys = generateNKeysBetween(null, null, sorted.length + 1)
  const rekey = sorted.map((it, i) => ({ id: it.id, position: keys[i >= index ? i + 1 : i] }))
  return { position: keys[index], rekey }
}
