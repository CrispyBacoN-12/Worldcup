import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const PointsContext = createContext(null);
const BASE = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';

export const PointsProvider = ({ children }) => {
  const { user } = useAuth();
  const [points, setPoints] = useState(null);
  const [dailyGrants, setDailyGrants] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [stepPredictions, setStepPredictions] = useState([]);
  const [championPick, setChampionPick] = useState(null);
  const [awardPicks, setAwardPicks] = useState({});
  const [odds, setOdds] = useState({});
  const [pointsError, setPointsError] = useState(null);

  useEffect(() => {
    axios.get(`${BASE}/api/odds`)
      .then((res) => setOdds(res.data.odds ?? {}))
      .catch(() => {});
  }, []);

  const getMultiplier = useCallback(
    (matchId, market, outcome) => odds[matchId]?.[market]?.[outcome],
    [odds]
  );

  const getLine = useCallback(
    (matchId, market) => odds[matchId]?.[market]?.line,
    [odds]
  );

  const fetchPoints = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${BASE}/api/points`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setPoints(res.data.points);
      setDailyGrants(res.data.dailyGrants ?? []);
      setPredictions(res.data.predictions);
      setStepPredictions(res.data.stepPredictions ?? []);
      setChampionPick(res.data.championPick ?? null);
      setAwardPicks(res.data.awardPicks ?? {});
      setPointsError(null);
    } catch (err) {
      console.error('Failed to load points/balance:', err);
      setPointsError(
        err.response?.status === 401
          ? 'เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่'
          : 'โหลดข้อมูลยอดเงินไม่สำเร็จ กรุณาลองรีเฟรชหน้านี้'
      );
    }
  }, [user]);

  useEffect(() => { fetchPoints(); }, [fetchPoints]);

  // Only the unexpired daily allowance is stakeable money. Points are a
  // separate, permanent currency earned only from winnings — daily money
  // left unstaked when it expires is just gone, it does not become points.
  const availableBalance = dailyGrants.reduce((sum, g) => sum + g.remaining, 0);

  const submitPrediction = async ({ matchId, homeTeam, awayTeam, market, outcome, stake }) => {
    const res = await axios.post(
      `${BASE}/api/predictions`,
      { matchId, homeTeam, awayTeam, market, outcome, stake },
      { headers: { Authorization: `Bearer ${user.token}` } }
    );
    setPredictions((prev) => [res.data.prediction, ...prev]);
    await fetchPoints();
    return res.data;
  };

  const submitStepPrediction = async ({ legs, stake }) => {
    const res = await axios.post(
      `${BASE}/api/step-predictions`,
      { legs, stake },
      { headers: { Authorization: `Bearer ${user.token}` } }
    );
    setStepPredictions((prev) => [res.data.stepPrediction, ...prev]);
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

  const submitAwardPick = async (type, { playerId, playerName, teamName }) => {
    const res = await axios.post(`${BASE}/api/award-pick`, { type, playerId, playerName, teamName }, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    setPoints(res.data.points);
    setAwardPicks(res.data.awardPicks);
    return res.data;
  };

  return (
    <PointsContext.Provider value={{ points, dailyGrants, availableBalance, predictions, stepPredictions, championPick, awardPicks, pointsError, getMultiplier, getLine, fetchPoints, submitPrediction, submitStepPrediction, submitChampionPick, submitAwardPick }}>
      {children}
    </PointsContext.Provider>
  );
};

export const usePoints = () => useContext(PointsContext);
