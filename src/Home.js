import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import fixtures from './data/fixtures.json';
import './Home.css';

const BASE_URL = '/api';

const baseMatches = fixtures
  .slice()
  .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
  .map((f) => ({ ...f, status: 'SCHEDULED', score: { fullTime: { home: null, away: null } } }));

const Home = () => {
  const [matches, setMatches] = useState(baseMatches);
  const [liveError, setLiveError] = useState(false);
  const [filter, setFilter] = useState('ALL');
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

  const filtered = matches.filter(m => filter === 'ALL' || m.status === filter);

  const statusLabel = (status) => {
    const map = {
      FINISHED: { label: 'FT', cls: 'status-ft' },
      IN_PLAY: { label: 'LIVE', cls: 'status-live' },
      PAUSED: { label: 'HT', cls: 'status-live' },
      TIMED: { label: 'Upcoming', cls: 'status-upcoming' },
      SCHEDULED: { label: 'Scheduled', cls: 'status-upcoming' },
    };
    return map[status] || { label: status, cls: '' };
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="home-page">
      <div className="page-header">
        <h1 className="page-title">MATCH RESULTS</h1>
        <p className="page-subtitle">FIFA World Cup 2026</p>
      </div>

      {liveError && (
        <div className="error-box" style={{ marginBottom: '1rem' }}>
          Showing scheduled fixtures — live scores are temporarily unavailable.
        </div>
      )}

      <div className="filter-tabs">
        {['ALL', 'FINISHED', 'IN_PLAY', 'SCHEDULED'].map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'ALL' ? 'All' : f === 'FINISHED' ? 'Finished' : f === 'IN_PLAY' ? 'Live' : 'Upcoming'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No matches found for this filter.</div>
      ) : (
        <div className="matches-list">
          {filtered.map(match => {
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
                    {match.status === 'FINISHED' || match.status === 'IN_PLAY' || match.status === 'PAUSED' ? (
                      <span className="score">{score.home ?? '-'} : {score.away ?? '-'}</span>
                    ) : (
                      <span className="score vs">VS</span>
                    )}
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

export default Home;