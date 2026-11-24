// Session PCM capture for post-session /analyze (Phase 6).
// Live pitch path stays on the analyser → WASM worker; this only buffers
// mic PCM while practice is active so Stop can hand a WAV to the sidecar.

const MAX_SECONDS = 600; // ~10 min, matches pitchTrack cap

let chunks: Float32Array[] = [];
let sampleRate = 48000;
let recording = false;
let totalSamples = 0;
let processor: ScriptProcessorNode | null = null;
let muteGain: GainNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let audioCtx: AudioContext | null = null;

/**
 * Start capturing mono PCM from the live mic graph.
 * Safe to call again — restarts a fresh buffer.
 */
export function startSessionAudio(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode
): void {
  stopSessionAudioNodes();
  chunks = [];
  totalSamples = 0;
  sampleRate = ctx.sampleRate;
  recording = true;
  audioCtx = ctx;
  sourceNode = source;

  // ScriptProcessor is deprecated but universally available without a
  // separate AudioWorklet module (keep v1 simple).
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => {
    if (!recording) {
      return;
    }
    if (totalSamples >= MAX_SECONDS * sampleRate) {
      return; // cap reached — keep last full buffer, drop overflow
    }
    const data = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(data.length);
    copy.set(data);
    chunks.push(copy);
    totalSamples += copy.length;
  };
  source.connect(node);
  // Route through a silent gain so the processor runs without feedback.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);
  processor = node;
  muteGain = mute;
}

function stopSessionAudioNodes(): void {
  try {
    processor?.disconnect();
    muteGain?.disconnect();
  } catch {
    /* already gone */
  }
  processor = null;
  muteGain = null;
}

/** Stop capturing and return the take as a 16-bit mono WAV blob (or null). */
export function stopSessionAudio(): Blob | null {
  recording = false;
  if (!chunks.length) {
    stopSessionAudioNodes();
    return null;
  }
  const wav = encodeWav(chunks, sampleRate);
  chunks = [];
  totalSamples = 0;
  stopSessionAudioNodes();
  sourceNode = null;
  audioCtx = null;
  return wav;
}

export function isSessionAudioRecording(): boolean {
  return recording;
}

/** 16-bit PCM mono WAV (RIFF) from interleaved float chunks in [-1, 1]. */
export function encodeWav(parts: Float32Array[], rate: number): Blob {
  let n = 0;
  for (const p of parts) {
    n += p.length;
  }
  const bytes = 2; // 16-bit
  const dataSize = n * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(off + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytes, true); // byte rate
  view.setUint16(32, bytes, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      const s = Math.max(-1, Math.min(1, p[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
