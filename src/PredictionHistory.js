import React, { useEffect } from 'react';
import { usePoints } from './PointsContext';
import './PredictionHistory.css';

const pickLabel = (prediction) => {
  if (prediction.outcome === 'home') return prediction.homeTeam;
  if (prediction.outcome === 'away') return prediction.awayTeam;
  return 'Draw';
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

const PredictionHistory = () => {
  const { points, money, predictions, fetchPoints } = usePoints();

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  const correct = predictions.filter((p) => p.status === 'correct').length;
  const wrong = predictions.filter((p) => p.status === 'wrong').length;

  return (
    <div className="bets-page">
      <div className="page-header">
        <h1 className="page-title">MY PREDICTIONS</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Prediction History</p>
      </div>

      <div className="wallet-summary card">
        <div className="summary-item">
          <span className="summary-label">Money</span>
          <span className="summary-value gold">{money !== null ? `$${money.toLocaleString()}` : '—'}</span>
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

      {predictions.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          No predictions yet. Go to Predict to make your first pick!
        </div>
      ) : (
        <div className="bets-list">
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
                        ? `+$${prediction.payout}`
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
