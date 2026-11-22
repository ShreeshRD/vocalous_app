// Local persistence for settings and session history (no backend).

export type MicPreset = 'studio' | 'laptop';

export interface SessionNoteResult {
  index: number;
  start: number;
  duration: number;
  pitch: number;
  score: number;
  meanCents: number;
  holdRatio: number;
  coverage: number;
  onsetErrorMs: number | null;
  status: 'hit' | 'miss' | 'weak';
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  durationMs: number;
  source: 'song' | 'free' | 'exercise';
  title: string;
  pitchScore: number | null;
  timingScore: number | null;
  overallScore: number | null;
  avgCents: number | null;
  missedNotes: number;
  noteCount: number;
  notes?: SessionNoteResult[];
}

export interface AppSettings {
  micPreset: MicPreset;
  detectorName: 'mcleod' | 'autocorrelation';
  windowSize: number;
  clarityThreshold: number;
}

const SETTINGS_KEY = 'vocalous.settings.v1';
const SESSIONS_KEY = 'vocalous.sessions.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  micPreset: 'studio',
  detectorName: 'mcleod',
  windowSize: 2048,
  clarityThreshold: 0.8,
};

export function micConstraintsFor(preset: MicPreset): MediaStreamConstraints {
  if (preset === 'laptop') {
    return {
      audio: {
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true,
      },
    };
  }
  // Studio: keep dynamics (no AGC/echo) but leave browser noise suppression ON
  // so room tone does not become spurious pitch dots. AGC/echo still hurt
  // singing more than NS does.
  return {
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: true,
    },
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings', e);
  }
}

export function loadSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSession(record: SessionRecord): SessionRecord[] {
  const sessions = loadSessions();
  sessions.unshift(record);
  // Keep last 200
  const trimmed = sessions.slice(0, 200);
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Failed to save session', e);
  }
  return trimmed;
}

export function clearSessions(): void {
  try {
    localStorage.removeItem(SESSIONS_KEY);
  } catch (e) {
    console.warn('Failed to clear sessions', e);
  }
}
