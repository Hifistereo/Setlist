# Setlist

A free, BandHelper-style app for working cover bands. One shared song library and setlists for the whole band, with private notes for each musician, chord charts, Guitar Pro tabs and an offline stage mode. It runs as an installable web app (PWA) on Android, iOS and desktop.

## Features

| | |
|---|---|
| **Song library** | Title, artist, key, BPM, time signature, duration, tags, arrangement. Search, filter and sort. CSV import. Deleted songs can be restored. |
| **Chord charts** | ChordPro with `[Am]` inline chords, chorus blocks and comments. Transpose ±, adjustable text size. |
| **Paste a chord sheet** | Copy chords-over-lyrics from any site. The app converts it to ChordPro, shows a side-by-side preview and lets you undo. |
| **Latvian / H notation** | Charts using H for B and B for B♭ are detected automatically (or set per song), so transposing and key changes stay correct. Accented letters (ā, ē, ņ…) keep chords in the right column. |
| **Import without copy & paste** | Android: select text on akordi.lv or any chord site → Share → Setlist. Any browser (incl. iPhone): a “Send to Setlist” bookmark grabs the selection or the page's chord block. Everywhere: Songs → Import → Paste from clipboard. Title, artist and source link are guessed; you check the preview before saving. |
| **Song finder** | One-tap searches on akordi.lv, Ultimate Guitar, Songsterr, Chordify, YouTube and Spotify, plus saved links for each song. It only links out to those sites and never scrapes them. |
| **Tabs** | Import Guitar Pro (GP3–GP7), MusicXML, PDF or audio. Rendering and playback by [alphaTab](https://alphatab.net), with speed control, looping a selected range, metronome, count-in and track selection. |
| **Riff / solo editor** | alphaTex source on one side, notation and tab rendered live on the other. |
| **Private notes** | Each musician's own notes on a song (capo, effects, cues). Nobody else can see them, including admins. |
| **Paste a setlist** | Paste 15 song names at once (`Title – Artist`, numbered, `Set 2` / `---` dividers). Each line is matched against the band library: exact matches are used as is, near matches (accents, duplicates, artist-less titles) wait for you to confirm, a different artist is never matched silently, and the rest become new songs. Retrying a half-finished paste never adds anything twice. |
| **Chart readiness** | Every setlist row and song shows **Ready**, **Draft**, **Needs review**, **Lyrics only**, **TAB only** or **Find chords**, plus “9 of 12 charts ready” and a *Show missing only* filter. **Mark verified** signs off the chart's current content; any later chart edit flips it to *Needs review*. This is about the chart, not about the device — offline availability is still **Download for gig**. |
| **Find chords from the setlist** | Tap a row's status: search links prefilled with the song, **Paste chart** straight into that song (then back to the setlist, row highlighted) and **Import TAB**. The app remembers which song you were looking for, so a Share / bookmarklet coming back lands on it; if it can't tell, it asks instead of guessing. |
| **Setlists** | Drag-and-drop. Songs, breaks and set dividers. Running clock, totals per set, estimated end time, key and length overrides per gig, duplicate, print/PDF. |
| **Download for gig** | Puts every song, tab and the playback engine on the device, then checks it. The result is **Offline ready ✓** or **Download incomplete** with a list of what's missing. |
| **Stage mode** | Full screen with big text. Next/previous by swipe or Bluetooth page-turner pedal (arrows / PageUp / PageDown / Space). Auto-scroll paced to the song length, metronome, screen kept awake. Shows your note and what's next. The show is frozen while you play: band edits appear as an "Apply" banner and never rearrange the screen mid-song. |
| **Sync** | Instant local edits, offline queue, conflict detection, realtime updates. See [How sync works](#how-sync-works). |
| **Backup** | Export/restore a .zip with songs, setlists, tabs and your own private notes. |

## Try it (demo mode)

```bash
npm install
npm run dev
```

If no Supabase keys are set, the app runs in **demo mode**. Data stays in that browser only, and a permanent yellow banner says so. Demo data lives in a separate local database, so it can never mix with real band data.

## Going live with your band

### 1. Supabase (free plan)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste and run [`supabase/schema.sql`](supabase/schema.sql). This creates the tables, RLS policies, RPCs, realtime publication and the `song-files` storage bucket with its policies. The script can safely be run again; **re-run it after updating the app** so new columns (e.g. `chord_notation`, `chart_verified_hash`) are added.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled.
4. **Authentication → Email Templates → Magic Link**: make the email show the code, for example:
   ```html
   <h2>Your Setlist sign-in code</h2>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   ```
   The app signs in with a 6-digit code (`signInWithOtp` + `verifyOtp`), not a link. On iOS a link would open Safari instead of the installed app.
5. **Authentication → SMTP Settings**: set up a custom SMTP provider (Resend, Brevo, Postmark… all have free tiers). Supabase's built-in mailer only sends to your project team's addresses, a few emails per hour, so bandmates won't receive codes without this.
6. **Project Settings → API Keys**: copy the project URL and the **publishable** key (`sb_publishable_…`).

### 2. Configure and run

```bash
cp .env.example .env
# VITE_SUPABASE_URL=https://xxxx.supabase.co
# VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
npm run dev
```

Sign in, **Create band**, then **Band → Invite bandmates → Share link**. Invite codes are random, expire after 14 days or 10 uses, and can be revoked. Failed join attempts are rate-limited.

### 3. Deploy (GitHub Pages, free)

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The publishable key is designed to be public; RLS protects the data.
3. Push to `main`. `.github/workflows/deploy.yml` builds with the right base path and publishes.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your Pages URL.

### 4. Install on phones

- **iPhone/iPad**: open the site in Safari → Share → **Add to Home Screen**. Use the installed app. It gets its own storage, which Safari's 7-day cleanup of website data doesn't apply to.
- **Android**: Chrome → menu → **Install app**.

Before each gig, open the setlist and tap **Download for gig**. Wait for **Offline ready ✓**.

## How sync works

- Every edit is written to the device first (IndexedDB) and queued in an outbox that survives restarts.
- The server applies changes only through `apply_mutation()`, never through direct table writes, which RLS denies. In one transaction it:
  - checks band membership
  - serialises writes per band
  - ignores retries it has already applied (mutation ids), so a lost response can't apply a change twice
  - compares **per-field versions**
- A field nobody else changed is applied. A field someone else changed since you last saw it becomes a **conflict**. The band's value is kept and yours is stored. You choose under **Conflict — choose version**. Edits are never silently thrown away.
- Setlist order uses fractional position keys, sorted by position and then id, so every device shows the same order. When two people move the same item, the last move wins and the other person sees a "Setlist reordered by …" notice.
- Devices catch up through `pull_changes()`, an ordered per-band change log with a cursor. Tombstones carry deletions to other devices. Realtime only nudges a pull and isn't relied on for delivery. Devices also catch up on launch, reconnect, focus and every minute.
- If the server rejects a change, the change stays in the outbox until you retry or discard it. If your session expires, the app keeps working offline and syncs after you sign in again.

## Limits to know

- Free Supabase: 500 MB database, 1 GB file storage. Projects pause after about a week without activity. Open the app weekly or resume the project in the dashboard. Keep a backup export.
- Browsers *can* still clear storage under pressure, even with persistent storage granted. **Band → This device** shows the status.
- Guitar Pro playback uses a General MIDI SoundFont, so it sounds like a practice tool, not the record.
- Song finder only links out. Tabs and chords from those sites have to be copied or downloaded by you, under their terms.

## Development

```bash
npm run dev         # dev server
npm run lint        # eslint
npm test            # unit + sync-engine tests (vitest)
npm run test:sql    # schema/RLS/RPC tests on a throwaway local Postgres (needs postgresql installed)
npx playwright test # end-to-end: demo flow incl. offline gig + stage mode
npm run build
```

`src/lib/sync/fakeServer.ts` mirrors the SQL semantics so the sync engine can be tested with several users, offline periods, lost responses, expired sessions and restarts.

```
src/lib/            data layer, sync engine, ChordPro/transpose/time/ordering helpers, backup, gig check
src/components/     ChordProView, TabViewer (alphaTab), SongFiles + TabEditor, Metronome, Conflicts, Layout
src/pages/          Gate (sign-in/band), Songs, Song, SongEdit, Setlists, SetlistEdit, Stage, Band, Print
supabase/           schema.sql + SQL tests
e2e/                Playwright smoke test
```

## Roadmap

- **v2:** chord detection from uploaded audio (an optional online job; candidates are the Moises API if its terms allow, or an open-source model on a server).
- **v3:** solo transcription (audio → MIDI with Basic Pitch → estimated tab), editable before saving.

## Licenses

alphaTab is MPL-2.0. The Bravura font is OFL. The SoundFont license is in `node_modules/@coderline/alphatab/dist/soundfont/LICENSE`.
