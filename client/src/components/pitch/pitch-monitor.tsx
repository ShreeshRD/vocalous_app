import React from 'react';

import { startSessionAudio, stopSessionAudio } from '../../services/sessionAudio';

interface PitchSetup {
  analyser?: AnalyserNode;
  audioContext?: AudioContext;
  buffer?: Float32Array;
  byteBuffer?: Uint8Array;
  source?: MediaStreamAudioSourceNode;
}

interface PitchProps {
  stream: MediaStream;
  workerConnection: any;
  detectorName: 'autocorrelation' | 'mcleod';
  windowSize: number;
  powerThreshold: number;
  clarityThreshold: number;
  /** RMS below this is treated as silence/noise (not voice). */
  noiseGateRms?: number;
  enabled: boolean;
  pitchRenderer: React.ComponentType<{
    freq: number | null;
    clarity: number | null;
    rms?: number | null;
  }>;
  onPitchSample?: (sample: {
    freq: number | null;
    clarity: number | null;
    rms: number;
    time: number;
  }) => void;
}

const convertByteToFloatBuffer = (byteBuf: Uint8Array, floatBuf: Float32Array) => {
  for (let i = 0; i < byteBuf.length; i++) {
    floatBuf[i] = byteBuf[i] / 128 - 1;
  }
};

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

/** Median of a small numeric array (copies and sorts). */
function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * While `enabled` is truthy, get the pitch from the input source,
 * and pass its frequency, clarity, and RMS to `pitchRenderer`.
 *
 * Noise rejection:
 * - RMS noise gate (silence / room tone rejected)
 * - Hangover: need 2 consecutive voiced frames to open, 4 to close
 * - 5-sample median on frequency to kill single-frame spikes
 */
export function PitchMonitor({
  stream,
  detectorName,
  workerConnection,
  windowSize,
  powerThreshold,
  clarityThreshold,
  noiseGateRms = 0.012,
  enabled,
  pitchRenderer,
  onPitchSample,
}: PitchProps) {
  const [freq, setFreq] = React.useState<number | null>(null);
  const [clarity, setClarity] = React.useState<number | null>(null);
  const [rms, setRms] = React.useState<number | null>(null);
  const pendingRef = React.useRef(false);
  const pitchSetupRef = React.useRef<PitchSetup>({});
  const onPitchSampleRef = React.useRef(onPitchSample);
  onPitchSampleRef.current = onPitchSample;

  // VAD hangover + median history (refs so they survive re-renders)
  const voicedRunRef = React.useRef(0);
  const silenceRunRef = React.useRef(0);
  const gateOpenRef = React.useRef(false);
  const freqHistoryRef = React.useRef<number[]>([]);

  const setupConnection = React.useCallback(async () => {
    await workerConnection
      .remoteHandle()
      .call('createDetector', detectorName, windowSize, windowSize / 2);
    const pitchSetup = pitchSetupRef.current;
    pitchSetup.buffer = new Float32Array(windowSize);
    pitchSetup.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const mediaStreamSource = pitchSetup.audioContext.createMediaStreamSource(
      stream
    );
    pitchSetup.source = mediaStreamSource;
    pitchSetup.analyser = pitchSetup.audioContext.createAnalyser();
    if (pitchSetup.analyser.getFloatTimeDomainData === undefined) {
      pitchSetup.byteBuffer = new Uint8Array(windowSize);
    }
    pitchSetup.analyser.fftSize = windowSize;
    mediaStreamSource.connect(pitchSetup.analyser);

    // Post-session /analyze buffer (Phase 6) — separate from the pitch path
    startSessionAudio(pitchSetup.audioContext, mediaStreamSource);

    // Reset gate state for a new stream/session
    voicedRunRef.current = 0;
    silenceRunRef.current = 0;
    gateOpenRef.current = false;
    freqHistoryRef.current = [];
  }, [pitchSetupRef, windowSize, detectorName, stream, workerConnection]);

  const updatePitch = React.useCallback(async () => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;

    try {
      const pitchSetup = pitchSetupRef.current;
      const { analyser, buffer, byteBuffer, audioContext } = pitchSetup;
      if (!analyser || !buffer || !audioContext) {
        console.warn(
          'Trying to update the pitch, but missing an analyser/buffer/audioContext'
        );
        return;
      }
      if (analyser.getFloatTimeDomainData !== undefined) {
        analyser.getFloatTimeDomainData(buffer as any);
      } else if (byteBuffer) {
        analyser.getByteTimeDomainData(byteBuffer as any);
        convertByteToFloatBuffer(byteBuffer as any, buffer);
      }

      const level = computeRms(buffer);
      setRms((prev) => {
        if (prev == null || Math.abs(prev - level) > 0.005) {
          return level;
        }
        return prev;
      });

      // Hard noise gate: room tone / hum never reaches the pitch worker
      const aboveGate = level >= noiseGateRms;

      let rawFreq = -1;
      let clarityVal = 0;
      if (aboveGate) {
        const result = await workerConnection
          .remoteHandle()
          .call(
            'getPitch',
            buffer,
            audioContext.sampleRate,
            powerThreshold,
            clarityThreshold
          );
        rawFreq = result[0];
        clarityVal = result[1];
      }

      const detectorHit = rawFreq > 0 && clarityVal >= clarityThreshold;

      // Hangover VAD: open after 2 voiced frames, close after 4 silent frames
      if (detectorHit && aboveGate) {
        voicedRunRef.current += 1;
        silenceRunRef.current = 0;
        if (!gateOpenRef.current && voicedRunRef.current >= 2) {
          gateOpenRef.current = true;
        }
      } else {
        silenceRunRef.current += 1;
        voicedRunRef.current = 0;
        if (gateOpenRef.current && silenceRunRef.current >= 4) {
          gateOpenRef.current = false;
          freqHistoryRef.current = [];
        }
      }

      let accepted: number | null = null;
      let acceptedClarity: number | null = null;

      if (gateOpenRef.current && detectorHit) {
        const hist = freqHistoryRef.current;
        hist.push(rawFreq);
        if (hist.length > 5) {
          hist.shift();
        }
        // Only emit once we have a short history (kills first-frame spikes)
        if (hist.length >= 3) {
          accepted = median(hist);
          acceptedClarity = clarityVal;
        }
      }

      setFreq(accepted);
      setClarity(acceptedClarity);

      onPitchSampleRef.current?.({
        freq: accepted,
        clarity: acceptedClarity ?? 0,
        rms: level,
        time: Date.now(),
      });
    } finally {
      pendingRef.current = false;
    }
  }, [
    pendingRef,
    pitchSetupRef,
    setFreq,
    setClarity,
    setRms,
    powerThreshold,
    clarityThreshold,
    noiseGateRms,
    workerConnection,
  ]);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    console.log('Starting audio monitoring.');
    const escape = { cancelRender: false };
    function renderFrame() {
      if (escape.cancelRender) {
        return;
      }
      requestAnimationFrame(renderFrame);
      updatePitch();
    }
    (async () => {
      await setupConnection();
      renderFrame();
    })();

    return () => {
      console.log('Stopping audio monitoring.');
      escape.cancelRender = true;
      // Session WAV is finalized by PitchComponent.onStop → stopSessionAudio()
      // so the blob is still readable when the summary opens.
    };
  }, [setupConnection, updatePitch, enabled]);

  const PitchRenderer = pitchRenderer;
  return <PitchRenderer freq={freq} clarity={clarity} rms={rms} />;
}
