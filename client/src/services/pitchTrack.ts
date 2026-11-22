// Pitch sample collected during a practice session (song-relative when melody present).

export interface PitchTrackPoint {
  /** Wall-clock ms */
  t: number;
  /** Song position ms (from PitchDisplay clock); null in free mode before clock starts */
  songPos: number | null;
  /** MIDI note number (fractional, includes cents) */
  pitch: number | null;
  /** Raw frequency Hz when detected, else null */
  freq: number | null;
  clarity: number;
  /** RMS of analysis window 0..1 */
  rms: number;
}

let points: PitchTrackPoint[] = [];
let collecting = false;

export function startPitchTrack(): void {
  points = [];
  collecting = true;
}

export function stopPitchTrack(): PitchTrackPoint[] {
  collecting = false;
  return points.slice();
}

export function isCollectingPitchTrack(): boolean {
  return collecting;
}

export function appendPitchTrack(point: PitchTrackPoint): void {
  if (!collecting) {
    return;
  }
  // Cap ~10 minutes at ~60 Hz
  if (points.length > 36000) {
    return;
  }
  points.push(point);
}

export function getPitchTrack(): PitchTrackPoint[] {
  return points;
}
