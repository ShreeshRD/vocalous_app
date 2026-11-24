# Optional local sidecar (voice tools)

Provides **voice isolation**, **transcription**, and **post-session acoustic analysis** for Vocalous over localhost.
The web app works fully without this service (pitch-only mode).

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{"ok":true}` |
| POST | `/isolate` | multipart `file` (wav) | cleaned wav (`audio/wav`) |
| POST | `/transcribe` | multipart `file` (wav) | `{"words":[{"text","start","end"}],"language":"en"}` |
| POST | `/analyze` | multipart `file` (wav) | `{pitch, intensity, formants, durationSec, sampleRate}` |

Default URL: `http://127.0.0.1:8765` (override with `VITE_SIDECAR_URL` in the client).

## Run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional: pip install praat-parselmouth   # enables POST /analyze
# Optional: build ASR runtime (parakeet-cli) — see VoiceAssistant/linux README
# Optional: pip install inworld-voice-isolation

python server.py
```

CORS allows `http://localhost:3000` (Vite dev).

## /analyze (Praat via parselmouth)

Post-session only — never on the live mic path. Returns:

- **pitch**: median/low/high Hz (5th–95th pct), note names (e.g. `A3`–`C5`), voiced fraction, short F0 contour
- **intensity**: mean/peak/std dB
- **formants**: mean F1/F2/F3 (Hz) on voiced frames

Missing `parselmouth` → **501** with install hint (same pattern as `/isolate`).

## Detector validation (engineering CLI)

Compare a browser pitch track against Praat F0 on the same take:

```bash
pip install praat-parselmouth
python validate_detector.py session.wav track.json
```

`track.json` from the client after a session (see `exportPitchTrackDebug` in
`client/src/services/pitchTrack.ts`), either a bare point list or
`{ "startedAt": <ms>, "points": [...] }`. Report: median/mean |cents| error,
match rate ≤50¢, octave-error rate, voiced/unvoiced disagreement.

## Notes

- Transcription uses the local dictate/ASR stack when available; otherwise returns a clear error.
- Singing ASR is best-effort (English speech model).
- Isolation uses Inworld Voice Isolator when installed; otherwise 501.
- Audio stays on this machine; the client only calls localhost by default.
