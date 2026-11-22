import {
  action,
  Action,
  createStore,
  createTypedHooks,
  thunk,
  Thunk,
} from 'easy-peasy';
import { ParentHandshake, WorkerMessenger } from 'post-me';

import {
  AppSettings,
  loadSettings,
  micConstraintsFor,
  MicPreset,
  saveSettings,
  SessionRecord,
  loadSessions,
  saveSession,
} from './services/storage';
import { isSidecarAvailable } from './services/sidecar';

type Detector = 'mcleod' | 'autocorrelation';

type ErrorType = 'audio-context' | 'mic-stream' | 'worker';

interface IMelodyNote {
  start: number;
  duration: number;
  pitch: number;
}

type IMelodyNotes = IMelodyNote[];

interface Melody {
  title: string;
  notes: IMelodyNotes;
  lines?: MelodyLyricLine[];
}

export interface MelodyLyricLine {
  start: number;
  duration: number;
  text: string;
  syllables?: { start: number; duration: number; text: string }[];
}

interface StoreModel {
  windowSize: number;
  setWindowSize: Action<StoreModel, number>;

  detectorName: Detector;
  setDetectorName: Action<StoreModel, Detector>;

  clarityThreshold: number;
  setClarityThreshold: Action<StoreModel, number>;

  micPreset: MicPreset;
  setMicPreset: Action<StoreModel, MicPreset>;

  enabled: boolean;
  setEnabled: Action<StoreModel, boolean>;

  stream: MediaStream | null | undefined;
  audioOptions: MediaStreamConstraints;
  setStream: Action<StoreModel, MediaStream | null>;
  loading: boolean;
  setLoading: Action<StoreModel, boolean>;
  loaded: boolean;
  setLoaded: Action<StoreModel, boolean>;
  initializeStream: Thunk<StoreModel, void>;
  stopStream: Thunk<StoreModel, void>;

  workerConnection: any;
  setWorkerConnection: Action<StoreModel, any>;
  initializeWorker: Thunk<StoreModel, void>;

  checkAudioContextSupport: Thunk<StoreModel, void>;
  setError: Action<StoreModel, ErrorType | null>;

  melody: Melody;
  setMelodyNotes: Action<StoreModel, IMelodyNotes>;
  setMelodyLines: Action<StoreModel, MelodyLyricLine[] | undefined>;
  setMelodyTitle: Action<StoreModel, string>;

  sessions: SessionRecord[];
  refreshSessions: Action<StoreModel, SessionRecord[]>;
  appendSession: Thunk<StoreModel, SessionRecord>;

  sidecarAvailable: boolean;
  setSidecarAvailable: Action<StoreModel, boolean>;
  probeSidecar: Thunk<StoreModel, void>;

  error: ErrorType | null;
}

function initialSettings(): AppSettings {
  return loadSettings();
}

const initial = initialSettings();

export const store = createStore<StoreModel>({
  windowSize: initial.windowSize,
  detectorName: initial.detectorName,
  clarityThreshold: initial.clarityThreshold,
  micPreset: initial.micPreset,
  enabled: false,
  loading: false,
  loaded: false,
  stream: null,
  audioOptions: micConstraintsFor(initial.micPreset),
  workerConnection: null,
  melody: { title: '', notes: [] },
  sessions: loadSessions(),
  sidecarAvailable: false,
  error: null,

  setWindowSize: action((state, payload) => {
    state.windowSize = payload;
    persistSettings(state);
  }),
  setDetectorName: action((state, payload) => {
    state.detectorName = payload;
    persistSettings(state);
  }),
  setClarityThreshold: action((state, payload) => {
    state.clarityThreshold = payload;
    persistSettings(state);
  }),
  setMicPreset: action((state, payload) => {
    state.micPreset = payload;
    state.audioOptions = micConstraintsFor(payload);
    persistSettings(state);
  }),
  setEnabled: action((state, payload) => {
    state.enabled = payload;
  }),
  setStream: action((state, payload) => {
    state.stream = payload;
  }),
  setLoading: action((state, payload) => {
    state.loading = payload;
  }),
  setLoaded: action((state, payload) => {
    state.loaded = payload;
  }),
  setWorkerConnection: action((state, payload) => {
    state.workerConnection = payload;
  }),
  setError: action((state, payload) => {
    state.error = payload;
  }),
  checkAudioContextSupport: thunk((actions) => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext === undefined) {
      actions.setError('audio-context');
      console.error('Browser does not have window.AudioContext support');
    }
  }),
  initializeStream: thunk(async (actions, payload, { getState }) => {
    const state = getState();
    const options = state.audioOptions;

    actions.setLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(options);
      actions.setStream(stream);
      actions.setLoading(false);
      actions.setLoaded(true);
    } catch (e) {
      actions.setError('mic-stream');
      console.error(e);
      actions.setStream(null);
      actions.setLoading(false);
      actions.setLoaded(false);
    }
  }),
  stopStream: thunk(async (actions, payload, { getState }) => {
    const stream = getState().stream;

    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }

    actions.setStream(null);
    actions.setLoading(false);
    actions.setLoaded(false);
  }),
  initializeWorker: thunk(async (actions) => {
    const worker = new Worker(
      `${import.meta.env.BASE_URL}pitch-detection/worker.js`
    );

    const messenger = new WorkerMessenger({ worker });

    try {
      const connection = await ParentHandshake(messenger, {}, 5, 1000);
      actions.setWorkerConnection(connection);
    } catch (e) {
      actions.setError('worker');
      console.error('Failed to connect to worker', e);
      actions.setWorkerConnection(null);
    }
  }),

  setMelodyNotes: action((state, payload) => {
    state.melody.notes = payload;
  }),
  setMelodyLines: action((state, payload) => {
    state.melody.lines = payload;
  }),
  setMelodyTitle: action((state, payload) => {
    state.melody.title = payload;
  }),

  refreshSessions: action((state, payload) => {
    state.sessions = payload;
  }),
  appendSession: thunk((actions, payload) => {
    const next = saveSession(payload);
    actions.refreshSessions(next);
  }),

  setSidecarAvailable: action((state, payload) => {
    state.sidecarAvailable = payload;
  }),
  probeSidecar: thunk(async (actions) => {
    const ok = await isSidecarAvailable();
    actions.setSidecarAvailable(ok);
  }),
});

function persistSettings(state: {
  windowSize: number;
  detectorName: Detector;
  clarityThreshold: number;
  micPreset: MicPreset;
}) {
  saveSettings({
    windowSize: state.windowSize,
    detectorName: state.detectorName,
    clarityThreshold: state.clarityThreshold,
    micPreset: state.micPreset,
  });
}

const typedHooks = createTypedHooks<StoreModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;
