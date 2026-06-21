import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { PointsProvider } from './PointsContext';
import Navbar from './navbar';
import Home from './Home';
import Standings from './Standings';
import Prediction from './Prediction';
import PlayerStats from './Playerstats';
import MatchDetail from './MatchDetail';
import MatchHistory from './MatchHistory';
import PredictionHistory from './PredictionHistory';
import ChampionPick from './ChampionPick';
import Login from './Login';
import './App.css';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading"><div className="spinner" /></div>;
  return user ? children : <Navigate to="/login" replace />;
};

const AppRoutes = () => {
  const { user } = useAuth();
  return (
    <>
      {user && <Navbar />}
      <main className={user ? 'main-content' : ''}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/standings" element={<ProtectedRoute><Standings /></ProtectedRoute>} />
          <Route path="/prediction" element={<ProtectedRoute><Prediction /></ProtectedRoute>} />
          <Route path="/players" element={<ProtectedRoute><PlayerStats /></ProtectedRoute>} />
          <Route path="/match/:matchId" element={<ProtectedRoute><MatchDetail /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><MatchHistory /></ProtectedRoute>} />
          <Route path="/predictions" element={<ProtectedRoute><PredictionHistory /></ProtectedRoute>} />
          <Route path="/champion" element={<ProtectedRoute><ChampionPick /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <PointsProvider>
        <Router>
          <div className="app">
            <AppRoutes />
          </div>
        </Router>
      </PointsProvider>
    </AuthProvider>
  );
};

export default App;
