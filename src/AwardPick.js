import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { usePoints } from './PointsContext';
import './AwardPick.css';

const BASE_URL = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const TABS = [
  { type: 'topScorer', label: 'ดาวซัลโว (Top Scorer)' },
  { type: 'goldenBall', label: 'นักเตะยอดเยี่ยม (Golden Ball)' },
];

const AwardPick = () => {
  const [tab, setTab] = useState('topScorer');
  const [candidates, setCandidates] = useState([]);
  const [lockAt, setLockAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const { awardPicks, submitAwardPick } = usePoints();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [scorersRes, metaRes] = await Promise.all([
          axios.get(`${BASE_URL}/competitions/WC/scorers?limit=50`),
          axios.get(`${BASE_URL}/awards/meta`),
        ]);
        setCandidates(scorersRes.data.scorers || []);
        setLockAt(new Date(metaRes.data.lockAt));
      } catch {
        setError('Failed to load player list. Data may not be available yet.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading players...</span></div>;
  if (error) return <div className="error-box">{error}</div>;

  const locked = lockAt && Date.now() >= lockAt.getTime();
  const currentPick = awardPicks?.[tab];
  const showGrid = !locked && (!currentPick || editing);

  const switchTab = (next) => {
    setTab(next);
    setSelected(null);
    setEditing(false);
    setSubmitError('');
    setFilter('');
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitAwardPick(tab, {
        playerId: selected.player.id,
        playerName: selected.player.name,
        teamName: selected.team.shortName || selected.team.name,
      });
      setEditing(false);
      setSelected(null);
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Failed to save pick');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredCandidates = candidates.filter((c) =>
    c.player.name.toLowerCase().includes(filter.toLowerCase())
  );

  const statusMessage = (pick) => {
    if (pick.status === 'pending') return 'รอประกาศผล…';
    if (pick.status === 'correct') return `ทายถูก! ได้ +${pick.pointsAwarded} แต้ม 🏆`;
    return 'ทายพลาด — 0 แต้ม';
  };

  return (
    <div className="award-page">
      <div className="page-header">
        <h1 className="page-title">ทายรางวัล</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — ทายดาวซัลโวและนักเตะยอดเยี่ยม</p>
      </div>

      <div className="award-tabs">
        {TABS.map(({ type, label }) => (
          <button
            key={type}
            className={`award-tab ${tab === type ? 'active' : ''}`}
            onClick={() => switchTab(type)}
          >
            {label}
          </button>
        ))}
      </div>

      {!currentPick && locked && (
        <div className="champion-locked-empty">คุณไม่ได้ทายไว้ก่อนปิดรับ</div>
      )}

      {currentPick && (
        <div className="champion-current card">
          <span className="champion-current-label">นักเตะที่คุณเลือก</span>
          <div className="champion-current-team">
            <span className="champion-current-name">{currentPick.playerName}</span>
          </div>
          {currentPick.teamName && <span className="award-current-team-name">{currentPick.teamName}</span>}
          <span className="champion-current-status">{statusMessage(currentPick)}</span>
          {!locked && !editing && (
            <button className="champion-change-btn" onClick={() => setEditing(true)}>เปลี่ยนนักเตะ</button>
          )}
        </div>
      )}

      {showGrid && (
        <>
          <input
            type="text"
            className="champion-filter"
            placeholder="ค้นหานักเตะ..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          <div className="award-list">
            {filteredCandidates.map((c) => (
              <button
                key={c.player.id}
                className={`award-card ${selected?.player.id === c.player.id ? 'selected' : ''}`}
                onClick={() => setSelected((prev) => (prev?.player.id === c.player.id ? null : c))}
              >
                {c.team.crest && <img src={c.team.crest} alt="" className="mini-crest" />}
                <span className="award-player-name">{c.player.name}</span>
                <span className="award-player-team">{c.team.shortName || c.team.name}</span>
                <span className="award-player-goals">{c.goals ?? 0} goals</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="champion-confirm-bar">
              <span className="champion-selected-label">เลือก: <strong>{selected.player.name}</strong></span>
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

export default AwardPick;
