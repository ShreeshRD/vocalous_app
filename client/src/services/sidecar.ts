// Optional localhost sidecar for voice isolation + transcription.
// App must work fully when sidecar is offline.

const DEFAULT_URL = 'http://127.0.0.1:8765';

export function sidecarBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SIDECAR_URL as string | undefined;
  return (fromEnv || DEFAULT_URL).replace(/\/$/, '');
}

let cachedAvailable: boolean | null = null;
let cachedAt = 0;
const CACHE_MS = 15000;

export async function isSidecarAvailable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && cachedAvailable !== null && now - cachedAt < CACHE_MS) {
    return cachedAvailable;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${sidecarBaseUrl()}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    cachedAvailable = res.ok;
  } catch {
    cachedAvailable = false;
  }
  cachedAt = now;
  return cachedAvailable;
}

export async function isolateAudio(audio: Blob): Promise<Blob> {
  const form = new FormData();
  form.append('file', audio, 'session.wav');
  const res = await fetch(`${sidecarBaseUrl()}/isolate`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`isolate failed: ${res.status}`);
  }
  return res.blob();
}

export interface TranscribedWord {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeResult {
  words: TranscribedWord[];
  language: string;
}

export async function transcribeAudio(audio: Blob): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', audio, 'session.wav');
  const res = await fetch(`${sidecarBaseUrl()}/transcribe`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`transcribe failed: ${res.status}`);
  }
  return res.json();
}
