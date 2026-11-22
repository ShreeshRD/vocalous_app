# Optional local sidecar (voice tools)

Provides **voice isolation** and **transcription** for Vocalous over localhost.
The web app works fully without this service (pitch-only mode).

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{"ok":true}` |
| POST | `/isolate` | multipart `file` (wav) | cleaned wav (`audio/wav`) |
| POST | `/transcribe` | multipart `file` (wav) | `{"words":[{"text","start","end"}],"language":"en"}` |

Default URL: `http://127.0.0.1:8765` (override with `VITE_SIDECAR_URL` in the client).

## Run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional: build ASR runtime (parakeet-cli) — see VoiceAssistant/linux README
# Optional: pip install inworld-voice-isolation

python server.py
```

CORS allows `http://localhost:3000` (Vite dev).

## Notes

- Transcription uses the local dictate/ASR stack when available; otherwise returns a clear error.
- Singing ASR is best-effort (English speech model).
- Isolation uses Inworld Voice Isolator when installed; otherwise 501.
- Audio stays on this machine; the client only calls localhost by default.
