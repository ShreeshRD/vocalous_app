// Pure pitch/timing scoring for practice sessions.
// Pitch values are MIDI note numbers (fractional = includes cents).

import type { SessionNoteResult } from './storage';
import type { PitchTrackPoint } from './pitchTrack';

export interface MelodyNote {
  start: number;
  duration: number;
  pitch: number;
}

export interface NoteAttempt extends SessionNoteResult {
  samples: { songPos: number; cents: number; clarity: number }[];
}

export interface TimingScore {
  score: number;
  meanAbsErrorMs: number | null;
  within80Pct: number | null;
  within150Pct: number | null;
  onsetErrorsMs: (number | null)[];
}

export interface SessionScore {
  pitchScore: number;
  timingScore: number | null;
  overallScore: number;
  avgCents: number | null;
  missedNotes: number;
  noteCount: number;
  notes: NoteAttempt[];
  timing: TimingScore | null;
}

export const SCORE_WEIGHT_PITCH = 0.7;

export function foldToTarget(pitch: number, target: number): number {
  let diff = (pitch - target) % 12;
  if (diff > 6) {
    diff -= 12;
  } else if (diff < -6) {
    diff += 12;
  }
  return target + diff;
}

export function centsBetween(a: number, b: number): number {
  return (a - b) * 100;
}

function noteWindow(note: MelodyNote, graceMs = 50): { start: number; end: number } {
  return {
    start: note.start - graceMs,
    end: note.start + note.duration + graceMs,
  };
}

/**
 * Score one melody note against pitch samples (songPos in ms).
 */
export function scoreNote(
  index: number,
  note: MelodyNote,
  samples: PitchTrackPoint[],
  opts: { hitCents?: number; weakCents?: number } = {}
): NoteAttempt {
  const hitCents = opts.hitCents ?? 50;
  const weakCents = opts.weakCents ?? 100;
  const { start, end } = noteWindow(note);
  const windowSamples = samples.filter(
    (s) =>
      s.songPos != null &&
      s.songPos >= start &&
      s.songPos < end &&
      s.pitch != null &&
      s.clarity >= 0.35
  );

  const attemptSamples = windowSamples.map((s) => {
    const folded = foldToTarget(s.pitch as number, note.pitch);
    return {
      songPos: s.songPos as number,
      cents: centsBetween(folded, note.pitch),
      clarity: s.clarity,
    };
  });

  if (attemptSamples.length < 2) {
    return {
      index,
      start: note.start,
      duration: note.duration,
      pitch: note.pitch,
      score: 0,
      meanCents: 0,
      holdRatio: 0,
      coverage: 0,
      onsetErrorMs: null,
      status: 'miss',
      samples: attemptSamples,
    };
  }

  const absCents = attemptSamples.map((s) => Math.abs(s.cents));
  const meanAbs = absCents.reduce((a, b) => a + b, 0) / absCents.length;
  const meanSigned =
    attemptSamples.reduce((a, s) => a + s.cents, 0) / attemptSamples.length;

  // Coverage: unique ~16ms buckets filled vs expected duration
  const durationMs = Math.max(note.duration, 1);
  const bucketMs = 16;
  const expectedBuckets = Math.max(1, Math.floor(durationMs / bucketMs));
  const buckets = new Set(
    attemptSamples.map((s) => Math.floor((s.songPos - start) / bucketMs))
  );
  const coverage = Math.min(1, buckets.size / expectedBuckets);

  // Hold ratio: fraction of samples within weak threshold
  const inTune = absCents.filter((c) => c <= weakCents).length;
  const holdRatio = inTune / absCents.length;

  // Score components 0..1
  const centsScore = Math.max(0, 1 - meanAbs / 150);
  const raw = 100 * (0.55 * centsScore + 0.25 * holdRatio + 0.2 * coverage);
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  let status: SessionNoteResult['status'] = 'weak';
  if (meanAbs <= hitCents && holdRatio >= 0.55 && coverage >= 0.4) {
    status = 'hit';
  } else if (meanAbs > weakCents || coverage < 0.2) {
    status = 'miss';
  }

  return {
    index,
    start: note.start,
    duration: note.duration,
    pitch: note.pitch,
    score,
    meanCents: Math.round(meanSigned),
    holdRatio: Math.round(holdRatio * 100) / 100,
    coverage: Math.round(coverage * 100) / 100,
    onsetErrorMs: null,
    status,
    samples: attemptSamples,
  };
}

/**
 * Detect onsets: first sample after a gap (≥120ms) where voice returns,
 * or where pitch jumps ≥1.5 semitones after silence.
 */
export function detectOnsets(
  samples: PitchTrackPoint[],
  opts: { gapMs?: number; clarity?: number } = {}
): number[] {
  const gapMs = opts.gapMs ?? 120;
  const clarity = opts.clarity ?? 0.4;
  const voiced = samples
    .filter((s) => s.songPos != null && s.clarity >= clarity && s.freq && s.freq > 0)
    .sort((a, b) => (a.songPos as number) - (b.songPos as number));

  const onsets: number[] = [];
  let prevT: number | null = null;
  let prevPitch: number | null = null;

  for (const s of voiced) {
    const t = s.songPos as number;
    const p = s.pitch;
    if (prevT == null || t - prevT >= gapMs) {
      onsets.push(t);
    } else if (
      prevPitch != null &&
      p != null &&
      Math.abs(p - prevPitch) >= 1.5
    ) {
      onsets.push(t);
    }
    prevT = t;
    prevPitch = p;
  }
  return onsets;
}

function matchOnset(
  expectedStart: number,
  onsets: number[],
  maxErrorMs = 400
): number | null {
  let best: number | null = null;
  let bestErr = Infinity;
  for (const o of onsets) {
    const err = o - expectedStart;
    if (Math.abs(err) < Math.abs(bestErr) && Math.abs(err) <= maxErrorMs) {
      bestErr = err;
      best = err;
    }
  }
  return best;
}

export function scoreTiming(
  melodyNotes: MelodyNote[],
  samples: PitchTrackPoint[]
): TimingScore {
  if (!melodyNotes.length) {
    return {
      score: 0,
      meanAbsErrorMs: null,
      within80Pct: null,
      within150Pct: null,
      onsetErrorsMs: [],
    };
  }
  const onsets = detectOnsets(samples);
  const errors: (number | null)[] = melodyNotes.map((n) =>
    matchOnset(n.start, onsets)
  );
  const known = errors.filter((e): e is number => e != null);
  if (!known.length) {
    return {
      score: 0,
      meanAbsErrorMs: null,
      within80Pct: 0,
      within150Pct: 0,
      onsetErrorsMs: errors,
    };
  }
  const abs = known.map((e) => Math.abs(e));
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const within80 = abs.filter((e) => e <= 80).length / abs.length;
  const within150 = abs.filter((e) => e <= 150).length / abs.length;

  // 0..100: full marks if mean |err| ≤ 40ms, zero at ≥250ms
  const score = Math.round(
    Math.max(0, Math.min(100, 100 * (1 - (meanAbs - 40) / 210)))
  );

  return {
    score,
    meanAbsErrorMs: Math.round(meanAbs),
    within80Pct: Math.round(within80 * 100) / 100,
    within150Pct: Math.round(within150 * 100) / 100,
    onsetErrorsMs: errors,
  };
}

export function scoreSession(
  melodyNotes: MelodyNote[],
  samples: PitchTrackPoint[],
  opts: { withTiming?: boolean } = {}
): SessionScore {
  const withTiming = opts.withTiming ?? melodyNotes.length > 0;

  if (!melodyNotes.length) {
    // Free mode: no target — return neutral zeros
    return {
      pitchScore: 0,
      timingScore: null,
      overallScore: 0,
      avgCents: null,
      missedNotes: 0,
      noteCount: 0,
      notes: [],
      timing: null,
    };
  }

  const notes = melodyNotes.map((n, i) => scoreNote(i, n, samples));
  const pitchScore = Math.round(
    notes.reduce((a, n) => a + n.score, 0) / notes.length
  );
  const hitCents = notes.filter((n) => n.status !== 'miss').map((n) => n.meanCents);
  const avgCents = hitCents.length
    ? Math.round(
        hitCents.reduce((a, b) => a + Math.abs(b), 0) / hitCents.length
      )
    : null;
  const missedNotes = notes.filter((n) => n.status === 'miss').length;

  const timing = withTiming ? scoreTiming(melodyNotes, samples) : null;
  const timingScore = timing && timing.meanAbsErrorMs != null ? timing.score : null;

  const overallScore =
    timingScore != null
      ? Math.round(
          SCORE_WEIGHT_PITCH * pitchScore + (1 - SCORE_WEIGHT_PITCH) * timingScore
        )
      : pitchScore;

  return {
    pitchScore,
    timingScore,
    overallScore,
    avgCents,
    missedNotes,
    noteCount: melodyNotes.length,
    notes,
    timing,
  };
}

/**
 * Vibrato metrics for a held segment of pitch samples (MIDI float).
 * Returns null when too short or not oscillating.
 */
export function analyzeVibrato(
  pitches: number[],
  sampleIntervalMs: number
): { rateHz: number; depthCents: number; regularity: number } | null {
  if (pitches.length < 16 || sampleIntervalMs <= 0) {
    return null;
  }
  // Remove linear trend
  const n = pitches.length;
  const xs = pitches.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = pitches.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (pitches[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const detrended = pitches.map((y, i) => y - (meanY + slope * (i - meanX)));

  // Zero-crossing rate of detrended signal → rough rate
  let crossings = 0;
  for (let i = 1; i < detrended.length; i++) {
    if (
      (detrended[i - 1] >= 0 && detrended[i] < 0) ||
      (detrended[i - 1] < 0 && detrended[i] >= 0)
    ) {
      crossings++;
    }
  }
  const durationSec = (n * sampleIntervalMs) / 1000;
  if (durationSec <= 0) {
    return null;
  }
  const rateHz = crossings / 2 / durationSec;

  // Depth: peak-to-peak of detrended in cents
  const max = Math.max(...detrended);
  const min = Math.min(...detrended);
  const depthCents = Math.round((max - min) * 100 * 0.5); // half p-p ≈ depth

  // Regularity: how uniform absolute amplitudes are (simple CV inverse)
  const amps = detrended.map(Math.abs);
  const meanAmp = amps.reduce((a, b) => a + b, 0) / amps.length || 1;
  const variance =
    amps.reduce((a, v) => a + (v - meanAmp) ** 2, 0) / amps.length;
  const cv = Math.sqrt(variance) / meanAmp;
  const regularity = Math.max(0, Math.min(1, 1 - cv));

  if (rateHz < 3 || rateHz > 9 || depthCents < 15) {
    return null;
  }
  return {
    rateHz: Math.round(rateHz * 10) / 10,
    depthCents,
    regularity: Math.round(regularity * 100) / 100,
  };
}
