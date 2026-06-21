import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const PointsContext = createContext(null);
const BASE = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';

export const PointsProvider = ({ children }) => {
  const { user } = useAuth();
  const [points, setPoints] = useState(null);
  const [money, setMoney] = useState(null);
  const [dailyGrants, setDailyGrants] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [championPick, setChampionPick] = useState(null);

  const fetchPoints = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${BASE}/api/points`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setPoints(res.data.points);
      setMoney(res.data.money);
      setDailyGrants(res.data.dailyGrants ?? []);
      setPredictions(res.data.predictions);
      setChampionPick(res.data.championPick ?? null);
    } catch {}
  }, [user]);

  useEffect(() => { fetchPoints(); }, [fetchPoints]);

  const availableBalance = (dailyGrants.reduce((sum, g) => sum + g.remaining, 0)) + (money ?? 0);

  const submitPrediction = async ({ matchId, homeTeam, awayTeam, outcome, stake }) => {
    const res = await axios.post(
      `${BASE}/api/predictions`,
      { matchId, homeTeam, awayTeam, outcome, stake },
      { headers: { Authorization: `Bearer ${user.token}` } }
    );
    setMoney(res.data.money);
    setPredictions((prev) => [res.data.prediction, ...prev]);
    await fetchPoints();
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
    <PointsContext.Provider value={{ points, money, dailyGrants, availableBalance, predictions, championPick, fetchPoints, submitPrediction, submitChampionPick }}>
      {children}
    </PointsContext.Provider>
  );
};

export const usePoints = () => useContext(PointsContext);
