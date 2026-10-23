import { describe, expect, it } from 'vitest'
import { chordsUsed, parseChordPro, songNotation, transposeChordPro } from './chordpro'
import { chordsOverLyricsToChordPro, isChordLine, mergeChordLine } from './chordsOverLyrics'
import { csvToSongs } from './csv'
import { compareOrdered, planMove, positionFor, sortOrdered } from './ordering'
import { addToClock, formatDuration, parseDuration, setlistTotals } from './time'
import { detectNotation, isChord, semitonesBetween, transposeChord, transposeKey } from './transpose'

describe('transpose', () => {
  it('recognises chords', () => {
    for (const c of ['C', 'Am', 'F#m7', 'Bbmaj7', 'Dsus4', 'G/B', 'C#m7b5', 'E7#9', 'Cadd9', 'A7(b9)']) expect(isChord(c), c).toBe(true)
    for (const w of ['Hello', 'the', 'Am I', 'Cat', 'Go']) expect(isChord(w), w).toBe(false)
  })
  it('transposes chords with slash bass', () => {
    expect(transposeChord('G/B', 2)).toBe('A/C#')
    expect(transposeChord('F#m7', -2)).toBe('Em7')
    expect(transposeChord('C', 3, true)).toBe('Eb')
    expect(transposeChord('Bb', 12)).toBe('Bb')
  })
  it('transposes keys with conventional spelling', () => {
    expect(transposeKey('C', 3)).toBe('Eb')
    expect(transposeKey('E', 2)).toBe('F#')
    expect(transposeKey('Am', 5)).toBe('Dm')
    expect(semitonesBetween('E', 'G')).toBe(3)
    expect(semitonesBetween('E', 'C')).toBe(-4)
  })
})

describe('H notation (Latvian/German charts)', () => {
  it('recognises H chords', () => {
    for (const c of ['H', 'H7', 'Hm', 'Hm7', 'G/H']) expect(isChord(c), c).toBe(true)
    expect(detectNotation(['Am', 'H7', 'Em'])).toBe('h')
    expect(detectNotation(['Am', 'B7', 'Em'])).toBe('standard')
  })
  it('treats B as B flat and H as B natural', () => {
    expect(transposeChord('H7', 1, false, 'h')).toBe('C7')
    expect(transposeChord('B', 1, false, 'h')).toBe('H')
    expect(transposeChord('A', 1, false, 'h')).toBe('B')
    expect(transposeChord('A', 2, false, 'h')).toBe('H')
    expect(transposeChord('Em', 7, false, 'h')).toBe('Hm')
    expect(transposeChord('G/H', 2, false, 'h')).toBe('A/C#')
    // standard notation is unchanged
    expect(transposeChord('A', 2)).toBe('B')
  })
  it('handles keys', () => {
    expect(transposeKey('Em', 7, 'h')).toBe('Hm')
    expect(transposeKey('F', 5, 'h')).toBe('B')
    expect(semitonesBetween('G', 'H', 'h')).toBe(4)
    expect(semitonesBetween('G', 'B', 'h')).toBe(3)
  })
  it('detects notation from a song chart', () => {
    expect(songNotation({ lyrics_chordpro: '[Em]Saule [H7]lec' })).toBe('h')
    expect(songNotation({ lyrics_chordpro: '[Em]x [B7]y' })).toBe('standard')
    expect(songNotation({ chord_notation: 'h', lyrics_chordpro: '[Em]x' })).toBe('h')
    expect(transposeChordPro('[Em]Saule [H7]lec', 2, false, 'h')).toBe('[F#m]Saule [C#7]lec')
  })
  it('converts Latvian chord sheets', () => {
    expect(chordsOverLyricsToChordPro('Em          H7\nSaule, Pērkons, Daugava')).toBe('[Em]Saule, Pērko[H7]ns, Daugava')
  })
  it('keeps chord columns when accents are decomposed (NFD)', () => {
    const nfc = chordsOverLyricsToChordPro('Am           Dm\nPūt, vējiņi, dzen laiviņu')
    const nfd = chordsOverLyricsToChordPro('Am           Dm\nPūt, vējiņi, dzen laiviņu'.normalize('NFD'))
    expect(nfd).toBe(nfc)
    expect(nfc).toBe('[Am]Pūt, vējiņi, [Dm]dzen laiviņu')
  })
  it('does not mistake Latvian words for chords', () => {
    expect(isChordLine('Es tev saku, ka tu esi')).toBe(false)
    expect(isChordLine('Ai, Gaujiņa, ai, ai')).toBe(false)
  })
})

describe('chordpro', () => {
  const src = `{title: Superstition}
{key: Ebm}
{comment: Intro riff}
[Ebm7]Very superstitious, [Ab7]writing's on the wall

{soc}
When you be[Bbm]lieve in things
{eoc}
{sot}
e|---6-4---|
{eot}`
  it('parses meta, sections, segments and tabs', () => {
    const p = parseChordPro(src)
    expect(p.meta).toEqual({ title: 'Superstition', key: 'Ebm' })
    expect(p.lines[0]).toEqual({ kind: 'comment', text: 'Intro riff' })
    expect(p.lines[1]).toEqual({ kind: 'lyrics', segments: [
      { chord: 'Ebm7', lyric: 'Very superstitious, ' }, { chord: 'Ab7', lyric: "writing's on the wall" }] })
    expect(p.lines.find((l) => l.kind === 'tab')).toEqual({ kind: 'tab', text: 'e|---6-4---|' })
    expect(p.lines.filter((l) => l.kind === 'section' && l.type === 'chorus')).toHaveLength(2)
  })
  it('transposes only chords', () => {
    expect(transposeChordPro('[C]Hello [G/B]world\n{title: C}', 2)).toBe('[D]Hello [A/C#]world\n{title: C}')
    expect(chordsUsed('[C]a [G]b [C]c')).toEqual(['C', 'G'])
  })
})

describe('chords over lyrics', () => {
  it('detects chord lines', () => {
    expect(isChordLine('  G      D/F#    Em   C')).toBe(true)
    expect(isChordLine('Go tell it on the mountain')).toBe(false)
    expect(isChordLine('| Am | F | C | G |')).toBe(true)
  })
  it('merges chords at their columns', () => {
    expect(mergeChordLine('G       C', 'Hello my friend')).toBe('[G]Hello my[C] friend')
    expect(mergeChordLine('        D', 'Hi')).toBe('Hi      [D]')
  })
  it('converts a full sheet', () => {
    const sheet = `[Verse 1]
Am             F
Hello darkness my old friend
C       G
I've come to talk

[Chorus]
F            C
And the vision
G
`
    const out = chordsOverLyricsToChordPro(sheet)
    expect(out).toContain('{comment: Verse 1}')
    expect(out).toContain('[Am]Hello darkness [F]my old friend')
    expect(out).toContain('{start_of_chorus: Chorus}')
    expect(out).toContain('[F]And the visio[C]n')
    expect(out).toContain('{end_of_chorus}')
    expect(out).toMatch(/\[G\]\n\{end_of_chorus\}/)
  })
  it('wraps tablature', () => {
    const out = chordsOverLyricsToChordPro('e|-----0-----|\nB|---1---1---|\ntext')
    expect(out).toBe('{start_of_tab}\ne|-----0-----|\nB|---1---1---|\n{end_of_tab}\ntext')
  })
})

describe('time', () => {
  it('formats and parses', () => {
    expect(formatDuration(225)).toBe('3:45')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(parseDuration('3:45')).toBe(225)
    expect(parseDuration('4m')).toBe(240)
    expect(parseDuration('x')).toBe(null)
  })
  it('totals sets and breaks', () => {
    const t = setlistTotals([
      { type: 'song', duration: 200 }, { type: 'song', duration: null },
      { type: 'break', duration: 900 }, { type: 'section', duration: null }, { type: 'song', duration: 100 },
    ])
    expect(t.sets).toEqual([{ index: 1, songs: 2, seconds: 200 }, { index: 2, songs: 1, seconds: 100 }])
    expect(t.total).toBe(1200)
    expect(t.unknown).toBe(1)
    expect(addToClock('23:30', 3600)).toBe('00:30')
  })
})

describe('ordering', () => {
  it('breaks position ties by id', () => {
    const items = [{ id: 'b', position: 'a1' }, { id: 'a', position: 'a1' }, { id: 'c', position: 'a0' }]
    expect(sortOrdered(items).map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(compareOrdered(items[0], items[0])).toBe(0)
  })
  it('moves with a single key update', () => {
    const items = [{ id: 'x', position: 'a0' }, { id: 'y', position: 'a1' }, { id: 'z', position: 'a2' }]
    const plan = planMove(items, 'z', 0)
    expect(plan).toHaveLength(1)
    const after = sortOrdered(items.map((i) => (i.id === 'z' ? { ...i, position: plan[0].position } : i)))
    expect(after.map((i) => i.id)).toEqual(['z', 'x', 'y'])
  })
  it('re-keys when neighbours share a key', () => {
    const items = sortOrdered([{ id: 'a', position: 'a1' }, { id: 'b', position: 'a1' }, { id: 'm', position: 'a2' }])
    const plan = planMove(items, 'm', 1)
    expect(plan.length).toBeGreaterThan(1)
    const map = Object.fromEntries(items.map((i) => [i.id, i.position]))
    for (const u of plan) map[u.id] = u.position
    expect(sortOrdered(Object.entries(map).map(([id, position]) => ({ id, position }))).map((i) => i.id)).toEqual(['a', 'm', 'b'])
  })
  it('appends', () => {
    const items = [{ id: 'x', position: 'a0' }]
    expect(positionFor(items).position > 'a0').toBe(true)
    expect(positionFor([]).position).toBe('a0')
  })
})

describe('csv import', () => {
  it('maps headers and parses quoted cells', () => {
    const songs = csvToSongs('Title,Artist,Key,BPM,Duration,Tags\n"Sweet Child O\' Mine","Guns N\' Roses",D,125,5:56,"rock, 80s"\nValerie,Amy Winehouse,Eb,,3:39,')
    expect(songs).toHaveLength(2)
    expect(songs[0]).toEqual({ title: "Sweet Child O' Mine", artist: "Guns N' Roses", key: 'D', bpm: 125, duration_sec: 356, tags: ['rock', '80s'] })
    expect(songs[1].bpm).toBe(null)
  })
})
