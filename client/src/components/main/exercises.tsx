import React, { useMemo } from 'react';
import { Button, Card, Col, Container, Row, Badge } from 'react-bootstrap';
import { PlayCircleFill } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import { useStoreActions, useStoreState } from '../../model';

export type ExerciseKind = 'scale' | 'siren' | 'hold' | 'interval' | 'range';

export interface ExerciseDef {
  id: string;
  nameKey: string;
  kind: ExerciseKind;
  build: () => { start: number; duration: number; pitch: number }[];
}

// Beginner pace: long notes + clear rests (plan Step 4)
const LEAD_IN_MS = 2000;

function buildScale(root = 60) {
  const steps = [0, 2, 4, 5, 7, 9, 11, 12];
  const notes: number[] = [];
  for (const s of steps) notes.push(root + s);
  for (const s of [...steps].reverse()) notes.push(root + s);
  const dur = 1200;
  const rest = 600;
  const stride = dur + rest;
  return notes.map((pitch, i) => ({
    start: LEAD_IN_MS + i * stride,
    duration: dur,
    pitch,
  }));
}

function buildSiren(root = 55) {
  const out = [];
  const stepMs = 500;
  for (let i = 0; i <= 24; i++) {
    out.push({
      start: LEAD_IN_MS + i * stepMs,
      duration: stepMs,
      pitch: root + i,
    });
  }
  return out;
}

function buildHold(root = 60) {
  const dur = 2500;
  const rest = 1000;
  const stride = dur + rest;
  return [
    { start: LEAD_IN_MS, duration: dur, pitch: root },
    { start: LEAD_IN_MS + stride, duration: dur, pitch: root + 7 },
    { start: LEAD_IN_MS + 2 * stride, duration: dur, pitch: root + 12 },
  ];
}

function buildInterval(root = 60) {
  const intervals = [0, 4, 7, 12, 7, 4, 0];
  const dur = 1200;
  const rest = 800;
  const stride = dur + rest;
  return intervals.map((iv, i) => ({
    start: LEAD_IN_MS + i * stride,
    duration: dur,
    pitch: root + iv,
  }));
}

function buildRange() {
  const out = [];
  const dur = 900;
  const rest = 400;
  const stride = dur + rest;
  for (let p = 48; p <= 84; p++) {
    out.push({
      start: LEAD_IN_MS + (p - 48) * stride,
      duration: dur,
      pitch: p,
    });
  }
  return out;
}

export const EXERCISES: ExerciseDef[] = [
  { id: 'scale', nameKey: 'EX.SCALE', kind: 'scale', build: () => buildScale(60) },
  { id: 'siren', nameKey: 'EX.SIREN', kind: 'siren', build: () => buildSiren(55) },
  { id: 'hold', nameKey: 'EX.HOLD', kind: 'hold', build: () => buildHold(60) },
  {
    id: 'interval',
    nameKey: 'EX.INTERVAL',
    kind: 'interval',
    build: () => buildInterval(60),
  },
  { id: 'range', nameKey: 'EX.RANGE', kind: 'range', build: () => buildRange() },
];

function frequencyFromMidi(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playReferenceTone(midi: number, ms = 400) {
  try {
    const ctx = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequencyFromMidi(midi);
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
    osc.stop(ctx.currentTime + ms / 1000 + 0.05);
    osc.onended = () => ctx.close();
  } catch (e) {
    console.warn('Audio reference failed', e);
  }
}

function midiName(m: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export default function Exercises() {
  const { t } = useTranslation();
  const { setMelodyNotes, setMelodyTitle, initializeStream, setEnabled } =
    useStoreActions((actions) => actions);
  const loaded = useStoreState((state) => state.loaded);
  const sessions = useStoreState((state) => state.sessions);
  const melodyTitle = useStoreState((state) => state.melody.title);

  const bestByExercise = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (s.source !== 'exercise' || s.overallScore == null) continue;
      const prev = map.get(s.title) ?? 0;
      if (s.overallScore > prev) map.set(s.title, s.overallScore);
    }
    return map;
  }, [sessions]);

  const startExercise = async (ex: ExerciseDef) => {
    const notes = ex.build();
    setMelodyNotes(notes);
    setMelodyTitle(t(ex.nameKey));
    if (!loaded) {
      await initializeStream();
    }
    setEnabled(true);
  };

  const inSession = useStoreState((state) => state.loaded && state.enabled);

  return (
    <Container className="pb-4">
      <Row className="mb-3">
        <Col>
          <h3>{t('EX.TITLE')}</h3>
          <p className="text-muted">{t('EX.HELP')}</p>
        </Col>
      </Row>

      {inSession && (
        <Row className="mb-3">
          <Col>
            <Card body className="bg-light text-center">
              {t('EX.RUNNING')}: <strong>{melodyTitle}</strong>
              <div className="small text-muted mt-1">{t('EX.RUNNING_HINT')}</div>
            </Card>
          </Col>
        </Row>
      )}

      <Row xs={1} md={2} className="g-3">
        {EXERCISES.map((ex) => (
          <Col key={ex.id}>
            <Card>
              <Card.Body>
                <Card.Title>{t(ex.nameKey)}</Card.Title>
                <Card.Text className="small text-muted">
                  {t(`EX.${ex.kind.toUpperCase()}_DESC`)}
                </Card.Text>
                <div className="small mb-2">
                  {t('EX.BEST')}:{' '}
                  {bestByExercise.get(t(ex.nameKey)) != null ? (
                    <Badge bg="success">
                      {bestByExercise.get(t(ex.nameKey))}%
                    </Badge>
                  ) : (
                    '—'
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={() => startExercise(ex)}
                  disabled={inSession}
                >
                  <PlayCircleFill className="me-1" />
                  {t('EX.START')}
                </Button>
                {ex.kind !== 'range' && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="ms-2"
                    onClick={() => {
                      const n = ex.build()[0];
                      if (n) playReferenceTone(n.pitch, 500);
                    }}
                  >
                    {t('EX.PLAY_REF')}
                  </Button>
                )}
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Row className="mt-4">
        <Col className="text-muted small">
          {t('EX.RANGE_RESULT')}: {midiName(48)}–{midiName(84)}{' '}
          {t('EX.RANGE_HINT')}
        </Col>
      </Row>
    </Container>
  );
}
