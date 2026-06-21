import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const PointsContext = createContext(null);
const BASE = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';

export const PointsProvider = ({ children }) => {
  const { user } = useAuth();
  const [points, setPoints] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [championPick, setChampionPick] = useState(null);

  const fetchPoints = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${BASE}/api/points`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setPoints(res.data.points);
      setPredictions(res.data.predictions);
      setChampionPick(res.data.championPick ?? null);
    } catch {}
  }, [user]);

  useEffect(() => { fetchPoints(); }, [fetchPoints]);

  const submitPrediction = async (data) => {
    const res = await axios.post(`${BASE}/api/predictions`, data, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    setPoints(res.data.points);
    setPredictions((prev) => [res.data.prediction, ...prev]);
    return res.data;
  };

  const submitChampionPick = async (teamId) => {
    const res = await axios.post(`${BASE}/api/champion-pick`, { teamId }, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    setPoints(res.data.points);
    setChampionPick(res.data.championPick);
    return res.data;
  };

  return (
    <PointsContext.Provider value={{ points, predictions, championPick, fetchPoints, submitPrediction, submitChampionPick }}>
      {children}
    </PointsContext.Provider>
  );
};

export const usePoints = () => useContext(PointsContext);
