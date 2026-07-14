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
  const [picks, setPicks] = useState({});            // { [matchId]: { market, outcome, line } }
  const [stakes, setStakes] = useState({});          // { [matchId]: string }
  const [pickLoading, setPickLoading] = useState({});
  const [pickErrors, setPickErrors] = useState({});

  const [stepPicks, setStepPicks] = useState({});    // { [matchId|market|line]: { matchId, market, outcome, line } }
  const [stepStake, setStepStake] = useState('');
  const [stepSubmitting, setStepSubmitting] = useState(false);
  const [stepError, setStepError] = useState('');

  const {
    points, dailyGrants, predictions: serverPredictions, stepPredictions,
    submitPrediction, submitStepPrediction, availableBalance, getMultiplier, getLines, pointsError,
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

  // Single mode: only one active (not-yet-submitted) pick per match, across
  // all 3 markets and all lines within a market — picking a Total 3.5 outcome
  // clears any Total 2.5 / Moneyline / Handicap pick on that same card, since
  // there's a single shared stake input per card.
  const setPick = (matchId, market, outcome, line) => {
    setPicks(prev => {
      const current = prev[matchId];
      if (current && current.market === market && current.outcome === outcome && (current.line ?? null) === (line ?? null)) {
        const next = { ...prev };
        delete next[matchId];
        return next;
      }
      return { ...prev, [matchId]: { market, outcome, line: line ?? null } };
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
        line: pick.line ?? null,
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

  // Step mode: keyed by match+market+line so a step can hold multiple legs
  // on the same match (e.g. Moneyline + Total together) — picking a new
  // outcome for the same market+line replaces the old one (they'd
  // contradict), but a different market or line adds a separate leg.
  const stepPickKey = (matchId, market, line) => `${matchId}|${market}|${line ?? 'null'}`;

  const setStepPick = (matchId, market, outcome, line) => {
    const key = stepPickKey(matchId, market, line);
    setStepPicks(prev => {
      const current = prev[key];
      if (current && current.outcome === outcome) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { matchId, market, outcome, line: line ?? null } };
    });
    setStepError('');
  };

  const stepLegKeys = Object.keys(stepPicks);
  const stepCombinedMultiplier = stepLegKeys.reduce((acc, key) => {
    const { matchId, market, outcome, line } = stepPicks[key];
    return acc * getMultiplier(matchId, market, outcome, line);
  }, 1);
  const stepStakeValue = Number(stepStake);
  const stepStakeIsValid = stepStake !== '' && Number.isInteger(stepStakeValue) &&
    stepStakeValue > 0 && stepStakeValue <= availableBalance;
  const stepPotentialPayout = stepStakeIsValid ? Math.round(stepStakeValue * stepCombinedMultiplier) : 0;
  const stepCanSubmit = stepLegKeys.length >= STEP_MIN_LEGS && stepLegKeys.length <= STEP_MAX_LEGS && stepStakeIsValid;

  const handleSubmitStep = async () => {
    if (!stepCanSubmit) return;
    setStepSubmitting(true);
    setStepError('');
    try {
      const legs = stepLegKeys.map((key) => {
        const { matchId, market, outcome, line } = stepPicks[key];
        const match = matches.find((m) => m.id === matchId);
        return {
          matchId,
          homeTeam: homeAbbr(match),
          awayTeam: awayAbbr(match),
          market,
          outcome,
          line: line ?? null,
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

  // Lines currently offered for a market on a match. Moneyline has no
  // concept of "line" — treated as a single implicit line of `null`.
  const offeredLines = (match, market) =>
    market === 'moneyline' ? [null] : getLines(match.id, market).map((entry) => entry.line);

  // Outcome buttons for one specific line-offer within a market.
  const lineButtons = (match, market, line) => {
    const keys = market === 'moneyline' ? ['home', 'draw', 'away', '1X', '12', 'X2']
      : market === 'total' ? ['over', 'under'] : ['home', 'away'];
    return keys.map((key) => ({
      key,
      label: marketOutcomeLabel(homeAbbr(match), awayAbbr(match), market, key, line),
      multiplier: getMultiplier(match.id, market, key, line),
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
                  const existingForMarket = serverPredictions?.filter(
                    (p) => p.matchId === match.id && (p.market ?? 'moneyline') === market
                  ) ?? [];
                  // Total/handicap sections stay hidden until the sheet offers
                  // at least one line for this match — except lines with an
                  // already-placed bet, which must keep showing even if the
                  // sheet stops offering them by settlement time.
                  const lines = [...new Set([...offeredLines(match, market), ...existingForMarket.map((p) => p.line ?? null)])];
                  if (market !== 'moneyline' && lines.length === 0) return null;

                  return (
                    <div className="bet-section" key={market}>
                      <div className="bet-section-title">{title}</div>

                      {lines.map((line) => {
                        const buttons = lineButtons(match, market, line);
                        const existing = existingForMarket.find((p) => (p.line ?? null) === line);
                        const isPicked = pick?.market === market && (pick.line ?? null) === line;

                        return (
                          <div className="bet-line-row" key={line ?? 'ml'}>
                            {market !== 'moneyline' && <div className="bet-line-label">Line {line}</div>}

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
                                  selectedKey={isPicked ? pick.outcome : null}
                                  onSelect={(key) => setPick(match.id, market, key, line)}
                                />

                                {isPicked && (() => {
                                  const multiplier = getMultiplier(match.id, market, pick.outcome, pick.line ?? null);
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

                                {isPicked && pickErrors[match.id] && (
                                  <div className="bet-error">{pickErrors[match.id]}</div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                MARKET_META.map(({ key: market, title }) => {
                  const lines = offeredLines(match, market);
                  if (market !== 'moneyline' && lines.length === 0) return null;

                  return (
                    <div className="bet-section" key={market}>
                      <div className="bet-section-title">Add to Step — {title}</div>
                      {lines.map((line) => {
                        const buttons = lineButtons(match, market, line);
                        const stepPick = stepPicks[stepPickKey(match.id, market, line)];
                        return (
                          <div className="bet-line-row" key={line ?? 'ml'}>
                            {market !== 'moneyline' && <div className="bet-line-label">Line {line}</div>}
                            <OutcomeButtons
                              buttons={buttons}
                              selectedKey={stepPick ? stepPick.outcome : null}
                              onSelect={(key) => setStepPick(match.id, market, key, line)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {mode === 'step' && stepLegKeys.length > 0 && (
        <div className="step-slip card">
          <div className="bet-section-title">Step Slip ({stepLegKeys.length}/{STEP_MAX_LEGS} picks)</div>
          <div className="step-slip-legs">
            {stepLegKeys.map((key) => {
              const { matchId, market, outcome, line } = stepPicks[key];
              const match = matches.find((m) => m.id === matchId);
              return (
                <div key={key} className="step-slip-leg">
                  <span className="step-slip-leg-label">
                    {match.homeTeam.shortName || match.homeTeam.name} vs {match.awayTeam.shortName || match.awayTeam.name}
                    {' — '}{marketOutcomeLabel(homeAbbr(match), awayAbbr(match), market, outcome, line)}
                  </span>
                  <button className="step-slip-remove" onClick={() => setStepPick(matchId, market, outcome, line)}>✕</button>
                </div>
              );
            })}
          </div>

          {stepLegKeys.length < STEP_MIN_LEGS && (
            <div className="detail-bet-prompt">Pick at least {STEP_MIN_LEGS} picks to build a step</div>
          )}

          {stepLegKeys.length >= STEP_MIN_LEGS && (
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
