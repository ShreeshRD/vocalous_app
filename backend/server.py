"""Minimal Vocalous sidecar: /health, /isolate, /transcribe on localhost."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PORT = int(os.environ.get("SIDECAR_PORT", "8765"))
ALLOWED_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


def _read_multipart_file(body: bytes, content_type: str) -> bytes:
    """Extract the first file part from a multipart/form-data body (stdlib only)."""
    if "boundary=" not in content_type:
        raise ValueError("missing multipart boundary")
    boundary = content_type.split("boundary=", 1)[1].strip().strip('"')
    delim = b"--" + boundary.encode()
    parts = body.split(delim)
    for part in parts:
        if b"\r\n\r\n" not in part:
            continue
        headers, data = part.split(b"\r\n\r\n", 1)
        if b"filename=" not in headers.lower() and b'name="file"' not in headers:
            # still accept first binary-ish part
            if b"Content-Disposition" not in headers:
                continue
        # strip trailing CRLF
        if data.endswith(b"\r\n"):
            data = data[:-2]
        if data and not data.startswith(b"--"):
            return data
    raise ValueError("no file part found")


def _pcm_rms_and_voiced(path: Path) -> tuple[float, float]:
    with wave.open(str(path), "rb") as w:
        n = w.getnframes()
        frames = w.readframes(min(n, w.getframerate() * 10))
        width = w.getsampwidth()
        if width != 2:
            return 0.0, 0.0
        import array

        arr = array.array("h")
        arr.frombytes(frames)
        if not arr:
            return 0.0, 0.0
        peak = max(abs(x) for x in arr) / 32768.0
        mean = sum((x / 32768.0) ** 2 for x in arr) / len(arr)
        rms = mean ** 0.5
        return rms, peak


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter
        print(f"[sidecar] {self.address_string()} {fmt % args}")

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {"ok": True, "service": "vocalous-sidecar"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        ctype = self.headers.get("Content-Type") or ""

        try:
            if path == "/isolate":
                self._handle_isolate(body, ctype)
            elif path == "/transcribe":
                self._handle_transcribe(body, ctype)
            else:
                self._json(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001 — surface to client
            self._json(500, {"error": str(e)})

    def _save_upload(self, body: bytes, ctype: str) -> Path:
        data = _read_multipart_file(body, ctype)
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.write(data)
        tmp.close()
        return Path(tmp.name)

    def _handle_isolate(self, body: bytes, ctype: str) -> None:
        wav_path = self._save_upload(body, ctype)
        try:
            try:
                from inworld import voice_isolation  # type: ignore
            except ImportError:
                self._json(
                    501,
                    {
                        "error": "voice isolation not installed",
                        "hint": "pip install inworld-voice-isolation",
                    },
                )
                return

            offline = voice_isolation.VoiceIsolator("inworld/voice-isolator")
            audio, sr = voice_isolation.load_audio(str(wav_path))
            voice = offline.isolate(audio, sr)
            out = wav_path.with_name(wav_path.stem + "_clean.wav")
            voice_isolation.save_audio(str(out), voice, sr, subtype="FLOAT")
            data = out.read_bytes()
            self._send(200, data, "audio/wav")
        finally:
            wav_path.unlink(missing_ok=True)

    def _handle_transcribe(self, body: bytes, ctype: str) -> None:
        wav_path = self._save_upload(body, ctype)
        try:
            # Prefer installed speech-flow / parakeet-cli if present
            candidates = [
                Path.home() / ".local/share/speech-flow/app",
                Path.home() / ".local/bin",
            ]
            parakeet = shutil.which("parakeet-cli")
            if not parakeet:
                for base in candidates:
                    found = list(base.glob("**/parakeet-cli")) if base.exists() else []
                    if found:
                        parakeet = str(found[0])
                        break

            if not parakeet:
                self._json(
                    501,
                    {
                        "error": "ASR runtime not found",
                        "hint": "build parakeet-cli (see VoiceAssistant/linux README)",
                        "words": [],
                        "language": "en",
                    },
                )
                return

            # Try a simple CLI invocation; exact flags may vary by build
            proc = subprocess.run(
                [parakeet, str(wav_path)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            text = (proc.stdout or proc.stderr or "").strip()
            # Without word timestamps from this CLI, return whole-line as one span
            words = []
            if text:
                tokens = text.split()
                # crude uniform timing over duration
                with wave.open(str(wav_path), "rb") as w:
                    dur = w.getnframes() / float(w.getframerate() or 16000)
                step = dur / max(len(tokens), 1)
                for i, tok in enumerate(tokens):
                    words.append(
                        {
                            "text": tok,
                            "start": round(i * step, 3),
                            "end": round((i + 1) * step, 3),
                        }
                    )
            self._json(200, {"words": words, "language": "en"})
        finally:
            wav_path.unlink(missing_ok=True)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Vocalous sidecar listening on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
