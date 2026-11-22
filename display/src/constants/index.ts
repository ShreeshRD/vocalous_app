// Notes start normally from C but we start from F note by using offset.
export const NOTE_OFFSET = 7;

// Vertical staff range in MIDI note numbers (C2–C6). No octave wrap.
export const PITCH_MIN = 36;
export const PITCH_MAX = 84;

// Pitch class 0 = C … 11 = B (MIDI % 12)
export const NATURAL_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export const NOTE_STRINGS: string[] = [
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
];

// NOTE_STRINGS starts at F (offset 7 from C). MIDI pitch class → index in NOTE_STRINGS.
export function noteStringForMidi(midi: number): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  // NOTE_STRINGS[(m + NOTE_OFFSET) % 12] when NOTE_OFFSET maps C→index of C in array
  // Array is F,F#,G,... so index for pitch class pc is (pc + 5) % 12 because C=7 is at index 7
  // Simpler: use (m + NOTE_OFFSET) % 12 as in plan
  return NOTE_STRINGS[(Math.round(midi) + NOTE_OFFSET) % 12];
}

export function octaveLabelForMidi(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function isNaturalMidi(midi: number): boolean {
  return NATURAL_PITCH_CLASSES.has(((Math.round(midi) % 12) + 12) % 12);
}

export const OCTAVE_COLORS: [number, number, number][] = [
  [121, 85, 72], // brown
  [158, 158, 158], // grey500
  [96, 125, 139], // bluegrey
  [76, 175, 80], // green
  [244, 67, 54], // red
  [33, 150, 243], // blue
  [0, 150, 136], //teal
  [255, 235, 59], // yellow
  [0, 188, 212], // cyan
];
