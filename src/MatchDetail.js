import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import fixtures from './data/fixtures.json';
import { usePoints } from './PointsContext';
import './MatchDetail.css';

const BETTABLE = ['SCHEDULED', 'TIMED'];
const API_BASE = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const MatchDetail = () => {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const staticMatch = fixtures.find((f) => f.id === Number(matchId)) || null;
  const [match, setMatch] = useState(staticMatch);
  const [loading, setLoading] = useState(!staticMatch);
  const [error, setError] = useState(null);

  // 1x2 prediction state
  const [sel, setSel] = useState(null);        // 'home' | 'draw' | 'away'
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const { predictions, submitPrediction } = usePoints();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const matchRes = await axios.get(`${API_BASE}/matches/${matchId}`);
        setMatch(matchRes.data);
      } catch {
        if (!staticMatch) setError('Failed to load match details.');
        // else: keep showing the static fixture (teams/date) with no live score
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const scoreMatchesOutcome = (outcome, home, away) =>
    (outcome === 'home' && home > away) ||
    (outcome === 'away' && away > home) ||
    (outcome === 'draw' && home === away);

  const hasScoreInput = homeScore !== '' || awayScore !== '';
  const hasCompleteScore = homeScore !== '' && awayScore !== '';
  const scoreIsInvalid = hasScoreInput && !hasCompleteScore;
  const scoreIsInconsistent = hasCompleteScore && sel &&
    !scoreMatchesOutcome(sel, Number(homeScore), Number(awayScore));

  const handleSubmit = async () => {
    if (!sel || scoreIsInvalid || scoreIsInconsistent) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitPrediction({
        matchId: Number(matchId),
        homeTeam: match.homeTeam.shortName || match.homeTeam.name,
        awayTeam: match.awayTeam.shortName || match.awayTeam.name,
        outcome: sel,
        predictedScore: hasCompleteScore ? { home: Number(homeScore), away: Number(awayScore) } : null,
      });
      setSel(null);
      setHomeScore('');
      setAwayScore('');
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Failed to submit prediction');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading match...</span></div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!match) return null;

  const canPredict = BETTABLE.includes(match.status || 'SCHEDULED');

  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;

  // Existing prediction on this match
  const existing = predictions?.find(p => p.matchId === Number(matchId));

  const outcomeLabel = (outcome) =>
    outcome === 'home' ? match.homeTeam.name
    : outcome === 'away' ? match.awayTeam.name
    : 'Draw';

  const closedLabel = match.status === 'FINISHED'
    ? 'This match has finished — predictions are closed.'
    : ['IN_PLAY', 'PAUSED'].includes(match.status)
      ? 'This match is in play — predictions are closed.'
      : 'Predictions are not available for this match.';

  const pickClass = (...extra) => ['odd-box', ...extra].filter(Boolean).join(' ');

  return (
    <div className="match-detail-page">
      <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>

      <div className="score-hero">
        <div className="hero-teams">
          <div className="hero-team">
            {match.homeTeam.crest && <img src={match.homeTeam.crest} alt="" className="hero-crest" />}
            <span className="hero-name">{homeName}</span>
          </div>
          {match.status && ['FINISHED', 'IN_PLAY', 'PAUSED'].includes(match.status) ? (
            <div className="hero-score">
              <span className="big-score">
                {match.score.fullTime.home ?? '-'} : {match.score.fullTime.away ?? '-'}
              </span>
              {match.status === 'IN_PLAY' && <span className="detail-status status-live">LIVE</span>}
              {match.status === 'PAUSED'   && <span className="detail-status ht-score">HT</span>}
            </div>
          ) : (
            <span className="vs-label">VS</span>
          )}
          <div className="hero-team away">
            {match.awayTeam.crest && <img src={match.awayTeam.crest} alt="" className="hero-crest" />}
            <span className="hero-name">{awayName}</span>
          </div>
        </div>
      </div>

      <div className="odds-section card">
        <h3 className="section-title">Predict the Winner</h3>
        <div className="odds-wrapper">
          <div className="odds-group">
            <div className="odds-label">
              Who wins?
              {canPredict && !existing && <span className="bet-hint">— Correct = +1 point</span>}
            </div>
            <div className="odds-container">
              {[
                { key: 'home', label: match.homeTeam.name },
                { key: 'draw', label: 'Draw' },
                { key: 'away', label: match.awayTeam.name },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  className={pickClass(
                    key === 'home' && 'accent',
                    canPredict && !existing && 'bettable',
                    sel === key && 'selected',
                    existing?.outcome === key && 'bet-placed',
                  )}
                  onClick={() => canPredict && !existing && setSel(p => p === key ? null : key)}
                  disabled={!canPredict || !!existing}
                >
                  <div className="odd-name">{label}</div>
                  {existing?.outcome === key && <div className="odd-your-bet">Your Pick</div>}
                </button>
              ))}
            </div>

            {/* ── Prediction status / submit ─────────────────── */}
            {existing ? (
              <div className="bet-form-section">
                <div className="detail-existing-bet">
                  <span className="detail-bet-icon">
                    {existing.status === 'exact' ? '🎯' : existing.status === 'correct' ? '✅' : existing.status === 'wrong' ? '❌' : '🕒'}
                  </span>
                  <div className="detail-bet-info">
                    <span className="detail-bet-pick">
                      Your pick: {outcomeLabel(existing.outcome)}
                      {existing.predictedScore && ` (${existing.predictedScore.home}-${existing.predictedScore.away})`}
                    </span>
                    <span className="detail-bet-meta">
                      {existing.status === 'pending'
                        ? 'Waiting for the match to finish…'
                        : existing.status === 'exact'
                          ? 'สกอร์ถูกเป๊ะ! ได้ +4 แต้ม 🎯⭐'
                          : existing.status === 'correct'
                            ? 'Correct! You earned +1 point ⭐'
                            : 'Wrong prediction — 0 points'}
                    </span>
                  </div>
                </div>
              </div>
            ) : !canPredict ? (
              <div className="bet-form-section">
                <div className="detail-bet-prompt">{closedLabel}</div>
              </div>
            ) : (
              <div className="bet-form-section">
                <div className="detail-score-predict">
                  <span className="detail-score-label">ทายสกอร์ที่แน่นอน (ไม่บังคับ) — ถูกเป๊ะ +3 แต้มพิเศษ</span>
                  <div className="detail-score-inputs">
                    <input
                      type="number"
                      min="0"
                      className="detail-score-input"
                      value={homeScore}
                      onChange={(e) => setHomeScore(e.target.value)}
                      disabled={!sel}
                      placeholder="0"
                    />
                    <span className="detail-score-sep">-</span>
                    <input
                      type="number"
                      min="0"
                      className="detail-score-input"
                      value={awayScore}
                      onChange={(e) => setAwayScore(e.target.value)}
                      disabled={!sel}
                      placeholder="0"
                    />
                  </div>
                  {scoreIsInconsistent && <span className="detail-score-warning">สกอร์ไม่ตรงกับผลที่เลือก</span>}
                  {scoreIsInvalid && <span className="detail-score-warning">กรอกสกอร์ทั้งสองช่อง หรือเว้นว่างทั้งคู่</span>}
                </div>

                {sel ? (
                  <div className="detail-bet-controls">
                    <div className="detail-bet-left">
                      <span className="detail-selected-label">
                        Predicting: <strong>{outcomeLabel(sel)}</strong>
                      </span>
                    </div>
                    <div className="detail-bet-right">
                      <button
                        className="detail-bet-submit"
                        onClick={handleSubmit}
                        disabled={submitting || scoreIsInvalid || scoreIsInconsistent}
                      >
                        {submitting ? <span className="btn-spinner-small" /> : 'Confirm Prediction'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="detail-bet-prompt">Pick a result above — correct gets you +1 point</div>
                )}
                {submitError && <div className="detail-bet-error">{submitError}</div>}
              </div>
            )}
          </div>

          <div className="odds-footer">Predict the winner — correct = 1 point, exact score = +3 bonus (4 total)</div>
        </div>
      </div>
    </div>
  );
};

export default MatchDetail;
