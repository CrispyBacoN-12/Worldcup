import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';
import './Leaderboard.css';

const BASE = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const Leaderboard = () => {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await axios.get(`${BASE}/leaderboard`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        setLeaderboard(res.data.leaderboard);
      } catch {
        setError('Failed to load leaderboard.');
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, [user]);

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading leaderboard...</span></div>;
  if (error) return <div className="error-box">{error}</div>;

  return (
    <div className="leaderboard-page">
      <div className="page-header">
        <h1 className="page-title">LEADERBOARD</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Top Predictors</p>
      </div>

      {leaderboard.length === 0 ? (
        <div className="empty-state">No players yet.</div>
      ) : (
        <div className="leaderboard-list">
          {leaderboard.map((entry, index) => (
            <div
              key={entry.username}
              className={`leaderboard-row card ${entry.username === user?.username ? 'me' : ''}`}
            >
              <div className="leaderboard-rank">
                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
              </div>
              <span className="leaderboard-username">{entry.username}</span>
              <span className="leaderboard-points">{entry.points.toLocaleString()} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
