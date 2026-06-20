import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './Standings.css';

const BASE_URL = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const Standings = () => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/competitions/WC/standings`);
        setGroups(res.data.standings);
      } catch (err) {
        setError('Failed to load standings. Standings may not be available yet.');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading standings...</span></div>;
  if (error) return <div className="error-box">{error}</div>;

  return (
    <div className="standings-page">
      <div className="page-header">
        <h1 className="page-title">STANDINGS</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Group Stage</p>
      </div>

      <div className="groups-grid">
        {groups.map((group) => (
          <div key={group.group} className="group-card card">
            <h3 className="group-name">{group.group?.replace('GROUP_', 'GROUP ')}</h3>
            <table className="standings-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>P</th>
                  <th>W</th>
                  <th>D</th>
                  <th>L</th>
                  <th>GD</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {group.table.map((row) => (
                  <tr key={row.team.id} className={row.position <= 2 ? 'qualify' : ''}>
                    <td className="pos">{row.position}</td>
                    <td className="team-cell">
                      {row.team.crest && <img src={row.team.crest} alt={row.team.name} className="mini-crest" />}
                      <span>{row.team.shortName || row.team.name}</span>
                    </td>
                    <td>{row.playedGames}</td>
                    <td>{row.won}</td>
                    <td>{row.draw}</td>
                    <td>{row.lost}</td>
                    <td className={row.goalDifference > 0 ? 'gd-pos' : row.goalDifference < 0 ? 'gd-neg' : ''}>
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                    <td className="pts">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Standings;