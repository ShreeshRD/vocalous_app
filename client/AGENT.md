# Client (React app)

## Purpose

Own the Vocalous web UI: React entry, routing/tabs, store, mic session flow, pitch practice screens, import/share flow, i18n, and the pitch-detection worker bridge.

## Ownership

- All files under `client/` except `client/worker/` (child-owned) and generated artifacts (`build/`, `node_modules/`, `public/pitch-detection/worker.js`, `public/pitch-detection/*.wasm` after Rollup copy).
- Dev server port **3000**, Vite base **`/app/`** (`vite.config.ts`).

## Local Contracts

- Stack: React 18, TypeScript/JSX, Vite, Bootstrap/react-bootstrap, easy-peasy store (`src/model.ts`), react-i18next, post-me to worker.
- Packages: `pitch-detection-wasm` → `file:../wasm/pkg`; `pitch-display` → `file:../display`.
- Scripts: `npm run start` / `dev` = `build:worker` then Vite; `npm run build` = worker + `tsc -b` + `vite build`; worker bundle via `rollup.config.js` → `public/pitch-detection/worker.js` and copies `../wasm/pkg/**.wasm`.
- Mic: `initializeStream` uses `getUserMedia`; preset via `micPreset` (`studio` | `laptop`) → `micConstraintsFor` in `src/services/storage.ts`. Pitch loop only runs when `enabled` and stream + worker connection exist (`App.tsx`).
- Melody load: URL query `s1` decoded in `src/components/main/app-frame.tsx` via `src/services/s1Encoding.js`; optional `sl` = base64 JSON lyric lines; song meta via `qs` (`title`, `author`, `music`, `lyrics`).
- Create flow: UltraStar TXT → `src/services/ultrastar-parser.js` (notes + lines) → `encodeS1` + `sl` → share URL (optional TinyURL).
- Pitch UI path: `PitchMonitor` (`src/components/pitch/pitch-monitor.tsx`) → worker `getPitch` → `PitchComponent` (`src/components/pitch/index.tsx`) → `PitchDisplay` from `pitch-display`.
- Scoring: `src/services/scoring.ts` (pure); pitch track buffer `src/services/pitchTrack.ts`; session persistence `src/services/storage.ts` (localStorage).
- Sidecar probe: `src/services/sidecar.ts` → `backend/` on `127.0.0.1:8765`.
- Defaults: `detectorName: 'mcleod'`, `windowSize: 2048`, `clarityThreshold: 0.8` (default; may be lower if user saved settings), `micPreset: 'studio'`, `POWER_THRESHOLD = 0.28` in `App.tsx`.
- Noise rejection: RMS noise gate + VAD hangover + 5-sample median frequency in `pitch-monitor.tsx`; browser `noiseSuppression: true` on both mic presets (AGC/echo remain off for studio).
- Practice UI: full `PitchDisplay` canvas (staff C2–C6 + bottom level ribbon), top-center `PracticeHud` (note / cents / level bar), dismissible `FirstRunTip` (`localStorage` `vocalous.tipSeen`); no corner `LevelMeter`.
- Exercises (`exercises.tsx`): beginner timings — scale 1200 ms + 600 ms rest, siren 500 ms steps, hold 2500/1000, interval 1200/800, range 900/400; **2 s lead-in** before first note.
- Tabs: Sing | Exercise | Create | History | Help (`src/components/main/index.jsx`).
- i18n strings live in `src/translations/*.json`; add keys to every locale file when introducing UI text.
- `src/components/circle-chart/` is currently unused by the app tree; do not assume it is mounted.

## Work Guidance

- Prefer editing existing components over new top-level entry points.
- Keep store actions/thunks in `src/model.ts`; pure helpers in `src/services/` or component-local modules.
- After changing worker protocol, update `client/worker/types.ts` and the parent handshake usage together.
- Rebuild worker after TS changes: `npm run build:worker` (or `npm run start`).
- Do not commit secrets; there is no backend auth in this client.

## Verification

- `cd client && npm run build` (typecheck + bundle)
- Manual: `./run` from repo root → `http://localhost:3000/app/`

## Child DOX Index

| Domain | Path | Scope |
|---|---|---|
| Pitch worker | `client/worker/AGENT.md` | WASM loader, post-me RPC, detector lifecycle |
