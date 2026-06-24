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
  const [stake, setStake] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const { predictions, submitPrediction, availableBalance, getMultiplier } = usePoints();

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

  const stakeValue = Number(stake);
  const stakeIsValid = stake !== '' && Number.isInteger(stakeValue) && stakeValue > 0 && stakeValue <= availableBalance;
  const multiplier = sel ? getMultiplier(Number(matchId), sel) : null;
  const potentialPayout = multiplier && stakeValue > 0 ? Math.round(stakeValue * multiplier) : 0;

  const handleSubmit = async () => {
    if (!sel || !stakeIsValid) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitPrediction({
        matchId: Number(matchId),
        homeTeam: match.homeTeam.shortName || match.homeTeam.name,
        awayTeam: match.awayTeam.shortName || match.awayTeam.name,
        outcome: sel,
        stake: stakeValue,
      });
      setSel(null);
      setStake('');
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Failed to submit prediction');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading match...</span></div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!match) return null;

  const canPredict = match.stage !== 'GROUP_STAGE' && BETTABLE.includes(match.status || 'SCHEDULED');

  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;

  // Existing prediction on this match
  const existing = predictions?.find(p => p.matchId === Number(matchId));

  const outcomeLabel = (outcome) =>
    outcome === 'home' ? match.homeTeam.name
    : outcome === 'away' ? match.awayTeam.name
    : 'Draw';

  const closedLabel = match.stage === 'GROUP_STAGE'
    ? 'Predictions are closed for group stage matches.'
    : match.status === 'FINISHED'
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
              {canPredict && !existing && <span className="bet-hint">— Stake money, correct picks win points at the odds</span>}
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
                    {existing.status === 'correct' ? '✅' : existing.status === 'wrong' ? '❌' : '🕒'}
                  </span>
                  <div className="detail-bet-info">
                    <span className="detail-bet-pick">
                      Your pick: {outcomeLabel(existing.outcome)} — Staked ${existing.stake}
                    </span>
                    <span className="detail-bet-meta">
                      {existing.status === 'pending'
                        ? 'Waiting for the match to finish…'
                        : existing.status === 'correct'
                          ? `Correct! You won ${existing.payout} pts ⭐`
                          : 'Wrong prediction — stake lost'}
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
                  <span className="detail-score-label">ใส่จำนวนเงินที่ต้องการเดิมพัน (คงเหลือ ${availableBalance})</span>
                  <div className="stake-input-row">
                    <div className="stake-input-wrapper">
                      <span className="stake-input-prefix">$</span>
                      <input
                        type="number"
                        min="1"
                        className="stake-input"
                        value={stake}
                        onChange={(e) => setStake(e.target.value)}
                        disabled={!sel}
                        placeholder="0"
                      />
                    </div>
                    {sel && (
                      <div className="payout-preview">
                        <span className="payout-preview-text">
                          {potentialPayout > 0 ? `รับ ${potentialPayout.toLocaleString()} pts` : 'ใส่จำนวนเงิน'}
                        </span>
                        <span className="odds-badge">×{multiplier}</span>
                      </div>
                    )}
                  </div>
                  {stake !== '' && !stakeIsValid && (
                    <span className="detail-score-warning">ใส่จำนวนเงินที่ถูกต้องและไม่เกินยอดคงเหลือ</span>
                  )}
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
                        disabled={submitting || !stakeIsValid}
                      >
                        {submitting ? <span className="btn-spinner-small" /> : 'Confirm Prediction'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="detail-bet-prompt">Pick a result above, then stake money on it</div>
                )}
                {submitError && <div className="detail-bet-error">{submitError}</div>}
              </div>
            )}
          </div>

          <div className="odds-footer">Predict the winner — stake money, correct picks earn points at the match's odds</div>
        </div>
      </div>
    </div>
  );
};

export default MatchDetail;
