import React, { useState } from 'react';
import fixtures from './data/fixtures.json';
import { usePoints } from './PointsContext';
import './Prediction.css';

const Prediction = () => {
  const [picks, setPicks] = useState({});          // { [matchId]: 'home'|'draw'|'away' }
  const [stakes, setStakes] = useState({});        // { [matchId]: string }
  const [pickLoading, setPickLoading] = useState({});
  const [pickErrors, setPickErrors] = useState({});

  const { points, dailyGrants, predictions: serverPredictions, submitPrediction, availableBalance, getMultiplier } = usePoints();

  const today = new Date().toDateString();
  const matches = fixtures
    .filter((m) => new Date(m.utcDate).toDateString() === today)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const setPick = (matchId, outcome) => {
    setPicks(prev => ({ ...prev, [matchId]: prev[matchId] === outcome ? null : outcome }));
    setPickErrors(prev => ({ ...prev, [matchId]: '' }));
  };

  const setStake = (matchId, value) => {
    setStakes(prev => ({ ...prev, [matchId]: value }));
  };

  const stakeIsValid = (matchId) => {
    const value = Number(stakes[matchId]);
    return stakes[matchId] !== undefined && stakes[matchId] !== '' &&
      Number.isInteger(value) && value > 0 && value <= availableBalance;
  };

  const handleSubmitPick = async (match) => {
    const outcome = picks[match.id];
    if (!outcome || !stakeIsValid(match.id)) return;

    setPickLoading(prev => ({ ...prev, [match.id]: true }));
    setPickErrors(prev => ({ ...prev, [match.id]: '' }));
    try {
      await submitPrediction({
        matchId: match.id,
        homeTeam: match.homeTeam.shortName || match.homeTeam.name,
        awayTeam: match.awayTeam.shortName || match.awayTeam.name,
        outcome,
        stake: Number(stakes[match.id]),
      });
      setPicks(prev => ({ ...prev, [match.id]: null }));
      setStakes(prev => ({ ...prev, [match.id]: '' }));
    } catch (err) {
      setPickErrors(prev => ({
        ...prev,
        [match.id]: err.response?.data?.error || 'Failed to submit prediction',
      }));
    } finally {
      setPickLoading(prev => ({ ...prev, [match.id]: false }));
    }
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  if (matches.length === 0) return (
    <div className="error-box" style={{ background: 'rgba(201,168,76,0.08)', color: 'var(--accent-gold)', borderColor: 'var(--border-gold)' }}>
      No matches today to predict.
    </div>
  );

  return (
    <div className="prediction-page">
      <div className="page-header">
        <h1 className="page-title">PREDICT</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Make your predictions</p>
      </div>

      {points !== null && (
        <div className="balance-bar">
          <span className="balance-label">Available Balance</span>
          <span className="balance-amount">${availableBalance.toLocaleString()}</span>
          {dailyGrants.length > 0 && (
            <span className="balance-expiry">
              ${dailyGrants[0].remaining} expires in {Math.max(0, Math.ceil(24 - (Date.now() - new Date(dailyGrants[0].grantedAt).getTime()) / 3600000))}h
            </span>
          )}
        </div>
      )}

      <div className="prediction-list">
        {matches.map(match => {
          const pick = picks[match.id];
          const existing = serverPredictions?.find((p) => p.matchId === match.id);

          return (
            <div key={match.id} className="prediction-card card">
              <div className="pred-date">{formatDate(match.utcDate)}</div>

              <div className="pred-teams">
                <div className="pred-team">
                  {match.homeTeam.crest && <img src={match.homeTeam.crest} alt="" className="pred-crest" />}
                  <span>{match.homeTeam.shortName || match.homeTeam.name}</span>
                </div>
                <span className="vs-label">VS</span>
                <div className="pred-team away">
                  <span>{match.awayTeam.shortName || match.awayTeam.name}</span>
                  {match.awayTeam.crest && <img src={match.awayTeam.crest} alt="" className="pred-crest" />}
                </div>
              </div>

              <div className="bet-section">
                <div className="bet-section-title">Predict Winner — stake money, win at the odds</div>

                {existing ? (
                  <div className="existing-bet">
                    <span className="existing-bet-label">Your Prediction</span>
                    <div className="existing-bet-info">
                      <span className="existing-pick">
                        {existing.outcome === 'home'
                          ? match.homeTeam.shortName || match.homeTeam.name
                          : existing.outcome === 'away'
                          ? match.awayTeam.shortName || match.awayTeam.name
                          : 'Draw'}
                        {' — Staked $' + existing.stake}
                      </span>
                      <span className="existing-detail">
                        {existing.status === 'pending'
                          ? 'Waiting for result…'
                          : existing.status === 'correct'
                            ? `Correct! Won ${existing.payout} pts ⭐`
                            : 'Wrong — stake lost'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bet-outcomes">
                      {[
                        { key: 'home', label: match.homeTeam.shortName || match.homeTeam.name },
                        { key: 'draw', label: 'Draw' },
                        { key: 'away', label: match.awayTeam.shortName || match.awayTeam.name },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          className={`bet-outcome-btn ${pick === key ? 'selected' : ''}`}
                          onClick={() => setPick(match.id, key)}
                        >
                          <span className="outcome-label">{label}</span>
                        </button>
                      ))}
                    </div>

                    {pick && (() => {
                      const multiplier = getMultiplier(match.id, pick);
                      const stakeValue = Number(stakes[match.id]);
                      const potentialPayout = stakeValue > 0 ? Math.round(stakeValue * multiplier) : 0;
                      return (
                        <div className="bet-controls">
                          <div className="stake-input-wrapper">
                            <span className="stake-input-prefix">$</span>
                            <input
                              type="number"
                              min="1"
                              className="stake-input"
                              placeholder="0"
                              value={stakes[match.id] ?? ''}
                              onChange={(e) => setStake(match.id, e.target.value)}
                            />
                          </div>
                          <div className="payout-preview">
                            <span className="payout-preview-text">
                              {potentialPayout > 0 ? `รับ ${potentialPayout.toLocaleString()} pts` : 'ใส่จำนวนเงิน'}
                            </span>
                            <span className="odds-badge">×{multiplier}</span>
                          </div>
                          <button
                            className="bet-submit-btn"
                            onClick={() => handleSubmitPick(match)}
                            disabled={pickLoading[match.id] || !stakeIsValid(match.id)}
                          >
                            {pickLoading[match.id] ? <span className="btn-spinner-small" /> : 'Confirm Prediction'}
                          </button>
                        </div>
                      );
                    })()}

                    {pickErrors[match.id] && (
                      <div className="bet-error">{pickErrors[match.id]}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Prediction;
