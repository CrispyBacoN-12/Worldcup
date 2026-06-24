import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import fixtures from './data/fixtures.json';
import './MatchDetail.css';

const API_BASE = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const MatchDetail = () => {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const staticMatch = fixtures.find((f) => f.id === Number(matchId)) || null;
  const [match, setMatch] = useState(staticMatch);
  const [loading, setLoading] = useState(!staticMatch);
  const [error, setError] = useState(null);

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

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading match...</span></div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!match) return null;

  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;

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
    </div>
  );
};

export default MatchDetail;
