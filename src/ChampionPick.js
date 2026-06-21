import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { usePoints } from './PointsContext';
import './ChampionPick.css';

const BASE_URL = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const ChampionPick = () => {
  const [teams, setTeams] = useState([]);
  const [lockAt, setLockAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const { championPick, submitChampionPick } = usePoints();

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/champion/teams`);
        setTeams(res.data.teams);
        setLockAt(new Date(res.data.lockAt));
      } catch {
        setError('Failed to load teams.');
      } finally {
        setLoading(false);
      }
    };
    fetchTeams();
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading teams...</span></div>;
  if (error) return <div className="error-box">{error}</div>;

  const locked = lockAt && Date.now() >= lockAt.getTime();
  const showGrid = !locked && (!championPick || editing);

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitChampionPick(selected.id);
      setEditing(false);
      setSelected(null);
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Failed to save pick');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(filter.toLowerCase())
  );

  const statusMessage = () => {
    if (championPick.status === 'pending') return 'รอจบทัวร์นาเมนต์…';
    if (championPick.status === 'correct') return `ทายถูก! ได้ +${championPick.pointsAwarded} แต้ม 🏆`;
    return 'ทายพลาด — 0 แต้ม';
  };

  return (
    <div className="champion-page">
      <div className="page-header">
        <h1 className="page-title">ทายแชมป์</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — เลือกทีมที่คุณคิดว่าจะคว้าแชมป์</p>
      </div>

      {!championPick && locked && (
        <div className="champion-locked-empty">คุณไม่ได้ทายแชมป์ไว้ก่อนปิดรับ</div>
      )}

      {championPick && (
        <div className="champion-current card">
          <span className="champion-current-label">ทีมที่คุณเลือก</span>
          <div className="champion-current-team">
            {championPick.crest && <img src={championPick.crest} alt="" className="champion-crest" />}
            <span className="champion-current-name">{championPick.shortName || championPick.name}</span>
          </div>
          <span className="champion-current-status">{statusMessage()}</span>
          {!locked && !editing && (
            <button className="champion-change-btn" onClick={() => setEditing(true)}>เปลี่ยนทีม</button>
          )}
        </div>
      )}

      {showGrid && (
        <>
          <input
            type="text"
            className="champion-filter"
            placeholder="ค้นหาทีม..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          <div className="champion-grid">
            {filteredTeams.map((team) => (
              <button
                key={team.id}
                className={`champion-card ${selected?.id === team.id ? 'selected' : ''}`}
                onClick={() => setSelected((prev) => (prev?.id === team.id ? null : team))}
              >
                {team.crest && <img src={team.crest} alt="" className="champion-crest" />}
                <span className="champion-name">{team.shortName || team.name}</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="champion-confirm-bar">
              <span className="champion-selected-label">เลือก: <strong>{selected.name}</strong></span>
              <button className="champion-confirm-btn" onClick={handleConfirm} disabled={submitting}>
                {submitting ? <span className="btn-spinner-small" /> : 'ยืนยันการทาย'}
              </button>
            </div>
          )}

          {submitError && <div className="champion-error">{submitError}</div>}
        </>
      )}
    </div>
  );
};

export default ChampionPick;
