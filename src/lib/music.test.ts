import { describe, expect, it } from 'vitest'
import { appendChart, chordsUsed, parseChordPro, replaceChart, songNotation, transposeChordPro } from './chordpro'
import { chordsOverLyricsToChordPro, isChordLine, looksLikeChordPro, mergeChordLine } from './chordsOverLyrics'
import { csvToSongs } from './csv'
import { decodeText, guessFromFile, guessFromText, isSameSong, parseHeader, prepareSong, toChordPro } from './importer'
import { compareOrdered, planMove, positionFor, sortOrdered } from './ordering'
import { addToClock, formatDuration, parseDuration, setlistTotals } from './time'
import { convertChordNotation, detectNotation, isChord, semitonesBetween, transposeChord, transposeKey } from './transpose'

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
  it('converts between notations without changing pitch', () => {
    expect(convertChordNotation('B7', 'standard', 'h')).toBe('H7')
    expect(convertChordNotation('Bbm', 'standard', 'h')).toBe('Bm')
    expect(convertChordNotation('G/B', 'standard', 'h')).toBe('G/H')
    expect(convertChordNotation('H7', 'h', 'standard')).toBe('B7')
    expect(convertChordNotation('B', 'h', 'standard')).toBe('Bb')
    expect(convertChordNotation('Bb', 'h', 'standard')).toBe('Bb')
  })
  it('appends a chart in the song\'s own notation', () => {
    // H fragment into a standard song with a B-natural chord: fragment converted, song stays standard
    expect(appendChart({ lyrics_chordpro: '[B]one', chord_notation: 'standard' }, '[H7]two [B]three'))
      .toEqual({ lyrics_chordpro: '[B]one\n\n[B7]two [Bb]three', chord_notation: 'standard' })
    // standard fragment into an H song: B natural becomes H
    expect(appendChart({ lyrics_chordpro: '[H]one', chord_notation: 'h' }, '[B]two [E]x'))
      .toEqual({ lyrics_chordpro: '[H]one\n\n[H]two [E]x', chord_notation: 'h' })
    // a song without chords adopts the fragment's notation
    expect(appendChart({ lyrics_chordpro: '', chord_notation: 'standard' }, '[H7]x'))
      .toEqual({ lyrics_chordpro: '[H7]x', chord_notation: 'h' })
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

describe('text import', () => {
  it('converts a sheet with [Chorus] labels instead of treating it as ChordPro', () => {
    expect(looksLikeChordPro('[Chorus]\nAm   G\nLa la')).toBe(false)
    const cp = toChordPro('[Verse]\nAm      G\nTeksts te\n\n[Chorus]\nC    F\nLa la la')
    expect(cp).toContain('{comment: Verse}')
    expect(cp).toContain('[Am]Teksts t[G]e')
    expect(cp).toContain('{start_of_chorus: Chorus}')
    expect(cp).toContain('[C]La la[F] la')
  })
  it('recognises Latvian section names', () => {
    const cp = toChordPro('Piedziedājums:\nEm   H7\nSaule')
    expect(cp).toContain('{start_of_chorus: Piedziedājums}')
  })
  it('treats [H7] as an inline ChordPro chord', () => {
    expect(looksLikeChordPro('[Em]Saule, [H7]Pērkons')).toBe(true)
    const p = prepareSong({ text: '[Em]Saule, [H7]Pērkons' })
    expect(p.chordpro).toBe('[Em]Saule, [H7]Pērkons')
    expect(p.notation).toBe('h')
    expect(transposeChordPro(p.chordpro, 2, false, 'h')).toContain('[C#7]')
  })
  it('decodes Notepad encodings without losing Latvian letters', () => {
    const lv = 'āēīūčšžņļķģ ĀĒĪŪČŠŽŅĻĶĢ'
    const utf8 = new TextEncoder().encode(lv)
    expect(decodeText(utf8)).toBe(lv)
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe(lv)
    const le = new Uint8Array(2 + lv.length * 2); le.set([0xff, 0xfe])
    const be = new Uint8Array(2 + lv.length * 2); be.set([0xfe, 0xff])
    for (let i = 0; i < lv.length; i++) {
      const c = lv.charCodeAt(i)
      le[2 + i * 2] = c & 0xff; le[3 + i * 2] = c >> 8
      be[2 + i * 2] = c >> 8; be[3 + i * 2] = c & 0xff
    }
    expect(decodeText(le)).toBe(lv)
    expect(decodeText(be)).toBe(lv)
    // Windows-1257 ("ANSI" on Latvian Windows)
    const cp1257 = new Uint8Array([0xe2, 0xe7, 0xee, 0xfb, 0xe8, 0xf0, 0xfe, 0xf2, 0xef, 0xed, 0xec])
    expect(decodeText(cp1257)).toBe('āēīūčšžņļķģ')
    expect(decodeText(new TextEncoder().encode('a\r\nb'))).toBe('a\nb')
    expect(() => decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0x14, 0]))).toThrow()
  })
  it('reads optional header lines only at the top', () => {
    const h = parseHeader('Key: Am\nBPM: 120\n\nAm   G\nBPM: 90 is a lyric here')
    expect(h).toMatchObject({ key: 'Am', bpm: 120, body: '\nAm   G\nBPM: 90 is a lyric here' })
    expect(parseHeader('Tonalitāte: H\nTemps: 96\nTeksts').key).toBe('H')
    // Invalid BPM stops parsing and nothing is removed
    expect(parseHeader('BPM: 9000\nTeksts')).toMatchObject({ bpm: null, body: 'BPM: 9000\nTeksts' })
    expect(parseHeader('Key: Hello\nTeksts')).toMatchObject({ key: '', body: 'Key: Hello\nTeksts' })
    // Chord columns are untouched
    expect(parseHeader('BPM: 100\n   Am     G\nTe  ksts').body).toBe('   Am     G\nTe  ksts')
  })
  it('takes artist and title from the file name', () => {
    expect(guessFromFile('Prāta Vētra - Tu jau esi.txt')).toEqual({ artist: 'Prāta Vētra', title: 'Tu jau esi' })
    expect(guessFromFile('Ziemeļmeita.TXT')).toEqual({ artist: '', title: 'Ziemeļmeita' })
    expect(prepareSong({ name: 'Jumprava – Ziemeļmeita.txt', text: 'Key: Em\nEm   H7\nSaule' })).toMatchObject({ artist: 'Jumprava', title: 'Ziemeļmeita', key: 'Em', notation: 'h', chordpro: '[Em]Saule[H7]' })
  })
  it('takes artist and title from an "Artist – Song" first line of pasted text', () => {
    expect(guessFromText('Jumprava – Ziemeļmeita\nAm   G\nTeksts')).toEqual({ artist: 'Jumprava', title: 'Ziemeļmeita', text: 'Am   G\nTeksts' })
    expect(guessFromText('Am   G\nTeksts')).toEqual({ title: '', artist: '', text: 'Am   G\nTeksts' })
    expect(toChordPro('Am   G\nTeksts te')).toBe('[Am]Tekst[G]s te')
  })
  it("keeps the stored key's pitch when a replacement chart changes notation", () => {
    expect(replaceChart({ lyrics_chordpro: '[B]x', chord_notation: 'standard', key: 'B' }, '[H7]y')).toEqual({ lyrics_chordpro: '[H7]y', chord_notation: 'h', key: 'H' })
    expect(replaceChart({ lyrics_chordpro: '[H]x', chord_notation: 'h', key: 'B' }, '[Bb]y')).toMatchObject({ chord_notation: 'standard', key: 'Bb' })
    expect(replaceChart({ lyrics_chordpro: '', chord_notation: 'standard', key: '' }, '[Am]y').key).toBe('')
  })
  it('detects duplicates by normalised title and artist', () => {
    expect(isSameSong({ title: 'Tu jau esi', artist: 'Prāta Vētra' }, { title: '  tu  JAU esi ', artist: 'prāta vētra' })).toBe(true)
    expect(isSameSong({ title: 'Tu jau esi', artist: '' }, { title: 'Tu jau esi', artist: 'Prāta Vētra' })).toBe(true)
    expect(isSameSong({ title: 'Tu jau esi', artist: 'A' }, { title: 'Tu jau esi', artist: 'B' })).toBe(false)
    expect(isSameSong({ title: 'Tu jau esi'.normalize('NFD'), artist: '' }, { title: 'Tu jau esi', artist: '' })).toBe(true)
  })
})
