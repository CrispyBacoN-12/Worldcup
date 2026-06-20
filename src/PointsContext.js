import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const PointsContext = createContext(null);
const BASE = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';

export const PointsProvider = ({ children }) => {
  const { user } = useAuth();
  const [points, setPoints] = useState(null);
  const [predictions, setPredictions] = useState([]);

  const fetchPoints = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${BASE}/api/points`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setPoints(res.data.points);
      setPredictions(res.data.predictions);
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

  return (
    <PointsContext.Provider value={{ points, predictions, fetchPoints, submitPrediction }}>
      {children}
    </PointsContext.Provider>
  );
};

export const usePoints = () => useContext(PointsContext);
