const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const nodePath = require('path');

try {
  process.loadEnvFile(nodePath.join(__dirname, '.env'));
} catch {
  // .env is optional in environments where these vars are set another way
}

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.FOOTBALL_API_KEY;
const BASE = 'https://api.football-data.org/v4';
const JWT_SECRET = process.env.JWT_SECRET;
const USERS_FILE = nodePath.join(__dirname, 'users.json');
const WALLET_FILE = nodePath.join(__dirname, 'wallet.json');
const CHAMPION_TEAMS_FILE = nodePath.join(__dirname, 'data', 'championTeams.json');
const championTeams = JSON.parse(fs.readFileSync(CHAMPION_TEAMS_FILE, 'utf8'));
const championTeamsById = new Map(championTeams.map((t) => [t.id, t]));

const MATCH_ODDS_FILE = nodePath.join(__dirname, 'data', 'matchOdds.json');
const matchOdds = JSON.parse(fs.readFileSync(MATCH_ODDS_FILE, 'utf8'));
const DEFAULT_ODDS_MULTIPLIER = 2;
const getOddsMultiplier = (matchId, outcome) => matchOdds[matchId]?.[outcome] ?? DEFAULT_ODDS_MULTIPLIER;

const FIXTURES_FILE = nodePath.join(__dirname, 'data', 'fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
const DAILY_ALLOWANCE_PER_MATCH = 100;
const GRANT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const matchCountOn = (dateStr) =>
  fixtures.filter((m) => m.utcDate.slice(0, 10) === dateStr).length;

// Kickoff of the first LAST_32-stage match in src/data/fixtures.json — picks lock here.
const CHAMPION_LOCK_AT = new Date('2026-06-28T19:00:00Z').getTime();
// The FINAL-stage match id from src/data/fixtures.json (teams resolve once the bracket completes).
const FINAL_MATCH_ID = 537390;
const CHAMPION_BASE_POINTS = 10;

// ─── Football API request cache + throttle ──────────────────
const apiCache = new Map(); // url -> { data, expiresAt }
const requestQueue = [];
const requestTimestamps = [];
const MAX_PER_MINUTE = 8;

const cacheTtlFor = (url) => (url.includes('/standings') ? 5 * 60 * 1000 : 45 * 1000);

const runQueued = () => {
  if (requestQueue.length === 0) return;
  const now = Date.now();
  while (requestTimestamps.length && now - requestTimestamps[0] > 60 * 1000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_PER_MINUTE) {
    setTimeout(runQueued, 1000);
    return;
  }

  const job = requestQueue.shift();
  requestTimestamps.push(Date.now());

  axios.get(job.url, { headers: { 'X-Auth-Token': API_KEY } })
    .then((res) => {
      apiCache.set(job.url, { data: res.data, expiresAt: Date.now() + cacheTtlFor(job.url) });
      job.resolve(res.data);
    })
    .catch((err) => job.reject(err))
    .finally(() => { if (requestQueue.length) setTimeout(runQueued, 200); });
};

const fetchFootballData = (path, query = '') => {
  const url = `${BASE}/${path}${query ? '?' + query : ''}`;
  const cached = apiCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }
  return new Promise((resolve, reject) => {
    requestQueue.push({ url, resolve, reject });
    runQueued();
  });
};

// ─── File helpers ────────────────────────────────────────────
const getUsers = () => {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
};
const saveUsers = (users) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

const getWallet = () => {
  if (!fs.existsSync(WALLET_FILE)) return {};
  return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
};
const saveWallet = (data) => {
  fs.writeFileSync(WALLET_FILE, JSON.stringify(data, null, 2));
};

// Ensures the wallet record exists, drops expired daily grants, and grants
// today's allowance (100 * today's match count) if it hasn't been given yet.
const touchWallet = (wallet, username) => {
  if (!wallet[username])
    wallet[username] = { points: 0, predictions: [], money: 0, dailyGrants: [], lastAllowanceDate: null };
  const userData = wallet[username];
  if (userData.money == null) userData.money = 0;
  if (!userData.dailyGrants) userData.dailyGrants = [];

  const now = Date.now();
  userData.dailyGrants = userData.dailyGrants.filter((g) => now - new Date(g.grantedAt).getTime() < GRANT_EXPIRY_MS);

  const today = todayUtc();
  if (userData.lastAllowanceDate !== today) {
    const amount = DAILY_ALLOWANCE_PER_MATCH * matchCountOn(today);
    if (amount > 0) {
      userData.dailyGrants.push({ amount, grantedAt: new Date().toISOString(), remaining: amount });
    }
    userData.lastAllowanceDate = today;
  }

  return userData;
};

const availableBalance = (userData) =>
  userData.dailyGrants.reduce((sum, g) => sum + g.remaining, 0) + userData.money;

// Deducts from the soonest-expiring grants first, then permanent money.
const deductStake = (userData, amount) => {
  let remaining = amount;
  for (const grant of userData.dailyGrants) {
    if (remaining <= 0) break;
    const take = Math.min(grant.remaining, remaining);
    grant.remaining -= take;
    remaining -= take;
  }
  userData.dailyGrants = userData.dailyGrants.filter((g) => g.remaining > 0);
  userData.money -= remaining;
};

// ─── JWT Middleware ──────────────────────────────────────────
const verifyToken = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ─── Prediction Settlement ───────────────────────────────────
// Correct outcome pays stake * matchOdds[matchId][outcome] (default 2x)
// into permanent money. Wrong outcome forfeits the stake (already deducted
// at placement). Legacy predictions placed before staking existed (no
// `stake` field) are left alone.
const settlePredictions = async (username) => {
  const wallet = getWallet();
  const userData = touchWallet(wallet, username);
  const pending = userData.predictions.filter((p) => p.status === 'pending' && p.stake != null);
  if (pending.length === 0) return;

  let changed = false;
  for (const prediction of pending) {
    try {
      const match = await fetchFootballData(`matches/${prediction.matchId}`);
      if (match.status !== 'FINISHED') continue;

      const winner = match.score.winner;
      const correct =
        (prediction.outcome === 'home' && winner === 'HOME_TEAM') ||
        (prediction.outcome === 'away' && winner === 'AWAY_TEAM') ||
        (prediction.outcome === 'draw' && winner === 'DRAW');

      const multiplier = getOddsMultiplier(prediction.matchId, prediction.outcome);
      prediction.payout = correct ? Math.round(prediction.stake * multiplier) : 0;
      prediction.status = correct ? 'correct' : 'wrong';
      prediction.settledAt = new Date().toISOString();
      if (correct) userData.money += prediction.payout;
      changed = true;
    } catch {
      // skip if match fetch fails
    }
  }

  if (changed) saveWallet(wallet);
};

// ─── Champion Pick Settlement ─────────────────────────────────
const settleChampionPick = async (username) => {
  const wallet = getWallet();
  const userData = touchWallet(wallet, username);
  const pick = userData.championPick;
  if (!pick || pick.status !== 'pending') return;

  try {
    const match = await fetchFootballData(`matches/${FINAL_MATCH_ID}`);
    if (match.status !== 'FINISHED') return;

    const winner = match.score.winner;
    const championId =
      winner === 'HOME_TEAM' ? match.homeTeam.id :
      winner === 'AWAY_TEAM' ? match.awayTeam.id :
      null;

    const correct = championId != null && pick.teamId === championId;
    const team = championTeamsById.get(pick.teamId);
    const multiplier = team ? team.multiplier : 1;

    pick.status = correct ? 'correct' : 'wrong';
    pick.pointsAwarded = correct ? Math.round(CHAMPION_BASE_POINTS * multiplier) : 0;
    pick.settledAt = new Date().toISOString();
    if (correct) userData.points += pick.pointsAwarded;

    saveWallet(wallet);
  } catch {
    // skip if the final match fetch fails
  }
};

// ─── Auth Routes ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });
  if (username.length < 3)
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const users = getUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken' });

  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed, createdAt: new Date().toISOString() });
  saveUsers(users);

  // Initialize wallet for new user
  const wallet = getWallet();
  touchWallet(wallet, username);
  saveWallet(wallet);

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  const users = getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// ─── Points Routes ───────────────────────────────────────────
app.get('/api/points', verifyToken, async (req, res) => {
  await settlePredictions(req.user.username);
  await settleChampionPick(req.user.username);
  const wallet = getWallet();
  const userData = touchWallet(wallet, req.user.username);
  saveWallet(wallet);
  res.json(userData);
});

// ─── Champion Pick Routes ─────────────────────────────────────
app.get('/api/champion/teams', (req, res) => {
  res.json({ lockAt: new Date(CHAMPION_LOCK_AT).toISOString(), teams: championTeams });
});

app.post('/api/champion-pick', verifyToken, (req, res) => {
  const { teamId } = req.body;
  const team = championTeamsById.get(teamId);
  if (!team)
    return res.status(400).json({ error: 'Unknown team' });
  if (Date.now() >= CHAMPION_LOCK_AT)
    return res.status(400).json({ error: 'Champion picks are locked' });

  const wallet = getWallet();
  const userData = touchWallet(wallet, req.user.username);

  userData.championPick = {
    teamId: team.id,
    name: team.name,
    shortName: team.shortName,
    crest: team.crest,
    placedAt: new Date().toISOString(),
    status: 'pending',
    pointsAwarded: null,
    settledAt: null,
  };
  saveWallet(wallet);

  res.json({ points: userData.points, championPick: userData.championPick });
});

const BETTABLE = ['SCHEDULED', 'TIMED'];

app.post('/api/predictions', verifyToken, async (req, res) => {
  const { matchId, homeTeam, awayTeam, outcome, stake } = req.body;
  if (!matchId || !['home', 'draw', 'away'].includes(outcome))
    return res.status(400).json({ error: 'Missing or invalid fields' });
  if (!Number.isInteger(stake) || stake <= 0)
    return res.status(400).json({ error: 'stake must be a positive integer' });

  const wallet = getWallet();
  const userData = touchWallet(wallet, req.user.username);

  if (userData.predictions.find((p) => p.matchId === matchId))
    return res.status(400).json({ error: 'You already predicted this match' });

  if (stake > availableBalance(userData))
    return res.status(400).json({ error: 'stake exceeds available balance' });

  try {
    const match = await fetchFootballData(`matches/${matchId}`);
    if (!BETTABLE.includes(match.status))
      return res.status(400).json({ error: 'Predictions are closed for this match' });
  } catch {
    return res.status(502).json({ error: 'Could not verify match status' });
  }

  deductStake(userData, stake);

  const prediction = {
    id: Date.now().toString(),
    matchId,
    homeTeam,
    awayTeam,
    outcome,
    stake,
    status: 'pending',
    payout: null,
    placedAt: new Date().toISOString(),
    settledAt: null,
  };
  userData.predictions.unshift(prediction);
  saveWallet(wallet);

  res.json({ money: userData.money, prediction });
});

// ─── Football API Proxy ──────────────────────────────────────
app.get('/api/*', async (req, res) => {
  try {
    const path = req.params[0];
    const query = new URLSearchParams(req.query).toString();
    const data = await fetchFootballData(path, query);
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message;
    console.error(`✗ Error ${status}: ${message}`);
    res.status(status).json({ error: message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running at http://localhost:${PORT}`);
});
