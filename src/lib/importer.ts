import { chordsOverLyricsToChordPro, isChordLine, looksLikeChordPro } from './chordsOverLyrics'

/** Pasted/shared text → ChordPro (already-ChordPro text is kept as is). */
export function toChordPro(text: string): string {
  return looksLikeChordPro(text) ? text.normalize('NFC') : chordsOverLyricsToChordPro(text)
}

export interface ImportGuess {
  title: string
  artist: string
  url: string
  text: string
}

const URL_RE = /https?:\/\/[^\s<>"]+/
const SITE_SUFFIX = /\s*(?:[|@–—]|\s-\s)\s*(?:akordi\.lv|ultimate[- ]guitar(?:\.com)?|songsterr(?:\.com)?|chordify(?:\.net)?|e-chords(?:\.com)?)\b.*$/i
const NOISE = /\s*\b(?:chords?|akordi|tabs?|tablat(?:ure|ūra)|lyrics|vārdi|guitar|ģitāra|ver(?:sion)?\s*\d+|\(ver \d+\))\b\s*/gi

/**
 * Best guess at title/artist/source from what a share, bookmarklet or clipboard gave us.
 * Always shown to the user for correction before saving.
 */
export function guessImport(input: { title?: string | null; text?: string | null; url?: string | null }): ImportGuess {
  let text = (input.text ?? '').normalize('NFC').replace(/\r\n?/g, '\n')
  let url = input.url?.trim() ?? ''
  // Android often appends the page URL to shared text.
  const inText = URL_RE.exec(text)
  if (!url && inText) url = inText[0]
  if (url) text = text.split('\n').filter((l) => l.trim() !== url).join('\n')

  let rawTitle = (input.title ?? '').normalize('NFC').trim()
  if (!rawTitle || rawTitle === url) {
    // Use a leading non-chord line ("Song – Artist") as the title.
    const lines = text.split('\n')
    const first = lines.findIndex((l) => l.trim())
    if (first >= 0 && lines[first].trim().length <= 80 && !isChordLine(lines[first]) && /\s[-–—]\s|chords|akordi/i.test(lines[first])) {
      rawTitle = lines[first].trim()
      text = lines.slice(first + 1).join('\n')
    }
  }

  let title = rawTitle.replace(SITE_SUFFIX, '').trim()
  let artist = ''
  const by = /^(.*?)\s+(?:chords|tabs?|akordi)\s+(?:by|-)\s+(.+)$/i.exec(title)
  if (by) {
    title = by[1]
    artist = by[2]
  } else {
    const parts = title.split(/\s[-–—]\s/)
    if (parts.length >= 2) {
      // "Artist – Song" is the usual convention on chord sites.
      artist = parts[0]
      title = parts.slice(1).join(' - ')
    }
  }
  const clean = (s: string) => s.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').trim()
  return { title: clean(title), artist: clean(artist), url, text: text.replace(/^\n+|\s+$/g, '') }
}

/** Read the system clipboard (needs a tap; iOS shows a "Paste" confirmation). */
export async function readClipboard(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

/**
 * "Send to Setlist" bookmarklet: takes the selection, else the biggest <pre> (where chord sites
 * keep the chart), else the page text, and opens this app's import screen with it.
 */
export function bookmarkletCode(appUrl: string): string {
  const js = `(()=>{const a=${JSON.stringify(appUrl)};let t=String(getSelection()||'');if(!t.trim()){const p=[...document.querySelectorAll('pre')].sort((x,y)=>y.innerText.length-x.innerText.length)[0];t=p?p.innerText:document.body.innerText}window.open(a+'#/import?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(t.slice(0,15000)),'_blank')})()`
  return `javascript:${encodeURIComponent(js)}`
}
