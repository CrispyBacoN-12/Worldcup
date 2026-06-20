import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import fixtures from './data/fixtures.json';
import { statusLabel, formatDate } from './matchUtils';
import './Home.css';
import './MatchHistory.css';

const BASE_URL = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const baseMatches = fixtures
  .slice()
  .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
  .map((f) => ({ ...f, status: 'SCHEDULED', score: { fullTime: { home: null, away: null } } }));

const MatchHistory = () => {
  const [matches, setMatches] = useState(baseMatches);
  const [liveError, setLiveError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/competitions/WC/matches`);
        const liveById = new Map(res.data.matches.map((m) => [m.id, m]));
        setMatches(baseMatches.map((m) => liveById.get(m.id) || m));
      } catch {
        setLiveError(true);
      }
    };
    fetchLiveData();
  }, []);

  const finished = matches
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

  return (
    <div className="home-page history-page">
      <div className="page-header">
        <h1 className="page-title">MATCH HISTORY</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Completed Matches</p>
      </div>

      {liveError && (
        <div className="error-box" style={{ marginBottom: '1rem' }}>
          Live results are temporarily unavailable.
        </div>
      )}

      {finished.length === 0 ? (
        <div className="empty-state">No matches have finished yet.</div>
      ) : (
        <div className="matches-list">
          {finished.map(match => {
            const { label, cls } = statusLabel(match.status);
            const home = match.homeTeam;
            const away = match.awayTeam;
            const score = match.score.fullTime;
            return (
              <div key={match.id} className="match-card" onClick={() => navigate(`/match/${match.id}`)} style={{ cursor: 'pointer' }}>
                <div className="match-meta">
                  <span className="match-stage">{match.stage?.replace(/_/g, ' ')}</span>
                  <span className={`match-status ${cls}`}>{label}</span>
                  <span className="match-date">{formatDate(match.utcDate)}</span>
                </div>

                <div className="match-teams">
                  <div className="team home">
                    {home.crest && <img src={home.crest} alt={home.name} className="team-crest" />}
                    <span className="team-name">{home.shortName || home.name}</span>
                  </div>

                  <div className="score-box">
                    <span className="score">{score.home ?? '-'} : {score.away ?? '-'}</span>
                  </div>

                  <div className="team away">
                    <span className="team-name">{away.shortName || away.name}</span>
                    {away.crest && <img src={away.crest} alt={away.name} className="team-crest" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MatchHistory;
