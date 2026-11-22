import React, { useMemo, useState } from 'react';
import { Button, Card, Col, Container, Row, Table, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useStoreActions, useStoreState } from '../../model';
import { loadSessions, clearSessions, SessionRecord } from '../../services/storage';

function scoreBadge(score: number | null): React.ReactNode {
  if (score == null) return <span>—</span>;
  const variant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  return <Badge bg={variant}>{score}%</Badge>;
}

export default function History() {
  const { t } = useTranslation();
  const sessions = useStoreState((state) => state.sessions);
  const { refreshSessions } = useStoreActions((actions) => actions);
  const [selected, setSelected] = useState<SessionRecord | null>(null);

  const list = sessions.length ? sessions : loadSessions();

  const trend = useMemo(() => {
    const withScore = list
      .filter((s) => s.pitchScore != null)
      .slice(0, 20)
      .reverse();
    return withScore;
  }, [list]);

  const best = useMemo(() => {
    let b: SessionRecord | null = null;
    for (const s of list) {
      if (s.overallScore != null && (!b || s.overallScore > (b.overallScore ?? 0))) {
        b = s;
      }
    }
    return b;
  }, [list]);

  const onClear = () => {
    clearSessions();
    refreshSessions([]);
    setSelected(null);
  };

  return (
    <Container className="pb-4">
      <Row className="mb-3">
        <Col>
          <h3>{t('HISTORY.TITLE')}</h3>
          {best && (
            <p className="text-muted">
              {t('HISTORY.BEST')}: <strong>{best.overallScore}%</strong> —{' '}
              {best.title}
            </p>
          )}
        </Col>
      </Row>

      {trend.length > 1 && (
        <Row className="mb-3">
          <Col>
            <Card body>
              <div className="small text-muted mb-1">{t('HISTORY.TREND')}</div>
              <svg width="100%" height="80" viewBox={`0 0 ${trend.length * 10} 40`} preserveAspectRatio="none">
                {trend.map((s, i) => {
                  const h = ((s.pitchScore || 0) / 100) * 36;
                  return (
                    <rect
                      key={s.id}
                      x={i * 10 + 1}
                      y={40 - h}
                      width={8}
                      height={h}
                      fill="#3f51b5"
                      opacity={0.75}
                    />
                  );
                })}
              </svg>
            </Card>
          </Col>
        </Row>
      )}

      <Row>
        <Col>
          {list.length === 0 ? (
            <p className="text-muted">{t('HISTORY.EMPTY')}</p>
          ) : (
            <Table size="sm" responsive hover className="align-middle">
              <thead>
                <tr>
                  <th>{t('HISTORY.DATE')}</th>
                  <th>{t('HISTORY.TITLE_COL')}</th>
                  <th>{t('SCORE.OVERALL')}</th>
                  <th>{t('SCORE.PITCH')}</th>
                  <th>{t('SCORE.TIMING')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.startedAt).toLocaleString()}</td>
                    <td>{s.title}</td>
                    <td>{scoreBadge(s.overallScore)}</td>
                    <td>{scoreBadge(s.pitchScore)}</td>
                    <td>{scoreBadge(s.timingScore)}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => setSelected(s)}
                      >
                        {t('HISTORY.DETAIL')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {list.length > 0 && (
            <Button variant="outline-danger" size="sm" onClick={onClear}>
              {t('HISTORY.CLEAR')}
            </Button>
          )}
        </Col>
      </Row>

      {selected && (
        <Row className="mt-3">
          <Col>
            <Card>
              <Card.Header>
                {selected.title} — {new Date(selected.startedAt).toLocaleString()}
              </Card.Header>
              <Card.Body className="small">
                <div>
                  {t('SCORE.OVERALL')}: {selected.overallScore ?? '—'}% ·{' '}
                  {t('SCORE.PITCH')}: {selected.pitchScore ?? '—'}% ·{' '}
                  {t('SCORE.TIMING')}: {selected.timingScore ?? '—'}% ·{' '}
                  {t('SCORE.AVG_CENTS')}: {selected.avgCents ?? '—'}¢ ·{' '}
                  {t('SCORE.MISSED')}: {selected.missedNotes}/{selected.noteCount}
                </div>
                {selected.notes && selected.notes.length > 0 && (
                  <div className="note-ribbon d-flex flex-wrap gap-1 mt-2">
                    {selected.notes.map((n) => (
                      <span
                        key={n.index}
                        className={`badge ${
                          n.status === 'hit'
                            ? 'bg-success'
                            : n.status === 'weak'
                              ? 'bg-warning text-dark'
                              : 'bg-danger'
                        }`}
                      >
                        {n.index + 1}
                      </span>
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </Container>
  );
}
