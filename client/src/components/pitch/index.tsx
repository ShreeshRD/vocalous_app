import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navbar, Popover, OverlayTrigger, Modal, Button, Badge, Table, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { PitchDisplay } from 'pitch-display';

import {
  ForwardButton,
  PauseButton,
  SkipStartButton,
  StopButton,
} from '../button';
import { BACKGROUND } from '../../constants/colors';
import { useStoreActions, useStoreState } from '../../model';
import {
  appendPitchTrack,
  startPitchTrack,
  stopPitchTrack,
  PitchTrackPoint,
} from '../../services/pitchTrack';
import { scoreSession, SessionScore, NoteAttempt } from '../../services/scoring';
import { SessionRecord, SessionNoteResult } from '../../services/storage';
import { LyricsBar } from './lyrics';
import { analyzeVibrato } from '../../services/scoring';

function midiToNoteName(midi: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const n = Math.round(midi);
  const name = names[((n % 12) + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
}

function foldToNearest(pitch: number, target: number): number {
  let diff = (pitch - target) % 12;
  if (diff > 6) diff -= 12;
  else if (diff < -6) diff += 12;
  return target + diff;
}

const useAnimationFrame = (callback: (time: number) => void) => {
  const requestRef = useRef<number>();
  // Always invoke the latest callback so freq/clarity updates are not stuck on mount
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const animate = (time: number) => {
      callbackRef.current(time);
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);
};

export interface PitchProps {
  freq: number | null;
  clarity: number | null;
  rms?: number | null;
}

function statusBadgeClass(status: SessionNoteResult['status']): string {
  if (status === 'hit') return 'bg-success';
  if (status === 'weak') return 'bg-warning text-dark';
  return 'bg-danger';
}

function ScoreSummary({
  score,
  title,
  range,
  vibrato,
  onClose,
}: {
  score: SessionScore;
  title: string;
  range?: { low: number; high: number } | null;
  vibrato?: { rateHz: number; depthCents: number; regularity: number } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<NoteAttempt | null>(null);

  return (
    <Modal show onHide={onClose} centered size="lg" className="score-summary">
      <Modal.Header closeButton>
        <Modal.Title>
          {t('SCORE.TITLE')} — {title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex flex-wrap gap-3 mb-3 justify-content-center">
          <div className="text-center px-3">
            <div className="display-6">{score.overallScore}%</div>
            <div className="text-muted small">{t('SCORE.OVERALL')}</div>
          </div>
          <div className="text-center px-3">
            <div className="display-6">{score.pitchScore}%</div>
            <div className="text-muted small">{t('SCORE.PITCH')}</div>
          </div>
          <div className="text-center px-3">
            <div className="display-6">
              {score.timingScore != null ? `${score.timingScore}%` : '—'}
            </div>
            <div className="text-muted small">{t('SCORE.TIMING')}</div>
          </div>
          <div className="text-center px-3">
            <div className="display-6">
              {score.avgCents != null ? `${score.avgCents}¢` : '—'}
            </div>
            <div className="text-muted small">{t('SCORE.AVG_CENTS')}</div>
          </div>
          <div className="text-center px-3">
            <div className="display-6">
              {score.missedNotes}/{score.noteCount}
            </div>
            <div className="text-muted small">{t('SCORE.MISSED')}</div>
          </div>
        </div>

        {score.timing?.meanAbsErrorMs != null && (
          <p className="text-center text-muted">
            {t('SCORE.ONSET_MEAN')}: {score.timing.meanAbsErrorMs} ms ·{' '}
            {t('SCORE.WITHIN_80')}: {Math.round((score.timing.within80Pct || 0) * 100)}%
          </p>
        )}

        {range && (
          <p className="text-center">
            <Badge bg="info" className="me-2">
              {t('EX.RANGE_LOW')}: {midiToNoteName(range.low)}
            </Badge>
            <Badge bg="info">
              {t('EX.RANGE_HIGH')}: {midiToNoteName(range.high)}
            </Badge>
          </p>
        )}

        {vibrato && (
          <p className="text-center text-muted small">
            {t('SCORE.VIBRATO')}: {vibrato.rateHz} Hz · {vibrato.depthCents}¢ ·{' '}
            {t('SCORE.REGULARITY')}: {Math.round(vibrato.regularity * 100)}%
          </p>
        )}

        <div className="note-ribbon d-flex flex-wrap gap-1 mb-3">
          {score.notes.map((n) => (
            <button
              key={n.index}
              type="button"
              className={`btn btn-sm ${statusBadgeClass(n.status)}`}
              title={`#${n.index + 1} · ${n.score}% · ${n.meanCents}¢`}
              onClick={() => setSelected(n)}
            >
              {n.index + 1}
            </button>
          ))}
        </div>

        {selected && (
          <div className="border rounded p-2 mb-2 bg-light">
            <strong>
              {t('SCORE.NOTE')}: #{selected.index + 1}
            </strong>{' '}
            <Badge bg="secondary">{midiToNoteName(selected.pitch)}</Badge>
            <div className="small">
              {t('SCORE.SCORE')}: {selected.score}% · {t('SCORE.MEAN_CENTS')}:{' '}
              {selected.meanCents}¢ · {t('SCORE.HOLD')}:{' '}
              {Math.round(selected.holdRatio * 100)}% ·{' '}
              {t('SCORE.COVERAGE')}: {Math.round(selected.coverage * 100)}%
            </div>
            {selected.samples.length > 0 && (
              <div className="mt-2" style={{ height: 80 }}>
                <svg
                  width="100%"
                  height="80"
                  viewBox={`0 0 ${Math.max(selected.samples.length, 2)} 40`}
                  preserveAspectRatio="none"
                >
                  <line x1="0" y1="20" x2={selected.samples.length} y2="20" stroke="#ccc" />
                  {selected.samples.map((s, i) => {
                    const y = 20 - Math.max(-20, Math.min(20, s.cents / 5));
                    return (
                      <circle
                        key={i}
                        cx={i + 0.5}
                        cy={y}
                        r={0.6}
                        fill={
                          Math.abs(s.cents) <= 50
                            ? '#4caf50'
                            : Math.abs(s.cents) <= 100
                              ? '#ff9800'
                              : '#f44336'
                        }
                      />
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        )}

        {score.notes.length > 0 && (
          <Table size="sm" responsive className="small align-middle">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('SCORE.STATUS')}</th>
                <th>{t('SCORE.SCORE')}</th>
                <th>{t('SCORE.MEAN_CENTS')}</th>
                <th>{t('SCORE.HOLD')}</th>
              </tr>
            </thead>
            <tbody>
              {score.notes.slice(0, 40).map((n) => (
                <tr key={n.index}>
                  <td>{n.index + 1}</td>
                  <td>
                    <Badge className={statusBadgeClass(n.status)}>
                      {t(`SCORE.STATUS_${n.status.toUpperCase()}`)}
                    </Badge>
                  </td>
                  <td>{n.score}%</td>
                  <td>{n.meanCents}¢</td>
                  <td>{Math.round(n.holdRatio * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          {t('OK')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function PracticeHud({
  freq,
  rms,
  melodyNotes,
  songPos,
}: {
  freq: number | null;
  rms: number | null;
  melodyNotes: { start: number; duration: number; pitch: number }[];
  songPos: number | null;
}) {
  const { t } = useTranslation();
  const midi = freq && freq > 0 ? 69 + 12 * Math.log2(freq / 440) : null;
  const noteLabel = midi != null ? midiToNoteName(midi) : '—';

  let cents: number | null = null;
  if (midi != null && melodyNotes.length && songPos != null) {
    // nearest melody note by time window (midpoints between notes)
    let target: number | null = null;
    for (let i = 0; i < melodyNotes.length; i++) {
      const n = melodyNotes[i];
      const prev = melodyNotes[i - 1];
      const next = melodyNotes[i + 1];
      const start = prev ? (prev.start + prev.duration + n.start) / 2 : n.start - 400;
      const end = next ? (n.start + n.duration + next.start) / 2 : n.start + n.duration + 400;
      if (songPos >= start && songPos < end) {
        target = n.pitch;
        break;
      }
    }
    if (target != null) {
      const folded = foldToNearest(midi, target);
      cents = Math.round((folded - target) * 100);
    }
  }

  const level = Math.min(1, (rms || 0) * 4);
  const levelColor =
    (rms || 0) > 0.35 ? '#ff9800' : (rms || 0) < 0.01 ? '#9e9e9e' : '#4caf50';

  return (
    <div className="practice-hud unselectable" data-testid="practice-hud">
      <div className="practice-hud-note">{noteLabel}</div>
      {cents != null && (
        <div className="practice-hud-cents">
          {cents > 0 ? `+${cents}` : cents}¢
        </div>
      )}
      <div className="practice-hud-level" title={t('HUD.LEVEL')}>
        <div
          className="practice-hud-level-fill"
          style={{ width: `${Math.round(level * 100)}%`, background: levelColor }}
        />
      </div>
    </div>
  );
}

function FirstRunTip() {
  const { t } = useTranslation();
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem('vocalous.tipSeen') !== '1';
    } catch {
      return true;
    }
  });
  if (!show) {
    return null;
  }
  const dismiss = () => {
    try {
      localStorage.setItem('vocalous.tipSeen', '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <Alert variant="info" className="first-run-tip unselectable" onClose={dismiss} dismissible>
      <strong>{t('TIP.TITLE')}</strong>
      <ul className="mb-0 small">
        <li>{t('TIP.1')}</li>
        <li>{t('TIP.2')}</li>
        <li>{t('TIP.3')}</li>
      </ul>
    </Alert>
  );
}

function PitchComponent({ freq, clarity, rms }: PitchProps) {
  const { t } = useTranslation();
  const pitchDisplay = useRef<any>(undefined);
  const [inIntro, setInIntro] = useState(false);
  const [summary, setSummary] = useState<SessionScore | null>(null);
  const [summaryTitle, setSummaryTitle] = useState('');
  const [summaryRange, setSummaryRange] = useState<{ low: number; high: number } | null>(
    null
  );
  const [summaryVibrato, setSummaryVibrato] = useState<{
    rateHz: number;
    depthCents: number;
    regularity: number;
  } | null>(null);
  const [hudSongPos, setHudSongPos] = useState<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const notes = useStoreState((state) => state.melody.notes);
  const melodyTitle = useStoreState((state) => state.melody.title);
  const hasNotes = notes && notes.length;
  const sidecarAvailable = useStoreState((state) => state.sidecarAvailable);
  const { stopStream, setEnabled, appendSession, probeSidecar } =
    useStoreActions((actions) => actions);

  // Start collecting pitch track when this practice UI mounts
  useEffect(() => {
    startPitchTrack();
    startedAtRef.current = Date.now();
    probeSidecar();
    return () => {
      stopPitchTrack();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Record each rendered sample with song position
  useEffect(() => {
    if (!freq || freq <= 0) {
      return;
    }
    const time = Date.now();
    const pitchDisplayInst = pitchDisplay.current;
    const songPos = pitchDisplayInst
      ? pitchDisplayInst.getSongPos(time)
      : null;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const point: PitchTrackPoint = {
      t: time,
      songPos,
      pitch: midi,
      freq,
      clarity: clarity || 0,
      rms: rms || 0,
    };
    appendPitchTrack(point);
  }, [freq, clarity, rms]);

  const updatePitch = useCallback(() => {
    if (!pitchDisplay.current) {
      return;
    }

    if (freq && freq > 0) {
      const time = Date.now();
      pitchDisplay.current.pushFrequency({
        frequency: freq,
        clarity: clarity || 0,
        time,
        rms: rms ?? 0,
      });
    }
    pitchDisplay.current.render(false);
    setHudSongPos(pitchDisplay.current.getSongPos?.() ?? null);
  }, [clarity, freq, rms]);

  // Keep rendering and scrolling pitchDisplay at regular time intervals
  // even though the note has not changed (callback ref keeps freq fresh)
  useAnimationFrame(updatePitch);

  useEffect(() => {
    const onResize = () => {
      if (pitchDisplay.current) {
        pitchDisplay.current.resize();
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (pitchDisplay.current && notes) {
      pitchDisplay.current.setMelodyNotes(notes);
    }
  }, [notes]);

  const btnSize = 50;
  const btnColor = BACKGROUND;
  const btnColorPressed = '#a6a8aa';

  const onDisplayRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (element && !pitchDisplay.current) {
        pitchDisplay.current = new PitchDisplay(element, 6000);
        pitchDisplay.current.setBackgroundColor(BACKGROUND);
        if (notes) {
          pitchDisplay.current.setMelodyNotes(notes);
        }
        pitchDisplay.current.playSong();
      }
    },
    [notes]
  );

  useEffect(() => {
    if (pitchDisplay.current) {
      return pitchDisplay.current.subscribeToIntroState((val: boolean) =>
        setInIntro(val)
      );
    }
  }, []);

  const onStop = async () => {
    const samples = stopPitchTrack();
    const durationMs = Date.now() - (startedAtRef.current || Date.now());
    const melodyNotes = hasNotes ? notes : [];

    if (melodyNotes.length && samples.length) {
      const score = scoreSession(melodyNotes, samples, { withTiming: true });
      let range: { low: number; high: number } | null = null;
      {
        const voiced = samples.filter(
          (s) => s.pitch != null && s.clarity >= 0.55 && (s.rms || 0) > 0.01
        );
        if (voiced.length > 8) {
          const sorted = voiced.map((s) => s.pitch as number).sort((a, b) => a - b);
          range = {
            low: Math.round(sorted[Math.floor(sorted.length * 0.1)]),
            high: Math.round(sorted[Math.floor(sorted.length * 0.9)]),
          };
        }
      }

      // Vibrato on long held targets
      let vibrato: { rateHz: number; depthCents: number; regularity: number } | null =
        null;
      const longNote = melodyNotes.find((n) => n.duration >= 400);
      if (longNote) {
        const seg = samples.filter(
          (s) =>
            s.songPos != null &&
            s.songPos >= longNote.start &&
            s.songPos < longNote.start + longNote.duration &&
            s.pitch != null &&
            s.clarity >= 0.5
        );
        if (seg.length >= 16) {
          const pitches = seg.map((s) => s.pitch as number);
          const avgDt =
            (seg[seg.length - 1].songPos! - seg[0].songPos!) / (seg.length - 1);
          vibrato = analyzeVibrato(pitches, avgDt || 20);
        }
      }

      const record: SessionRecord = {
        id: `${Date.now()}`,
        startedAt: startedAtRef.current || Date.now(),
        durationMs,
        source: melodyNotes.length ? 'song' : 'free',
        title: melodyTitle || t('SCORE.UNTITLED'),
        pitchScore: score.pitchScore,
        timingScore: score.timingScore,
        overallScore: score.overallScore,
        avgCents: score.avgCents,
        missedNotes: score.missedNotes,
        noteCount: score.noteCount,
        notes: score.notes.map(({ samples: _s, ...rest }) => rest),
      };
      appendSession(record);
      setSummaryTitle(record.title);
      setSummaryRange(range);
      setSummaryVibrato(vibrato);
      setSummary(score);
    }

    setEnabled(false);
    await stopStream();
    console.log('Stream Stopped');
  };

  const skipIntroTitle = t('SKIP.TITLE');
  const skipIntroBody = t('SKIP.BODY');
  const skipIntroPopover = (
    <Popover id="popover-skip-intro" className="unselectable">
      <Popover.Header as="h3">{skipIntroTitle}</Popover.Header>
      <Popover.Body>{skipIntroBody}</Popover.Body>
    </Popover>
  );

  return (
    <React.Fragment>
      <div className="full unselectable" ref={onDisplayRef} />
      <PracticeHud
        freq={freq}
        rms={rms ?? null}
        melodyNotes={notes}
        songPos={hudSongPos}
      />
      <FirstRunTip />
      <LyricsBar
        getSongPos={() =>
          pitchDisplay.current ? pitchDisplay.current.getSongPos() : null
        }
      />
      <div className="navbar-space unselectable" />
      <Navbar
        fixed="bottom"
        bg="dark"
        className="justify-content-center unselectable"
      >
        {hasNotes && (
          <OverlayTrigger
            show={inIntro}
            placement="top"
            overlay={skipIntroPopover}
          >
            <SkipStartButton
              onPress={() => pitchDisplay.current?.seekToFirstNote()}
              onRelease={() => pitchDisplay.current?.playSong()}
              onCancel={() => pitchDisplay.current?.playSong()}
              className="btn-skip-start"
              size={btnSize}
              color={btnColor}
              colorPressed={btnColorPressed}
              inIntro={inIntro}
            />
          </OverlayTrigger>
        )}
        {hasNotes && (
          <PauseButton
            onPress={() => pitchDisplay.current?.pauseSong()}
            onRelease={() => pitchDisplay.current?.playSong()}
            onCancel={() => pitchDisplay.current?.playSong()}
            className="btn-pause"
            size={btnSize}
            color={btnColor}
            colorPressed={btnColorPressed}
          />
        )}
        <StopButton
          onRelease={onStop}
          className="btn-stop"
          size={btnSize}
          color={btnColor}
          colorPressed={btnColorPressed}
        />
        {hasNotes && (
          <ForwardButton
            onPress={() => pitchDisplay.current?.fastForwardSong()}
            onRelease={() => pitchDisplay.current?.playSong()}
            onCancel={() => pitchDisplay.current?.playSong()}
            className="btn-forward"
            size={btnSize}
            color={btnColor}
            colorPressed={btnColorPressed}
          />
        )}
      </Navbar>

      {summary && (
        <ScoreSummary
          score={summary}
          title={summaryTitle}
          range={summaryRange}
          vibrato={summaryVibrato}
          onClose={() => setSummary(null)}
        />
      )}
      {sidecarAvailable && (
        <span className="sidecar-dot" title="Local voice tools online" />
      )}
    </React.Fragment>
  );
}

export default PitchComponent;
