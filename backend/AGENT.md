# Sidecar (optional voice tools)

## Purpose

Own the optional localhost Python service that isolates speech and transcribes practice audio for Vocalous. The web app must work fully without it.

## Ownership

- All files under `backend/`.

## Local Contracts

- Listen on `127.0.0.1:8765` (`SIDECAR_PORT` env overrides).
- Routes: `GET /health`, `POST /isolate` (multipart `file` → wav), `POST /transcribe` (multipart `file` → `{words, language}`).
- Stdlib HTTP server (`ThreadingHTTPServer`); no framework required for v1.
- Optional deps: `inworld-voice-isolation` for `/isolate`; local `parakeet-cli` for `/transcribe`. Missing deps → **501** with a hint, not a crash.
- CORS: allow localhost Vite origins (`localhost`/`127.0.0.1` ports 3000/5173).
- Never bind non-localhost by default (privacy).

## Work Guidance

- Keep bridges thin; prefer shelling out to existing VoiceAssistant / Inworld CLIs over re-implementing models.
- Document install steps in `backend/README.md`.
- Client probe: `client/src/services/sidecar.ts`.

## Verification

- `python backend/server.py` then `curl http://127.0.0.1:8765/health`
- Optional: POST a short wav to `/transcribe` when ASR is installed.

## Child DOX Index

None
