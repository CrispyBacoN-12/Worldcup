import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { usePoints } from './PointsContext';
import './Navbar.css';

const Navbar = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const { points, availableBalance } = usePoints();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-brand">
          <span className="brand-icon">⚽</span>
          <span className="brand-text">WORLD CUP <span className="brand-year">2026</span></span>
        </div>

        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          <span /><span /><span />
        </button>

        <ul className={`navbar-links ${menuOpen ? 'open' : ''}`}>
          <li><NavLink to="/" end onClick={() => setMenuOpen(false)}>Scores</NavLink></li>
          <li><NavLink to="/standings" onClick={() => setMenuOpen(false)}>Standings</NavLink></li>
          <li><NavLink to="/players" onClick={() => setMenuOpen(false)}>Players</NavLink></li>
          <li><NavLink to="/prediction" onClick={() => setMenuOpen(false)}>Predict</NavLink></li>
          <li><NavLink to="/predictions" onClick={() => setMenuOpen(false)}>My Predictions</NavLink></li>
          <li><NavLink to="/history" onClick={() => setMenuOpen(false)}>History</NavLink></li>
          <li><NavLink to="/champion" onClick={() => setMenuOpen(false)}>ทายแชมป์</NavLink></li>
          <li><NavLink to="/awards" onClick={() => setMenuOpen(false)}>ทายรางวัล</NavLink></li>
        </ul>

        <div className="navbar-user">
          {points !== null && (
            <span className="navbar-balance">
              💰 ${availableBalance.toLocaleString()}
            </span>
          )}
          {points !== null && (
            <span className="navbar-balance">
              ⭐ {points.toLocaleString()} pts
            </span>
          )}
          <span className="navbar-username">👤 {user?.username}</span>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
