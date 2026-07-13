import React, { useState } from 'react';
import fixtures from './data/fixtures.json';
import { usePoints } from './PointsContext';
import './Prediction.css';

const STEP_MIN_LEGS = 2;
const STEP_MAX_LEGS = 10;

const MARKET_META = [
  { key: 'moneyline', title: 'Predict Winner — stake money, win at the odds' },
  { key: 'total', title: 'Total Goals' },
  { key: 'handicap', title: 'Handicap' },
];

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

// Pure label formatter — no component state, reused for live picks, existing
// bets, and step-slip legs alike (all of which carry their own market/line).
const marketOutcomeLabel = (homeAbbr, awayAbbr, market, outcome, line) => {
  if (market === 'total') return outcome === 'over' ? `Over ${line}` : `Under ${line}`;
  if (market === 'handicap') {
    const teamAbbr = outcome === 'home' ? homeAbbr : awayAbbr;
    const teamLine = outcome === 'home' ? line : -line;
    return `${teamAbbr} ${signed(teamLine)}`;
  }
  if (outcome === 'home') return homeAbbr;
  if (outcome === 'away') return awayAbbr;
  if (outcome === 'draw') return 'Draw';
  if (outcome === '1X') return `${homeAbbr} or Draw`;
  if (outcome === '12') return `${homeAbbr} or ${awayAbbr}`;
  if (outcome === 'X2') return `Draw or ${awayAbbr}`;
  return outcome;
};

const OutcomeButtons = ({ buttons, selectedKey, onSelect }) => (
  <div className={`bet-outcomes ${buttons.length <= 2 ? 'bet-outcomes-2' : ''}`}>
    {buttons.map(({ key, label, multiplier }) => {
      const unavailable = multiplier == null;
      return (
        <button
          key={key}
          className={`bet-outcome-btn ${selectedKey === key ? 'selected' : ''}`}
          onClick={() => !unavailable && onSelect(key)}
          disabled={unavailable}
        >
          <span className="outcome-label">{label}</span>
          <span className="outcome-multiplier">{unavailable ? 'N/A' : `×${multiplier}`}</span>
        </button>
      );
    })}
  </div>
);

const Prediction = () => {
  const [mode, setMode] = useState('single');       // 'single' | 'step'
  const [picks, setPicks] = useState({});            // { [matchId]: { market, outcome } }
  const [stakes, setStakes] = useState({});          // { [matchId]: string }
  const [pickLoading, setPickLoading] = useState({});
  const [pickErrors, setPickErrors] = useState({});

  const [stepPicks, setStepPicks] = useState({});    // { [matchId]: { market, outcome } }
  const [stepStake, setStepStake] = useState('');
  const [stepSubmitting, setStepSubmitting] = useState(false);
  const [stepError, setStepError] = useState('');

  const {
    points, dailyGrants, predictions: serverPredictions, stepPredictions,
    submitPrediction, submitStepPrediction, availableBalance, getMultiplier, getLine, pointsError,
  } = usePoints();

  // Predictions open for tomorrow's matches, by Thailand calendar date (UTC+7).
  const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
  const thaiDate = (ms) => new Date(ms + THAI_OFFSET_MS).toISOString().slice(0, 10);
  const tomorrowThai = thaiDate(Date.now() + 24 * 60 * 60 * 1000);
  const matches = fixtures
    .filter((m) => m.stage !== 'GROUP_STAGE' && thaiDate(new Date(m.utcDate).getTime()) === tomorrowThai)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const homeAbbr = (match) => match.homeTeam.shortName || match.homeTeam.name;
  const awayAbbr = (match) => match.awayTeam.shortName || match.awayTeam.name;

  // Only one active (not-yet-submitted) pick per match, across all 3 markets —
  // picking a Total outcome clears any Moneyline/Handicap pick on that same
  // card, since there's a single shared stake input per card.
  const setPick = (matchId, market, outcome) => {
    setPicks(prev => {
      const current = prev[matchId];
      if (current && current.market === market && current.outcome === outcome) {
        const next = { ...prev };
        delete next[matchId];
        return next;
      }
      return { ...prev, [matchId]: { market, outcome } };
    });
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
    const pick = picks[match.id];
    if (!pick || !stakeIsValid(match.id)) return;

    setPickLoading(prev => ({ ...prev, [match.id]: true }));
    setPickErrors(prev => ({ ...prev, [match.id]: '' }));
    try {
      await submitPrediction({
        matchId: match.id,
        homeTeam: homeAbbr(match),
        awayTeam: awayAbbr(match),
        market: pick.market,
        outcome: pick.outcome,
        stake: Number(stakes[match.id]),
      });
      setPicks(prev => { const next = { ...prev }; delete next[match.id]; return next; });
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

  const openSteps = stepPredictions.filter((s) => s.status === 'pending');
  const hasOpenStep = openSteps.length > 0;

  const setStepPick = (matchId, market, outcome) => {
    setStepPicks(prev => {
      const current = prev[matchId];
      if (current && current.market === market && current.outcome === outcome) {
        const next = { ...prev };
        delete next[matchId];
        return next;
      }
      return { ...prev, [matchId]: { market, outcome } };
    });
    setStepError('');
  };

  const stepLegIds = Object.keys(stepPicks);
  const stepCombinedMultiplier = stepLegIds.reduce(
    (acc, matchId) => acc * getMultiplier(Number(matchId), stepPicks[matchId].market, stepPicks[matchId].outcome),
    1
  );
  const stepStakeValue = Number(stepStake);
  const stepStakeIsValid = stepStake !== '' && Number.isInteger(stepStakeValue) &&
    stepStakeValue > 0 && stepStakeValue <= availableBalance;
  const stepPotentialPayout = stepStakeIsValid ? Math.round(stepStakeValue * stepCombinedMultiplier) : 0;
  const stepCanSubmit = stepLegIds.length >= STEP_MIN_LEGS && stepLegIds.length <= STEP_MAX_LEGS && stepStakeIsValid;

  const handleSubmitStep = async () => {
    if (!stepCanSubmit) return;
    setStepSubmitting(true);
    setStepError('');
    try {
      const legs = stepLegIds.map((matchId) => {
        const match = matches.find((m) => m.id === Number(matchId));
        const { market, outcome } = stepPicks[matchId];
        return {
          matchId: Number(matchId),
          homeTeam: homeAbbr(match),
          awayTeam: awayAbbr(match),
          market,
          outcome,
        };
      });
      await submitStepPrediction({ legs, stake: stepStakeValue });
      setStepPicks({});
      setStepStake('');
    } catch (err) {
      setStepError(err.response?.data?.error || 'Failed to submit step');
    } finally {
      setStepSubmitting(false);
    }
  };

  // Buttons for one market row on one match. Total/handicap return [] when
  // the sheet doesn't offer that market for this match yet (no line).
  const marketButtons = (match, market) => {
    if (market === 'moneyline') {
      return ['home', 'draw', 'away', '1X', '12', 'X2'].map((key) => ({
        key,
        label: marketOutcomeLabel(homeAbbr(match), awayAbbr(match), 'moneyline', key, null),
        multiplier: getMultiplier(match.id, 'moneyline', key),
      }));
    }
    const line = getLine(match.id, market);
    if (line == null) return [];
    const keys = market === 'total' ? ['over', 'under'] : ['home', 'away'];
    return keys.map((key) => ({
      key,
      label: marketOutcomeLabel(homeAbbr(match), awayAbbr(match), market, key, line),
      multiplier: getMultiplier(match.id, market, key),
    }));
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  if (matches.length === 0) return (
    <div className="error-box" style={{ background: 'rgba(201,168,76,0.08)', color: 'var(--accent-gold)', borderColor: 'var(--border-gold)' }}>
      No matches tomorrow to predict. Predictions open from the Round of 32 onward.
    </div>
  );

  return (
    <div className="prediction-page">
      <div className="page-header">
        <h1 className="page-title">PREDICT</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Make your predictions</p>
      </div>

      {pointsError && (
        <div className="balance-bar" style={{ background: '#5a1a1a', color: '#ffb4b4' }}>
          {pointsError}
        </div>
      )}

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

      <div className="mode-toggle">
        <button
          className={`mode-toggle-btn ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
        >
          Single
        </button>
        <button
          className={`mode-toggle-btn ${mode === 'step' ? 'active' : ''}`}
          onClick={() => setMode('step')}
        >
          Step (สเตป)
        </button>
      </div>

      {mode === 'step' && hasOpenStep && openSteps.map((step) => (
        <div key={step.id} className="existing-bet" style={{ marginBottom: '1rem' }}>
          <span className="existing-bet-label">Your Open Step</span>
          <div className="existing-bet-info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
            {step.legs.map((leg) => (
              <span key={leg.matchId} className="existing-pick">
                {leg.homeTeam} vs {leg.awayTeam} — {marketOutcomeLabel(leg.homeTeam, leg.awayTeam, leg.market ?? 'moneyline', leg.outcome, leg.line)}
              </span>
            ))}
            <span className="existing-detail">
              Staked ${step.stake} × {step.combinedMultiplier} — Waiting for all matches to finish…
            </span>
          </div>
        </div>
      ))}

      <div className="prediction-list">
        {matches.map(match => {
          const pick = picks[match.id];
          const stepPick = stepPicks[match.id];

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

              {mode === 'single' ? (
                MARKET_META.map(({ key: market, title }) => {
                  const buttons = marketButtons(match, market);
                  const existing = serverPredictions?.find(
                    (p) => p.matchId === match.id && (p.market ?? 'moneyline') === market
                  );
                  // Total/handicap sections stay hidden until the sheet offers
                  // a line for this match (unless there's already a settled/
                  // pending bet on it, which must keep showing regardless).
                  if (market !== 'moneyline' && buttons.length === 0 && !existing) return null;

                  return (
                    <div className="bet-section" key={market}>
                      <div className="bet-section-title">{title}</div>

                      {existing ? (
                        <div className="existing-bet">
                          <span className="existing-bet-label">Your Prediction</span>
                          <div className="existing-bet-info">
                            <span className="existing-pick">
                              {marketOutcomeLabel(homeAbbr(match), awayAbbr(match), market, existing.outcome, existing.line)}
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
                          <OutcomeButtons
                            buttons={buttons}
                            selectedKey={pick?.market === market ? pick.outcome : null}
                            onSelect={(key) => setPick(match.id, market, key)}
                          />

                          {pick?.market === market && (() => {
                            const multiplier = getMultiplier(match.id, market, pick.outcome);
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

                          {pick?.market === market && pickErrors[match.id] && (
                            <div className="bet-error">{pickErrors[match.id]}</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              ) : (
                MARKET_META.map(({ key: market, title }) => {
                  const buttons = marketButtons(match, market);
                  if (market !== 'moneyline' && buttons.length === 0) return null;

                  return (
                    <div className="bet-section" key={market}>
                      <div className="bet-section-title">Add to Step — {title}</div>
                      <OutcomeButtons
                        buttons={buttons}
                        selectedKey={stepPick?.market === market ? stepPick.outcome : null}
                        onSelect={(key) => setStepPick(match.id, market, key)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {mode === 'step' && stepLegIds.length > 0 && (
        <div className="step-slip card">
          <div className="bet-section-title">Step Slip ({stepLegIds.length}/{STEP_MAX_LEGS} matches)</div>
          <div className="step-slip-legs">
            {stepLegIds.map((matchId) => {
              const match = matches.find((m) => m.id === Number(matchId));
              const { market, outcome } = stepPicks[matchId];
              const line = getLine(Number(matchId), market);
              return (
                <div key={matchId} className="step-slip-leg">
                  <span className="step-slip-leg-label">
                    {match.homeTeam.shortName || match.homeTeam.name} vs {match.awayTeam.shortName || match.awayTeam.name}
                    {' — '}{marketOutcomeLabel(homeAbbr(match), awayAbbr(match), market, outcome, line)}
                  </span>
                  <button className="step-slip-remove" onClick={() => setStepPick(matchId, market, outcome)}>✕</button>
                </div>
              );
            })}
          </div>

          {stepLegIds.length < STEP_MIN_LEGS && (
            <div className="detail-bet-prompt">Pick at least {STEP_MIN_LEGS} matches to build a step</div>
          )}

          {stepLegIds.length >= STEP_MIN_LEGS && (
            <div className="bet-controls">
              <div className="stake-input-wrapper">
                <span className="stake-input-prefix">$</span>
                <input
                  type="number"
                  min="1"
                  className="stake-input"
                  placeholder="0"
                  value={stepStake}
                  onChange={(e) => setStepStake(e.target.value)}
                />
              </div>
              <div className="payout-preview">
                <span className="payout-preview-text">
                  {stepPotentialPayout > 0 ? `รับ ${stepPotentialPayout.toLocaleString()} pts` : 'ใส่จำนวนเงิน'}
                </span>
                <span className="odds-badge">×{stepCombinedMultiplier.toFixed(2)}</span>
              </div>
              <button
                className="bet-submit-btn"
                onClick={handleSubmitStep}
                disabled={stepSubmitting || !stepCanSubmit}
              >
                {stepSubmitting ? <span className="btn-spinner-small" /> : 'Confirm Step'}
              </button>
            </div>
          )}

          {stepError && <div className="bet-error">{stepError}</div>}
        </div>
      )}
    </div>
  );
};

export default Prediction;
