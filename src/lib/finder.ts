/** Link-out search for chords, tabs and recordings. No scraping: those sites own their content. */
export interface FinderSource {
  id: string
  label: string
  what: string
  url: (q: string) => string
}

export const FINDER_SOURCES: FinderSource[] = [
  // Site search via Google works regardless of how akordi.lv structures its own search URLs.
  { id: 'akordi', label: 'akordi.lv', what: 'Latvian songs — chords', url: (q) => `https://www.google.com/search?q=site%3Aakordi.lv%20${q}` },
  { id: 'ug', label: 'Ultimate Guitar', what: 'Chords & tabs', url: (q) => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}` },
  { id: 'songsterr', label: 'Songsterr', what: 'Guitar Pro-style tabs, solos', url: (q) => `https://www.songsterr.com/?pattern=${q}` },
  { id: 'chordify', label: 'Chordify', what: 'Chords detected from audio', url: (q) => `https://chordify.net/search/${q}` },
  { id: 'youtube', label: 'YouTube', what: 'Recording & lessons', url: (q) => `https://www.youtube.com/results?search_query=${q}` },
  { id: 'youtube-lesson', label: 'YouTube lesson', what: 'Solo / guitar lesson', url: (q) => `https://www.youtube.com/results?search_query=${q}%20guitar%20solo%20lesson` },
  { id: 'spotify', label: 'Spotify', what: 'Original recording', url: (q) => `https://open.spotify.com/search/${q}` },
]

export function finderQuery(title: string, artist: string): string {
  return encodeURIComponent([artist, title].map((s) => s.trim()).filter(Boolean).join(' '))
}

export function finderLinks(title: string, artist: string) {
  const q = finderQuery(title, artist)
  return FINDER_SOURCES.map((s) => ({ ...s, href: s.url(q) }))
}
