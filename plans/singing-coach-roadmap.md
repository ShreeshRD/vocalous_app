# Plan: Vocalous → Full Singing-Practice Coach

> **Status (implementation pass):** Phases 0–5 landed in-tree. Client builds (`display` tsc + `client` vite). Sidecar is a stdlib skeleton (optional models/ASR). Manual golden-path QA with mic still required.

## Context

Vocalous (`/home/arch/programs/extra/vocalous_app`) is a React + Vite web app that already tracks **singing pitch** (not speech recognition):

- Mic → `AnalyserNode` → WASM worker (`McLeod` / `Autocorrelation`) → live red pitch dots
- Optional UltraStar melody overlay (blue bars) via share URLs
- No scoring, no rhythm, no exercises, no persistence, no lyrics/articulation feedback

**User goal:** keep karaoke-style song practice as the core, but make the app actually help them **improve as a singer**: pitch accuracy, timing, range, warmups, vibrato/tone, progress — plus lyrics/articulation via local dictation and cleaner audio via Inworld Voice Isolator.

**External tools (user-specified):**

| Tool | What it is | Runs where | Fit for browser app |
|------|------------|------------|---------------------|
| Dictation at `~/programs/personal_organization/VoiceAssistant/linux/` | Local Python daemon/CLI; Bark 3.0 via whisper.cpp `parakeet-cli`; PipeWire capture; English-only; 16 kHz WAV; CPU-only | **Local process** (not browser) | Needs a thin local HTTP backend the web app can call |
| [Inworld Voice Isolator](https://github.com/inworld-ai/voice-isolator) | Apache-2.0 speech denoising; offline (64M) + realtime (58M) models; 48 kHz; PyTorch | **Local Python/PyTorch** (CUDA/CPU/MPS) | Same local backend; not practical as pure WASM in v1 |

**Architecture decision:** keep the existing client-side pitch pipeline (fast, private, offline). Add an **optional local Python sidecar** (`backend/`) for heavy audio ML (denoise → pitch/ASR). App must still work fully without the sidecar (pitch-only mode).

---

## Goals

1. **Feedback loop** after every practice: pitch score, timing score, per-note breakdown.
2. **Better singing pitch detection** (octave stability, vibrato, singing mic constraints).
3. **Karaoke UX**: lyrics on screen, transport, note colors by accuracy.
4. **Vocal tools**: range finder, warmups/drills, vibrato visualizer.
5. **Progress**: local history, trends, session summaries.
6. **Optional clarity + articulation**: Voice Isolator cleanup + dictation lyrics check.

---

## Non-goals (v1)

- Cloud/backend-as-a-service or accounts
- Full song library / copyrighted audio embedding (keep external music links)
- Training custom models
- Replacing UltraStar import flow
- Perfect studio-grade ASR for melisma (best-effort word timing)

---

## Phased delivery

### Phase 0 — Foundations (small, unblocks everything)

**0.1 Audio capture quality for singing** — `client/src/model.ts`

- Today: `echoCancellation: true, autoGainControl: true` (`model.ts:72`) — speech-conference processing that can squash dynamics and pitch cues.
- Change defaults for singing mode:
  - Prefer `echoCancellation: false`, `autoGainControl: false`, `noiseSuppression: false` (or expose “Studio mic” vs “Laptop mic” presets).
  - Optional `sampleRate` preference; keep analyser window configurable (existing `windowSize`).
- Add a simple input level meter + “too quiet / clipping” hint before Start.

**0.2 Session recording buffer (for scoring + offline analysis)**

- Capture PCM during practice into a ring buffer / `OfflineAudioContext` chunks (in worker or main thread via `AudioWorklet` preferred over Analyser-only).
- Today only `getFloatTimeDomainData` frames are consumed transiently; scoring needs time-aligned samples + pitch track.
- Emit a `PitchTrack` model: `{ t, freq, clarity, rms }[]` aligned with wall-clock / song position.

**0.3 Store & persistence skeleton** — extend `client/src/model.ts` or new `services/storage.ts`

- `localStorage` / IndexedDB for: settings, session history, range measurements, exercise progress.
- Schema: `SessionRecord { id, startedAt, source: 'song'|'free'|'exercise', melodyId?, pitchScore?, timingScore?, notes?, durationMs }`.
- No backend required.

**0.4 Optional sidecar client** — `client/src/services/sidecar.ts`

- Detect `http://127.0.0.1:8765/health` (configurable); expose `isAvailable()`, `isolate(audioBlob)`, `transcribe(audioBlob, opts)`.
- Graceful degrade: hide Lyrics-check / Denoise UI when offline.

**Exit criteria:** singing mic preset works; pitch track recorded per session; settings persist; sidecar health check doesn’t break the app when absent.

---

### Phase 1 — Pitch accuracy + scoring (core value)

**1.1 Note segmentation & matching**

- Reuse/extend `display/src/pitch-display/index.ts`:
  - `getNearestMelodyNote` already exists (`index.ts:123-154`).
  - Add `NoteAttempt` per melody note: onset time, mean cents offset, hold %, vibrato depth (if any), missed/extra.
- Matching rules (start simple, tunable):
  - Window = note `[start, start+duration]` ± small grace.
  - Octave-fold already partially done (`melodyPitch`); keep it for baritone/tenor practice but allow “strict octave” setting later.
  - Score 0–100 per note from: mean |cents|, in-tune hold ratio, coverage of note duration.

**1.2 Run-end scoring UI**

- After Stop (or song end), show summary overlay:
  - Overall %, average cents, timing error (ms early/late onsets), missed notes count.
  - Horizontal note ribbon: each melody note colored green/yellow/red.
  - Tap a note → scrub mini pitch-vs-target chart (cents over time).
- Wire into `PitchComponent` stop path (`client/src/components/pitch/index.tsx` `onStop`) without blocking mid-song (optional live score in navbar later).

**1.3 Live accuracy affordances (non-scoring)**

- Color pitch dots by error vs current melody note (green within ±50¢, amber ±100¢, red beyond) in `drawNotes` (`pitch-display/index.ts:290-329`) — currently always red `[254,74,73]`.
- Optional soft “target band” highlight around current melody bar.

**1.4 Detector tuning for singing**

- Defaults in `model.ts`: keep McLeod; consider smaller window (1024) for faster onset vs 2048 stability — expose “Singing (responsive)” vs “Stable” presets in `options.tsx`.
- Median/HITL smoothing of frequency track (short median filter in worker) to reduce octave glitches without killing vibrato (filter length ~3–5 frames).
- Power/clarity hysteresis: enter note above clarity 0.7, exit below 0.5 (avoid flicker).

**Files:** `display/src/pitch-display/*`, `client/src/components/pitch/*`, `client/src/model.ts`, new `client/src/services/scoring.ts`, new summary component.

**Exit criteria:** import any UltraStar file → practice → get honest per-note + overall pitch score; live dots show on-pitch color.

---

### Phase 2 — Timing / rhythm

**2.1 Onset detection from pitch+energy track**

- Detect note onsets in `PitchTrack` (energy rise + pitch continuity break) vs expected melody onsets.
- Metrics: mean absolute onset error, % onsets within ±80/±150 ms, duration match.

**2.2 Visual rhythm feedback**

- In summary: onset markers on the note ribbon (early ← → late).
- Optional metronome-style tick markers under melody during play (subtle).

**2.3 Timing component in score**

- `score = α·pitchScore + (1−α)·timingScore` with α default 0.7; show both separately so users know what to fix.

**Exit criteria:** users can see whether they’re sharp/flat **and** early/late; timing score stable across runs.

---

### Phase 3 — Lyrics & articulation (dictation + isolator)

**3.1 Sidecar service** — new `backend/` (Python)

Minimal FastAPI (or stdlib http.server) exposing:

```
GET  /health
POST /isolate   multipart wav/blob → cleaned wav (+ optional background)
POST /transcribe multipart wav → { words: [{text, start, end}], language }
```

- **Transcribe:** shell out to existing dictate/ASR stack:
  - Prefer reusing installed runtime under `~/.local/share/speech-flow/app` and `parakeet-cli` / `ASR/asr.py` paths from `VoiceAssistant/linux/`.
  - Input: browser-recorded mono WAV (export from Phase 0 buffer), resampled to 16 kHz if needed.
  - Note: model is **English speech**; singing accuracy is best-effort — document limits (melisma, heavy reverb, non-English).
- **Isolate:** `pip install inworld-voice-isolation`; offline model for session files; optional realtime model later for live mic (higher CPU/GPU, latency).
- CORS locked to `http://localhost:3000` (Vite) and file origins as needed.
- Sidecar is **optional**; ship a `backend/README.md` with install (`parakeet-cli` build + `inworld-voice-isolation`).

**3.2 Lyrics display during karaoke**

- Extend UltraStar parse (`ultrastar-parser.js`) to keep **line lyrics** (currently discarded: “lyrics will be ignored”).
  - Parse `P`/`F` line metadata and word syllables if present in TXT dialect used; if files lack lyrics, allow optional sidecar file or URL param `lyrics=` plain text with rough line timing (stretch across note lines).
- Show current/next lyric line above/below pitch canvas; highlight syllables as song position crosses note starts.
- Sync source of truth remains `songPos` from `PitchDisplay.calculateSongPos`.

**3.3 Articulation / words check (post-session)**

- After stop, if sidecar available:
  1. Export practice audio (mic only).
  2. Optional `POST /isolate` → cleaner audio.
  3. `POST /transcribe` → word sequence + times.
  4. Align transcribed words to expected lyric syllables (simple sequence alignment / fuzzy match on normalized tokens).
- Report: “words matched / missed / extra”, not a hard grade — sung ASR is noisy.
- UI section on session summary: “Lyrics check”.

**3.4 Live denoise (optional, later in phase)**

- Only if sidecar + realtime isolate model are acceptable latency-wise: route mic through sidecar websocket, feed cleaned PCM to existing `PitchMonitor`.
- Default **off**; pitch path stays local otherwise.

**Exit criteria:** with sidecar running, summary includes lyrics match; lyric lines visible during song; without sidecar, everything else still works.

---

### Phase 4 — Vocal range, warmups, vibrato/tone

**4.1 Range finder (free mode)**

- New tab or panel: “Range”.
- Flow: slow ascending/descending chromatic or major scale reference (WebAudio oscillator / simple synth — no copyright issues), user matches notes; record comfortable extremes (e.g. lowest/highest sustained note with clarity ≥ threshold for ≥300 ms).
- Persist range (MIDI numbers) + date; show on a keyboard/wheel (reuse unused `circle-chart` component — `client/src/components/circle-chart/` is currently orphaned).

**4.2 Warmups & drills (built-in exercises)**

- Exercise definitions as data (JSON): `{ id, name, kind: 'scale'|'siren'|'interval'|'hold', targetNotes[], tempo }`.
- Kinds v1:
  - **Major scale up/down** (pitch accuracy)
  - **Siren / glissando** (smoothness, range)
  - **Hold steady note** (tone/vibrato control): score stability (cents stddev) + optional vibrato detection
  - **Interval jumps** (accuracy on leaps)
- UI: new **Exercise** tab next to Sing/Create; reuse `PitchMonitor` + `PitchDisplay` with generated `melody.notes` (no UltraStar file needed).
- End with same scoring pipeline as Phase 1.

**4.3 Vibrato / tone metrics**

- On held notes (duration ≥ 400 ms, clarity high):
  - Detect oscillation: peak freq of F0 modulation in 4–8 Hz band.
  - Metrics: rate (Hz), depth (cents), onset delay after note start, regularity.
- UI: “Tone” panel on summary for hold exercises + long song notes; optional live needle for depth.

**Exit criteria:** user can measure range over time, run warmups without song files, and see vibrato/steadiness feedback on holds.

---

### Phase 5 — Progress over time

**5.1 Session history list**

- From IndexedDB: date, mode, song/exercise name, scores, duration.
- Detail view reuses Phase 1 summary (store note-level results compressed or re-derivable).

**5.2 Trends**

- Simple charts (existing d3-scale or lightweight SVG): pitch score over last N sessions, range high/low over months, exercise bests.
- Personal bests badge per song/exercise.

**5.3 Optional export**

- JSON export/import of history (backup / move machines).

**Exit criteria:** after a few weeks, user can see whether accuracy/range is improving.

---

## Suggested implementation order

```text
Phase 0  foundations (mic presets, pitch track, storage, sidecar probe)
Phase 1  pitch scoring + live colors          ← biggest “helps me sing” win
Phase 2  timing metrics
Phase 3  backend sidecar + lyrics + articulation (+ isolator)
Phase 4  range, exercises, vibrato
Phase 5  progress / trends
```

Phases 4–5 can partially parallelize after Phase 1 (exercises reuse scoring; progress needs session records from 1–2).

---

## Key integration points (existing code)

| Concern | Location |
|---------|----------|
| Mic constraints | `client/src/model.ts:72` |
| Pitch loop | `client/src/components/pitch/pitch-monitor.tsx` |
| WASM detectors | `wasm/src/lib.rs`, `client/worker/index.ts` |
| Melody overlay / song clock | `display/src/pitch-display/index.ts` |
| Note math | `display/src/utils/index.ts` |
| UltraStar import | `client/src/services/ultrastar-parser.js`, `components/importer/index.jsx` |
| Melody from URL | `client/src/components/main/app-frame.tsx` |
| Unused note wheel | `client/src/components/circle-chart/` |
| Options UI | `client/src/components/main/options.tsx` |
| Build/run | `./run` → wasm → display → client :3000 |

---

## Sidecar sketch (`backend/`)

```text
backend/
  README.md          # install dictate runtime + inworld-voice-isolation
  requirements.txt   # fastapi, uvicorn, inworld-voice-isolation (optional extra)
  server.py          # /health /isolate /transcribe
  asr_bridge.py      # wrap VoiceAssistant ASR / parakeet-cli
  isolate_bridge.py  # wrap inworld.voice_isolation
```

- Default port `8765`; env `VOCALOUS_SIDECAR_URL`.
- Never block UI start on sidecar; feature-flag from `sidecar.isAvailable()`.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Bark/parakeet weak on **sung** lyrics | Best-effort labeling; isolate first; allow manual “what I sang” vs expected without ASR |
| Voice Isolator too heavy for live mic | v1: post-session only; live denoise optional |
| Scoring feels arbitrary | Expose thresholds in Options; show cents not just % |
| Octave errors on low voices | Octave-fold setting + range calibration from Phase 4 |
| Mic processing differences | Explicit singing vs laptop presets (Phase 0) |
| Scope creep | Ship Phase 1 before any backend work |
| Privacy (FAQ promise) | Keep pitch local by default; sidecar is localhost-only; document when audio is sent to sidecar |

---

## Testing / verification

1. **Manual golden path:** `./run` → Create with sample UltraStar → Sing → Stop → summary scores sensible vs ear.
2. **Pitch track unit tests:** scoring pure functions (`services/scoring.ts`) with synthetic freq tracks (in-tune, flat, late, missed).
3. **Parser tests:** UltraStar with/without lyrics lines; `s1Encoding` round-trip.
4. **Sidecar:** health down → UI hides features; `transcribe` on known wav fixture; `isolate` smoke test.
5. **Regression:** free mode (no melody) still shows live pitch; worker detector options still work.
6. **A11y/i18n:** new strings in `en-US.json` (+ fi/es placeholders).

---

## Open questions (defaults if unspecified)

1. **Live lyrics only vs also post-session articulation score?** → Default: both when sidecar present; articulation optional.
2. **Exercise library size v1?** → Default: 4 drills (scale, siren, hold, intervals).
3. **Where should history live?** → Default: IndexedDB, no sync.
4. **Is a always-on localhost sidecar acceptable?** → Default: opt-in via README + “Enable local voice tools” toggle.

---

## Deliverable summary

A phased upgrade of Vocalous from “live pitch line + melody overlay” to a **karaoke singing coach**: scored pitch and timing, on-screen lyrics, local optional denoise/ASR for articulation, range/warmup/vibrato tools, and progress history — without giving up the current client-first, privacy-friendly pitch pipeline.
