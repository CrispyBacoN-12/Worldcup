import React, { useEffect } from 'react';
import { usePoints } from './PointsContext';
import './PredictionHistory.css';

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

const pickLabel = (prediction) => {
  const { outcome, homeTeam, awayTeam, line } = prediction;
  const market = prediction.market ?? 'moneyline';
  if (market === 'total') return outcome === 'over' ? `Over ${line}` : `Under ${line}`;
  if (market === 'handicap') {
    const team = outcome === 'home' ? homeTeam : awayTeam;
    const teamLine = outcome === 'home' ? line : -line;
    return `${team} ${signed(teamLine)}`;
  }
  if (outcome === 'home') return homeTeam;
  if (outcome === 'away') return awayTeam;
  if (outcome === 'draw') return 'Draw';
  if (outcome === '1X') return `${homeTeam} or Draw`;
  if (outcome === '12') return `${homeTeam} or ${awayTeam}`;
  if (outcome === 'X2') return `Draw or ${awayTeam}`;
  return outcome;
};

const StatusBadge = ({ status }) => {
  const map = {
    pending: { label: 'Pending', cls: 'badge-pending' },
    correct: { label: 'Correct', cls: 'badge-won' },
    wrong:   { label: 'Wrong',   cls: 'badge-lost' },
  };
  const { label, cls } = map[status] || { label: status, cls: '' };
  return <span className={`bet-badge ${cls}`}>{label}</span>;
};

const StepLegLabel = (leg) => pickLabel(leg);

const PredictionHistory = () => {
  const { points, availableBalance, predictions, stepPredictions, fetchPoints } = usePoints();

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  const stepCorrect = stepPredictions.filter((s) => s.status === 'correct').length;
  const stepWrong = stepPredictions.filter((s) => s.status === 'wrong').length;
  const correct = predictions.filter((p) => p.status === 'correct').length + stepCorrect;
  const wrong = predictions.filter((p) => p.status === 'wrong').length + stepWrong;

  return (
    <div className="bets-page">
      <div className="page-header">
        <h1 className="page-title">MY PREDICTIONS</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Prediction History</p>
      </div>

      <div className="wallet-summary card">
        <div className="summary-item">
          <span className="summary-label">Balance</span>
          <span className="summary-value gold">${availableBalance.toLocaleString()}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">Points</span>
          <span className="summary-value gold">{points !== null ? points.toLocaleString() : '—'}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">Correct</span>
          <span className="summary-value green">{correct}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Wrong</span>
          <span className="summary-value red">{wrong}</span>
        </div>
      </div>

      {predictions.length === 0 && stepPredictions.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          No predictions yet. Go to Predict to make your first pick!
        </div>
      ) : (
        <div className="bets-list">
          {stepPredictions.map((stepPrediction) => (
            <div key={stepPrediction.id} className={`bet-card card ${stepPrediction.status}`}>
              <div className="bet-card-header">
                <div className="bet-match">
                  <span className="bet-home">Step ({stepPrediction.legs.length} matches)</span>
                </div>
                <StatusBadge status={stepPrediction.status} />
              </div>

              <div className="bet-card-body">
                {stepPrediction.legs.map((leg) => (
                  <div className="bet-detail-row" key={leg.matchId}>
                    <span className="bet-detail-label">{leg.homeTeam} vs {leg.awayTeam}</span>
                    <span className="bet-detail-value pick">{StepLegLabel(leg)}</span>
                  </div>
                ))}
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Stake</span>
                  <span className="bet-detail-value">${stepPrediction.stake} × {stepPrediction.combinedMultiplier.toFixed(2)}</span>
                </div>
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Result</span>
                  <span className={`bet-detail-value ${stepPrediction.status === 'correct' ? 'green' : stepPrediction.status === 'wrong' ? 'red' : 'gold'}`}>
                    {stepPrediction.status === 'pending'
                      ? 'Pending'
                      : stepPrediction.status === 'correct'
                        ? `+${stepPrediction.payout} pts`
                        : `-$${stepPrediction.stake}`}
                  </span>
                </div>
              </div>

              <div className="bet-card-footer">
                {new Date(stepPrediction.placedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          ))}

          {predictions.map((prediction) => (
            <div key={prediction.id} className={`bet-card card ${prediction.status}`}>
              <div className="bet-card-header">
                <div className="bet-match">
                  <span className="bet-home">{prediction.homeTeam}</span>
                  <span className="bet-vs">vs</span>
                  <span className="bet-away">{prediction.awayTeam}</span>
                </div>
                <StatusBadge status={prediction.status} />
              </div>

              <div className="bet-card-body">
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Your Pick</span>
                  <span className="bet-detail-value pick">{pickLabel(prediction)}</span>
                </div>
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Stake</span>
                  <span className="bet-detail-value">${prediction.stake ?? '—'}</span>
                </div>
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Result</span>
                  <span className={`bet-detail-value ${prediction.status === 'correct' ? 'green' : prediction.status === 'wrong' ? 'red' : 'gold'}`}>
                    {prediction.status === 'pending'
                      ? 'Pending'
                      : prediction.status === 'correct'
                        ? `+${prediction.payout} pts`
                        : `-$${prediction.stake ?? 0}`}
                  </span>
                </div>
              </div>

              <div className="bet-card-footer">
                {new Date(prediction.placedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PredictionHistory;
