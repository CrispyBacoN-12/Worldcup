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

const ensurePoints = (wallet, username) => {
  if (!wallet[username]) wallet[username] = { points: 0, predictions: [] };
  return wallet[username];
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
// Correct 1x2 prediction = +1 point. Exact score on top of a correct
// outcome = +3 bonus (4 total). Wrong outcome = 0. No staking.
const settlePredictions = async (username) => {
  const wallet = getWallet();
  const userData = ensurePoints(wallet, username);
  const pending = userData.predictions.filter((p) => p.status === 'pending');
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

      const exactScore = correct && prediction.predictedScore &&
        prediction.predictedScore.home === match.score.fullTime.home &&
        prediction.predictedScore.away === match.score.fullTime.away;

      prediction.status = exactScore ? 'exact' : correct ? 'correct' : 'wrong';
      prediction.settledAt = new Date().toISOString();
      if (exactScore) userData.points += 4;
      else if (correct) userData.points += 1;
      changed = true;
    } catch {
      // skip if match fetch fails
    }
  }

  if (changed) saveWallet(wallet);
};

// A predicted score must agree with the chosen outcome (home wins, away
// wins, or a draw) — there is no other valid combination.
const scoreMatchesOutcome = (outcome, home, away) =>
  (outcome === 'home' && home > away) ||
  (outcome === 'away' && away > home) ||
  (outcome === 'draw' && home === away);

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
  ensurePoints(wallet, username);
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
  const wallet = getWallet();
  const userData = ensurePoints(wallet, req.user.username);
  saveWallet(wallet);
  res.json(userData);
});

const BETTABLE = ['SCHEDULED', 'TIMED'];

app.post('/api/predictions', verifyToken, async (req, res) => {
  const { matchId, homeTeam, awayTeam, outcome, predictedScore } = req.body;
  if (!matchId || !['home', 'draw', 'away'].includes(outcome))
    return res.status(400).json({ error: 'Missing or invalid fields' });

  let validatedScore = null;
  if (predictedScore != null) {
    const { home, away } = predictedScore;
    const isNonNegativeInt = (n) => Number.isInteger(n) && n >= 0;
    if (!isNonNegativeInt(home) || !isNonNegativeInt(away))
      return res.status(400).json({ error: 'predictedScore must contain non-negative integers' });
    if (!scoreMatchesOutcome(outcome, home, away))
      return res.status(400).json({ error: 'predictedScore does not match the selected outcome' });
    validatedScore = { home, away };
  }

  const wallet = getWallet();
  const userData = ensurePoints(wallet, req.user.username);

  if (userData.predictions.find((p) => p.matchId === matchId))
    return res.status(400).json({ error: 'You already predicted this match' });

  try {
    const match = await fetchFootballData(`matches/${matchId}`);
    if (!BETTABLE.includes(match.status))
      return res.status(400).json({ error: 'Predictions are closed for this match' });
  } catch {
    return res.status(502).json({ error: 'Could not verify match status' });
  }

  const prediction = {
    id: Date.now().toString(),
    matchId,
    homeTeam,
    awayTeam,
    outcome,
    predictedScore: validatedScore,
    status: 'pending',
    placedAt: new Date().toISOString(),
    settledAt: null,
  };
  userData.predictions.unshift(prediction);
  saveWallet(wallet);

  res.json({ points: userData.points, prediction });
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
