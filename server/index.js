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
const CHAMPION_TEAMS_FILE = nodePath.join(__dirname, 'data', 'championTeams.json');
const championTeams = JSON.parse(fs.readFileSync(CHAMPION_TEAMS_FILE, 'utf8'));
const championTeamsById = new Map(championTeams.map((t) => [t.id, t]));

const ODDS_SHEET_CSV_URL = process.env.ODDS_SHEET_CSV_URL;
const ODDS_CACHE_TTL_MS = 60 * 1000;
const OUTCOMES = ['home', 'draw', 'away', '1X', '12', 'X2'];
let oddsCache = { data: {}, fetchedAt: 0 };

// One row per match: matchId, home, draw, away, 1X, 12, X2 (header required,
// columns located by name). Blank/non-numeric cells mean "no odds for that
// outcome" — they're simply omitted from the parsed result.
const parseOddsCsv = (csvText) => {
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const result = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    header.forEach((col, i) => { row[col] = cells[i]; });
    const matchId = row.matchId;
    if (!matchId) continue;

    const outcomes = {};
    for (const outcome of OUTCOMES) {
      const raw = row[outcome];
      const value = Number(raw);
      if (raw !== undefined && raw !== '' && !Number.isNaN(value)) {
        outcomes[outcome] = value;
      }
    }
    result[matchId] = outcomes;
  }
  return result;
};

const fetchOddsFromSheet = async () => {
  if (Date.now() - oddsCache.fetchedAt < ODDS_CACHE_TTL_MS) return oddsCache.data;
  try {
    const res = await axios.get(ODDS_SHEET_CSV_URL);
    oddsCache = { data: parseOddsCsv(res.data), fetchedAt: Date.now() };
  } catch {
    // Keep serving whatever was cached before (or {} if nothing has ever
    // succeeded) — a sheet hiccup shouldn't wipe out odds that were working.
    oddsCache = { ...oddsCache, fetchedAt: Date.now() };
  }
  return oddsCache.data;
};

const getOddsMultiplier = (odds, matchId, outcome) => odds[matchId]?.[outcome];

const PLAYER_ODDS_SHEET_CSV_URL = process.env.PLAYER_ODDS_SHEET_CSV_URL;
let playerOddsCache = { data: {}, fetchedAt: 0 };

// One row per player: playerId, multiplier. Doesn't need to cover every
// live scorer candidate — only whichever player(s) have a row get a
// non-default multiplier; everyone else falls back to 1 at settlement.
const parsePlayerOddsCsv = (csvText) => {
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const playerIdCol = header.indexOf('playerId');
  const multiplierCol = header.indexOf('multiplier');
  const result = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',').map((c) => c.trim());
    const playerId = cells[playerIdCol];
    const value = Number(cells[multiplierCol]);
    if (playerId && !Number.isNaN(value)) {
      result[playerId] = value;
    }
  }
  return result;
};

const fetchPlayerOddsFromSheet = async () => {
  if (Date.now() - playerOddsCache.fetchedAt < ODDS_CACHE_TTL_MS) return playerOddsCache.data;
  try {
    const res = await axios.get(PLAYER_ODDS_SHEET_CSV_URL);
    playerOddsCache = { data: parsePlayerOddsCsv(res.data), fetchedAt: Date.now() };
  } catch {
    playerOddsCache = { ...playerOddsCache, fetchedAt: Date.now() };
  }
  return playerOddsCache.data;
};

const FIXTURES_FILE = nodePath.join(__dirname, 'data', 'fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
const DAILY_ALLOWANCE_PER_MATCH = 100;
const GRANT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const matchCountOn = (dateStr) =>
  fixtures.filter((m) => m.stage !== 'GROUP_STAGE' && m.utcDate.slice(0, 10) === dateStr).length;

// One-off manual overrides for a specific day's total allowance (UTC date ->
// total coins for that day). Used when the per-match formula doesn't match the
// matches players can actually predict that day. Days not listed use the formula.
const ALLOWANCE_OVERRIDE = { '2026-06-29': 300 };
const allowanceForDay = (dateStr) =>
  ALLOWANCE_OVERRIDE[dateStr] ?? DAILY_ALLOWANCE_PER_MATCH * matchCountOn(dateStr);

// Champion + Top Scorer picks reopened — lock at Thai midnight tonight
// (00:00 of 30 Jun 2026, UTC+7 = 17:00Z on 29 Jun).
const CHAMPION_LOCK_AT = new Date('2026-06-29T17:00:00Z').getTime();
// The FINAL-stage match id from src/data/fixtures.json (teams resolve once the bracket completes).
const FINAL_MATCH_ID = 537390;
const CHAMPION_BASE_POINTS = 100;

// Top Scorer picks lock alongside the Champion pick.
const AWARD_LOCK_AT = CHAMPION_LOCK_AT;
const AWARDS_FILE = nodePath.join(__dirname, 'data', 'awards.json');
const AWARD_TYPES = ['topScorer'];
const AWARD_BASE_POINTS = 100;
// The actual Top Scorer isn't exposed by the football-data API, so the
// result is filled in here by hand once it's officially announced.
const getAwards = () => JSON.parse(fs.readFileSync(AWARDS_FILE, 'utf8'));

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

// ─── Storage (file on local, MongoDB on Render) ──────────────
const storage = require('./storage');
const { getUsers, saveUsers, getWallet, saveWallet } = storage;

// Wallet reads/writes are "fetch whole document, mutate, write whole
// document" — not atomic. Two concurrent requests for the same user (two
// tabs, a fast double-click, React re-mounting) can both read before either
// writes, double-granting the daily allowance or losing one request's
// changes. Serialize all wallet-touching work per username so requests for
// the same user queue instead of racing; different users still run in
// parallel.
const userLocks = new Map();
const withUserLock = (username, fn) => {
  const tail = userLocks.get(username) || Promise.resolve();
  const result = tail.then(fn, fn);
  const nextTail = result.then(() => {}, () => {});
  userLocks.set(username, nextTail);
  nextTail.then(() => {
    if (userLocks.get(username) === nextTail) userLocks.delete(username);
  });
  return result;
};

// Ensures the wallet record exists, folds any expired or unstaked daily
// money into points (money only ever becomes points — it never just
// vanishes), and grants today's allowance (100 * today's match count) if it
// hasn't been given yet.
const touchWallet = (wallet, username) => {
  if (!wallet[username])
    wallet[username] = { points: 0, predictions: [], dailyGrants: [], lastAllowanceDate: null, stepPrediction: null };
  const userData = wallet[username];
  if (!userData.dailyGrants) userData.dailyGrants = [];
  if (userData.points == null) userData.points = 0;
  if (userData.stepPrediction === undefined) userData.stepPrediction = null;

  // One-time migration from the earlier permanent-money-pool design.
  if (userData.money) userData.points += userData.money;
  delete userData.money;

  const now = Date.now();
  let expiredAmount = 0;
  userData.dailyGrants = userData.dailyGrants.filter((g) => {
    const alive = now - new Date(g.grantedAt).getTime() < GRANT_EXPIRY_MS;
    if (!alive) expiredAmount += g.remaining;
    return alive;
  });
  userData.points += expiredAmount;

  const today = todayUtc();
  const target = allowanceForDay(today);
  if (userData.lastAllowanceDate !== today) {
    if (target > 0) {
      userData.dailyGrants.push({ amount: target, grantedAt: new Date().toISOString(), remaining: target });
    }
    userData.lastAllowanceDate = today;
    userData.lastAllowanceAmount = target;
  } else {
    // Top up only if today's allowance was raised after it was first granted.
    // Track the granted total in lastAllowanceAmount (NOT by summing dailyGrants):
    // spent grants are deleted by deductStake, so summing them would undercount
    // and re-grant the full allowance every time a player spends to zero.
    if (userData.lastAllowanceAmount == null) userData.lastAllowanceAmount = target;
    if (target > userData.lastAllowanceAmount) {
      const diff = target - userData.lastAllowanceAmount;
      userData.dailyGrants.push({ amount: diff, grantedAt: new Date().toISOString(), remaining: diff });
      userData.lastAllowanceAmount = target;
    }
  }

  return userData;
};

const availableBalance = (userData) =>
  userData.dailyGrants.reduce((sum, g) => sum + g.remaining, 0);

// Deducts from the soonest-expiring grants first. Caller must have already
// checked stake <= availableBalance.
const deductStake = (userData, amount) => {
  let remaining = amount;
  for (const grant of userData.dailyGrants) {
    if (remaining <= 0) break;
    const take = Math.min(grant.remaining, remaining);
    grant.remaining -= take;
    remaining -= take;
  }
  userData.dailyGrants = userData.dailyGrants.filter((g) => g.remaining > 0);
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

const outcomeWins = (outcome, winner) => {
  if (outcome === 'home') return winner === 'HOME_TEAM';
  if (outcome === 'away') return winner === 'AWAY_TEAM';
  if (outcome === 'draw') return winner === 'DRAW';
  if (outcome === '1X') return winner === 'HOME_TEAM' || winner === 'DRAW';
  if (outcome === '12') return winner === 'HOME_TEAM' || winner === 'AWAY_TEAM';
  if (outcome === 'X2') return winner === 'DRAW' || winner === 'AWAY_TEAM';
  return false;
};

// ─── Prediction Settlement ───────────────────────────────────
// Correct outcome converts stake * matchOdds[matchId][outcome] (default 2x)
// into points — winnings are points, not stakeable money. Wrong outcome
// forfeits the stake (already deducted at placement). Legacy predictions
// placed before staking existed (no `stake` field) are left alone.
const settlePredictions = async (username) => {
  const wallet = await getWallet();
  const userData = touchWallet(wallet, username);
  const pending = userData.predictions.filter((p) => p.status === 'pending' && p.stake != null);
  if (pending.length === 0) return;

  let changed = false;
  for (const prediction of pending) {
    try {
      const match = await fetchFootballData(`matches/${prediction.matchId}`);
      if (match.status !== 'FINISHED') continue;

      const correct = outcomeWins(prediction.outcome, match.score.winner);

      // Odds can change in the sheet between placement and settlement; fall
      // back to the multiplier of 1 (no winnings beyond the stake) rather
      // than letting a missing row turn a real win into a NaN payout.
      const odds = await fetchOddsFromSheet();
      const multiplier = getOddsMultiplier(odds, prediction.matchId, prediction.outcome) ?? 1;
      prediction.payout = correct ? Math.round(prediction.stake * multiplier) : 0;
      prediction.status = correct ? 'correct' : 'wrong';
      prediction.settledAt = new Date().toISOString();
      if (correct) userData.points += prediction.payout;
      changed = true;
    } catch {
      // skip if match fetch fails
    }
  }

  if (changed) await saveWallet(wallet);
};

// ─── Step (Parlay) Settlement ─────────────────────────────────
// A step wins only if every leg is correct. As soon as any leg's match
// finishes with the wrong result, the whole step settles as 'wrong'
// immediately — no need to wait on the remaining legs.
const settleStepPrediction = async (username) => {
  const wallet = await getWallet();
  const userData = touchWallet(wallet, username);
  const step = userData.stepPrediction;
  if (!step || step.status !== 'pending') return;

  let anyWrong = false;
  let allCorrect = true;
  let changed = false;

  for (const leg of step.legs) {
    if (leg.status !== 'pending') {
      if (leg.status === 'wrong') anyWrong = true;
      continue;
    }
    allCorrect = false;
    try {
      const match = await fetchFootballData(`matches/${leg.matchId}`);
      if (match.status !== 'FINISHED') continue;

      leg.status = outcomeWins(leg.outcome, match.score.winner) ? 'correct' : 'wrong';
      changed = true;
      if (leg.status === 'wrong') anyWrong = true;
    } catch {
      // skip if match fetch fails
    }
  }

  if (anyWrong) {
    step.status = 'wrong';
    step.payout = 0;
    step.settledAt = new Date().toISOString();
    changed = true;
  } else if (allCorrect) {
    step.status = 'correct';
    step.payout = Math.round(step.stake * step.combinedMultiplier);
    step.settledAt = new Date().toISOString();
    userData.points += step.payout;
    changed = true;
  }

  if (changed) await saveWallet(wallet);
};

// ─── Champion Pick Settlement ─────────────────────────────────
const settleChampionPick = async (username) => {
  const wallet = await getWallet();
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

    await saveWallet(wallet);
  } catch {
    // skip if the final match fetch fails
  }
};

// ─── Award Pick Settlement ────────────────────────────────────
// The actual Top Scorer winner is entered by hand in
// server/data/awards.json once FIFA announces it (see getAwards above).
const settleAwardPicks = async (username) => {
  const wallet = await getWallet();
  const userData = touchWallet(wallet, username);
  if (!userData.awardPicks) return;

  const awards = getAwards();
  let changed = false;
  for (const type of AWARD_TYPES) {
    const pick = userData.awardPicks[type];
    const actual = awards[type];
    if (!pick || pick.status !== 'pending' || !actual || actual.actualPlayerId == null) continue;

    const correct = pick.playerId === actual.actualPlayerId;
    if (correct) {
      const playerOdds = await fetchPlayerOddsFromSheet();
      const multiplier = playerOdds[actual.actualPlayerId] ?? 1;
      pick.pointsAwarded = Math.round(AWARD_BASE_POINTS * multiplier);
    } else {
      pick.pointsAwarded = 0;
    }
    pick.status = correct ? 'correct' : 'wrong';
    pick.settledAt = new Date().toISOString();
    if (correct) userData.points += pick.pointsAwarded;
    changed = true;
  }

  if (changed) await saveWallet(wallet);
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

  const users = await getUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken' });

  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed, createdAt: new Date().toISOString() });
  await saveUsers(users);

  // Initialize wallet for new user
  await withUserLock(username, async () => {
    const wallet = await getWallet();
    touchWallet(wallet, username);
    await saveWallet(wallet);
  });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  const users = await getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// ─── Points Routes ───────────────────────────────────────────
app.get('/api/points', verifyToken, async (req, res) => {
  const userData = await withUserLock(req.user.username, async () => {
    await settlePredictions(req.user.username);
    await settleStepPrediction(req.user.username);
    await settleChampionPick(req.user.username);
    await settleAwardPicks(req.user.username);
    const wallet = await getWallet();
    const data = touchWallet(wallet, req.user.username);
    await saveWallet(wallet);
    return data;
  });
  res.json(userData);
});

// ─── Leaderboard Route ────────────────────────────────────────
app.get('/api/leaderboard', verifyToken, async (req, res) => {
  const wallet = await getWallet();
  const leaderboard = Object.entries(wallet)
    .map(([username, data]) => ({ username, points: data.points || 0 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 50);
  res.json({ leaderboard });
});

// ─── Champion Pick Routes ─────────────────────────────────────
app.get('/api/champion/teams', (req, res) => {
  res.json({ lockAt: new Date(CHAMPION_LOCK_AT).toISOString(), teams: championTeams });
});

app.get('/api/odds', async (req, res) => {
  const odds = await fetchOddsFromSheet();
  res.json({ odds });
});

app.get('/api/awards/meta', (req, res) => {
  res.json({ lockAt: new Date(AWARD_LOCK_AT).toISOString() });
});

app.post('/api/champion-pick', verifyToken, async (req, res) => {
  const { teamId } = req.body;
  const team = championTeamsById.get(teamId);
  if (!team)
    return res.status(400).json({ error: 'Unknown team' });
  if (Date.now() >= CHAMPION_LOCK_AT)
    return res.status(400).json({ error: 'Champion picks are locked' });

  const userData = await withUserLock(req.user.username, async () => {
    const wallet = await getWallet();
    const data = touchWallet(wallet, req.user.username);

    data.championPick = {
      teamId: team.id,
      name: team.name,
      shortName: team.shortName,
      crest: team.crest,
      placedAt: new Date().toISOString(),
      status: 'pending',
      pointsAwarded: null,
      settledAt: null,
    };
    await saveWallet(wallet);
    return data;
  });

  res.json({ points: userData.points, championPick: userData.championPick });
});

// ─── Award Pick Routes (Top Scorer) ───────────────────────────
app.post('/api/award-pick', verifyToken, async (req, res) => {
  const { type, playerId, playerName, teamName } = req.body;
  if (!AWARD_TYPES.includes(type))
    return res.status(400).json({ error: 'Unknown award type' });
  if (!playerId || !playerName)
    return res.status(400).json({ error: 'Missing player' });
  if (Date.now() >= AWARD_LOCK_AT)
    return res.status(400).json({ error: 'Award picks are locked' });

  const userData = await withUserLock(req.user.username, async () => {
    const wallet = await getWallet();
    const data = touchWallet(wallet, req.user.username);
    if (!data.awardPicks) data.awardPicks = {};

    data.awardPicks[type] = {
      playerId,
      playerName,
      teamName: teamName || null,
      placedAt: new Date().toISOString(),
      status: 'pending',
      pointsAwarded: null,
      settledAt: null,
    };
    await saveWallet(wallet);
    return data;
  });

  res.json({ points: userData.points, awardPicks: userData.awardPicks });
});

const BETTABLE = ['SCHEDULED', 'TIMED'];

app.post('/api/predictions', verifyToken, async (req, res) => {
  const { matchId, homeTeam, awayTeam, outcome, stake } = req.body;
  if (!matchId || !OUTCOMES.includes(outcome))
    return res.status(400).json({ error: 'Missing or invalid fields' });
  if (!Number.isInteger(stake) || stake <= 0)
    return res.status(400).json({ error: 'stake must be a positive integer' });

  let errorResponse = null;
  const result = await withUserLock(req.user.username, async () => {
    const wallet = await getWallet();
    const userData = touchWallet(wallet, req.user.username);

    if (userData.predictions.find((p) => p.matchId === matchId)) {
      errorResponse = { status: 400, error: 'You already predicted this match' };
      return null;
    }

    if (stake > availableBalance(userData)) {
      errorResponse = { status: 400, error: 'stake exceeds available balance' };
      return null;
    }

    try {
      const match = await fetchFootballData(`matches/${matchId}`);
      if (!BETTABLE.includes(match.status)) {
        errorResponse = { status: 400, error: 'Predictions are closed for this match' };
        return null;
      }
    } catch {
      errorResponse = { status: 502, error: 'Could not verify match status' };
      return null;
    }

    const odds = await fetchOddsFromSheet();
    const multiplier = getOddsMultiplier(odds, matchId, outcome);
    if (multiplier == null) {
      errorResponse = { status: 400, error: 'Odds are not available for this match yet' };
      return null;
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
    await saveWallet(wallet);

    return { availableBalance: availableBalance(userData), prediction };
  });

  if (errorResponse) return res.status(errorResponse.status).json({ error: errorResponse.error });
  res.json(result);
});

const STEP_MIN_LEGS = 2;
const STEP_MAX_LEGS = 10;

app.post('/api/step-predictions', verifyToken, async (req, res) => {
  const { legs, stake } = req.body;
  if (!Array.isArray(legs) || legs.length < STEP_MIN_LEGS || legs.length > STEP_MAX_LEGS)
    return res.status(400).json({ error: `Step must have ${STEP_MIN_LEGS}-${STEP_MAX_LEGS} matches` });
  if (!legs.every((l) => l && l.matchId && OUTCOMES.includes(l.outcome) && l.homeTeam && l.awayTeam))
    return res.status(400).json({ error: 'Missing or invalid fields' });
  if (!Number.isInteger(stake) || stake <= 0)
    return res.status(400).json({ error: 'stake must be a positive integer' });

  const legMatchIds = legs.map((l) => l.matchId);
  if (new Set(legMatchIds).size !== legMatchIds.length)
    return res.status(400).json({ error: 'Each match can only appear once in a step' });

  let errorResponse = null;
  const result = await withUserLock(req.user.username, async () => {
    const wallet = await getWallet();
    const userData = touchWallet(wallet, req.user.username);

    if (userData.stepPrediction && userData.stepPrediction.status === 'pending') {
      errorResponse = { status: 400, error: 'You already have an open step' };
      return null;
    }

    const alreadyPicked = new Set(userData.predictions.map((p) => p.matchId));
    if (legMatchIds.some((id) => alreadyPicked.has(id))) {
      errorResponse = { status: 400, error: 'You already predicted one of these matches' };
      return null;
    }

    if (stake > availableBalance(userData)) {
      errorResponse = { status: 400, error: 'stake exceeds available balance' };
      return null;
    }

    let combinedMultiplier = 1;
    try {
      const odds = await fetchOddsFromSheet();
      for (const leg of legs) {
        const match = await fetchFootballData(`matches/${leg.matchId}`);
        if (!BETTABLE.includes(match.status)) {
          errorResponse = { status: 400, error: 'Predictions are closed for one of these matches' };
          return null;
        }
        const multiplier = getOddsMultiplier(odds, leg.matchId, leg.outcome);
        if (multiplier == null) {
          errorResponse = { status: 400, error: 'Odds are not available for one of these matches yet' };
          return null;
        }
        combinedMultiplier *= multiplier;
      }
    } catch {
      errorResponse = { status: 502, error: 'Could not verify match status' };
      return null;
    }

    deductStake(userData, stake);

    const stepPrediction = {
      id: Date.now().toString(),
      legs: legs.map((l) => ({
        matchId: l.matchId,
        homeTeam: l.homeTeam,
        awayTeam: l.awayTeam,
        outcome: l.outcome,
        status: 'pending',
      })),
      stake,
      combinedMultiplier,
      status: 'pending',
      payout: null,
      placedAt: new Date().toISOString(),
      settledAt: null,
    };
    userData.stepPrediction = stepPrediction;
    await saveWallet(wallet);

    return { availableBalance: availableBalance(userData), stepPrediction };
  });

  if (errorResponse) return res.status(errorResponse.status).json({ error: errorResponse.error });
  res.json(result);
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
storage.init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('✗ Storage init failed:', err.message);
    process.exit(1);
  });
