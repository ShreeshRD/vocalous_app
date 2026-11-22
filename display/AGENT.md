# Display (pitch visualization)

## Purpose

Own the standalone `pitch-display` library: scrolling pitch canvas, melody overlay, song position clock, and note math used by the client.

## Ownership

- All files under `display/` (`src/`, `tsconfig.json`, `package.json`, build `dist/`).
- Published/linked into client as package name `pitch-display` (`file:../display`).

## Local Contracts

- Entry: `display/src/index.ts` exports `PitchDisplay` only.
- Build: `npm run build` → `tsc` → `dist/` (ES module + types via package `module`/`types`).
- Dependencies: `d3-scale`, `lodash-es` (see `package.json`).
- Core API (`display/src/pitch-display/index.ts`):
  - `pushFrequency({ frequency, clarity, time, rms? })` — MIDI pitch (float), optional `melodyPitch` octave-fold, optional `rms` for level ribbon.
  - `setMelodyNotes(notes)` — `{ start, duration, pitch }` (MIDI).
  - Song clock: `playSong` / `pauseSong` / `fastForwardSong` / `seekToFirstNote`; `calculateSongPos` / `getSongPos` / `getMelodyNotes`.
  - `render(full?)` — melody, pitch dots, level ribbon, time markers; client drives rAF.
  - `subscribeToIntroState(cb)` — intro = before first melody note.
  - Live accuracy colors in `drawNotes`: green ≤50¢, amber ≤100¢, red beyond (`colorForPitch`); soft target band on melody bars.
- Vertical staff: **MIDI domain `PITCH_MIN=36` (C2) … `PITCH_MAX=84` (C6)** — **no `% 24` octave wrap**. Labels: natural notes as `C4`-style via `noteStringForMidi` / `octaveLabelForMidi` in `src/constants/index.ts`. Out-of-range pitches clamp to edge.
- Level ribbon: bottom ~12% of canvas, bars from per-sample `rms` (time-aligned with dots); grey/green/amber by level.
- Helpers: `noteFromPitch`, `frequencyFromNoteNumber`, `centsOffFromPitch` in `src/utils/index.ts`.
- Colors: client supplies background/highlight; melody stroke and note dots fixed in `drawMelody` / `drawNotes`.

## Work Guidance

- Keep this package framework-free (no React); client owns React wrappers.
- Public API changes require a client rebuild against `file:../display` and a `npm run build` here first.
- Prefer extending draw/score hooks here when multiple UIs need the same geometry.

## Verification

- `cd display && npm run build`
- After changes: rebuild client (`cd client && npm run build`) so it picks up `dist/`.

## Child DOX Index

None
