import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './PlayerStats.css';

const BASE_URL = '/api';

const PlayerStats = () => {
  const [scorers, setScorers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/competitions/WC/scorers?limit=20`);
        setScorers(res.data.scorers);
      } catch (err) {
        setError('Failed to load player stats. Data may not be available yet.');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading players...</span></div>;
  if (error) return <div className="error-box">{error}</div>;

  return (
    <div className="players-page">
      <div className="page-header">
        <h1 className="page-title">TOP SCORERS</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Golden Boot Race</p>
      </div>

      <div className="scorers-list">
        {scorers.map((item, index) => (
          <div key={item.player.id} className="scorer-card card">
            <div className="scorer-rank">
              {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
            </div>
            <div className="scorer-info">
              <div className="scorer-name">{item.player.name}</div>
              <div className="scorer-team">
                {item.team.crest && <img src={item.team.crest} alt={item.team.name} className="mini-crest" />}
                <span>{item.team.shortName || item.team.name}</span>
              </div>
            </div>
            <div className="scorer-stats">
              <div className="stat-item">
                <span className="stat-value">{item.goals ?? 0}</span>
                <span className="stat-label">Goals</span>
              </div>
              {item.assists !== undefined && (
                <div className="stat-item">
                  <span className="stat-value">{item.assists ?? 0}</span>
                  <span className="stat-label">Assists</span>
                </div>
              )}
              <div className="stat-item">
                <span className="stat-value">{item.playedMatches ?? 0}</span>
                <span className="stat-label">Games</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlayerStats;