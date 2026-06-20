# Prediction Points System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the virtual-currency betting system with a simple win/draw/away prediction + points model, fix the football-data.org rate-limit/timeout problems with a server-side cache+throttle layer, and lock static fixture data (teams/dates/venues) into a bundled JSON file so pages stop hitting the API just to know the schedule.

**Architecture:** Backend (`server/index.js`) keeps `server/wallet.json` as the per-user store but changes its shape to `{ points, predictions[] }` and exposes `/api/points` + `/api/predictions`. All outbound football-data.org calls go through one cached/throttled helper. The frontend gets a `PointsContext` (replacing `WalletContext`) and reads static schedule data from a bundled `src/data/fixtures.json`, only hitting the API/backend for live score and status.

**Tech Stack:** React 19 (CRA/react-scripts 5), Express, axios, JWT/bcrypt (unchanged). No test framework exists in this repo today (no Jest config for the backend, no component tests beyond the default `src/App.test.js`). Adding one is out of scope for this feature — per-task verification instead uses `curl` against the running backend (assume `node server/index.js` is running on port 5000, as has been the workflow throughout this project) and `npm run build` (CRA's build, which fails on real syntax/import errors) for the frontend. Each task's steps follow the same red→green→commit shape as TDD, just with a verification command instead of a unit test.

## Global Constraints

- Free-tier football-data.org key: ~10 requests/minute — the cache/throttle layer must stay under that (target ≤ 8/min).
- No `odds`, `amount`, `line`, `market`, `payout`, `potential` fields anywhere in the new data model — the points system has no stakes.
- One prediction per match per user.
- `fixtures.json` holds only static fields (`id`, `utcDate`, `stage`, `group`, `venue`, `area`, `competition`, `homeTeam`, `awayTeam`) — never score/status.
- Existing `server/wallet.json` entries (including the 298 seeded `6701001`-`6701298` users) must be reset to `{ points: 0, predictions: [] }` before the new endpoints are exercised by real users.

---

### Task 1: Generate the static fixtures file

**Files:**
- Create (temporary, not committed): `scripts/generateFixtures.js`
- Create (committed): `src/data/fixtures.json`

**Interfaces:**
- Produces: `src/data/fixtures.json` — a JSON array of `{ id: number, utcDate: string, stage: string, group: string|null, venue: string|null, area: object, competition: object, homeTeam: { id, name, shortName, crest }, awayTeam: { id, name, shortName, crest } }`. Later tasks (6, 7, 9) import this file directly.

- [ ] **Step 1: Write the generation script**

```js
// scripts/generateFixtures.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API_KEY = '<football-data.org API key>';
const OUT_FILE = path.join(__dirname, '..', 'src', 'data', 'fixtures.json');

(async () => {
  const res = await axios.get('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': API_KEY },
  });

  const fixtures = res.data.matches.map((m) => ({
    id: m.id,
    utcDate: m.utcDate,
    stage: m.stage,
    group: m.group,
    venue: m.venue,
    area: m.area,
    competition: m.competition,
    homeTeam: {
      id: m.homeTeam.id,
      name: m.homeTeam.name,
      shortName: m.homeTeam.shortName,
      crest: m.homeTeam.crest,
    },
    awayTeam: {
      id: m.awayTeam.id,
      name: m.awayTeam.name,
      shortName: m.awayTeam.shortName,
      crest: m.awayTeam.crest,
    },
  }));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(fixtures, null, 2));
  console.log(`Wrote ${fixtures.length} fixtures to ${OUT_FILE}`);
})();
```

- [ ] **Step 2: Run it**

Run: `node scripts/generateFixtures.js`
Expected: `Wrote <N> fixtures to .../src/data/fixtures.json` where N is the full WC2026 match count (104).

- [ ] **Step 3: Verify the output shape**

Run: `node -e "const f=require('./src/data/fixtures.json'); console.log(f.length, Object.keys(f[0]), f[0].homeTeam)"`
Expected: prints `104 [ 'id', 'utcDate', 'stage', 'group', 'venue', 'area', 'competition', 'homeTeam', 'awayTeam' ]` followed by a team object with `id/name/shortName/crest` — no `score` or `status` key anywhere in `Object.keys(f[0])`.

- [ ] **Step 4: Delete the generation script and commit only the data file**

```bash
rm scripts/generateFixtures.js
git add src/data/fixtures.json
git commit -m "Add static WC2026 fixtures data file"
```

---

### Task 2: Cache + throttle helper for football-data.org calls

**Files:**
- Modify: `server/index.js`

**Interfaces:**
- Produces: `fetchFootballData(path: string, query?: string): Promise<any>` — resolves to the same JSON shape `axios.get(...).then(r => r.data)` would have returned. Task 3 calls this from `settlePredictions`.

- [ ] **Step 1: Add the cache/throttle helper, right after the `JWT_SECRET`/file-path constants and before the file helpers**

```js
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
```

- [ ] **Step 2: Wire the existing proxy route through the helper**

Replace the current `/api/*` handler body:

```js
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
```

- [ ] **Step 3: Restart the server and verify caching behavior**

Run (with the server running on port 5000):
```bash
curl -s -o /dev/null -w "first:  %{time_total}s\n" http://localhost:5000/api/competitions/WC/standings
curl -s -o /dev/null -w "second: %{time_total}s\n" http://localhost:5000/api/competitions/WC/standings
```
Expected: the `second` call completes noticeably faster than `first` (no outbound network round-trip — served from `apiCache`).

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "Add cache+throttle layer for football-data.org requests"
```

---

### Task 3: Backend points system (data model + endpoints)

**Files:**
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `fetchFootballData(path, query?)` from Task 2.
- Produces: `GET /api/points` (auth required) → `{ points: number, predictions: Prediction[] }`. `POST /api/predictions` (auth required, body `{ matchId, homeTeam, awayTeam, outcome }`) → `{ points: number, prediction: Prediction }`. `Prediction = { id, matchId, homeTeam, awayTeam, outcome: 'home'|'draw'|'away', status: 'pending'|'correct'|'wrong', placedAt, settledAt }`. These replace `GET /api/wallet` and `POST /api/wallet/bet`, which are removed.

- [ ] **Step 1: Rename `ensureWallet` to `ensurePoints` with the new default shape**

Replace:
```js
const ensureWallet = (wallet, username) => {
  if (!wallet[username]) wallet[username] = { balance: 10000, bets: [] };
  return wallet[username];
};
```
with:
```js
const ensurePoints = (wallet, username) => {
  if (!wallet[username]) wallet[username] = { points: 0, predictions: [] };
  return wallet[username];
};
```

- [ ] **Step 2: Replace `settleBets` with `settlePredictions`, using `fetchFootballData`**

Replace the whole `settleBets` function with:

```js
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

      prediction.status = correct ? 'correct' : 'wrong';
      prediction.settledAt = new Date().toISOString();
      if (correct) userData.points += 1;
      changed = true;
    } catch {
      // skip if match fetch fails
    }
  }

  if (changed) saveWallet(wallet);
};
```

- [ ] **Step 3: Update the registration handler to call `ensurePoints`**

In `app.post('/api/auth/register', ...)`, replace:
```js
  const wallet = getWallet();
  ensureWallet(wallet, username);
  saveWallet(wallet);
```
with:
```js
  const wallet = getWallet();
  ensurePoints(wallet, username);
  saveWallet(wallet);
```

- [ ] **Step 4: Replace the wallet routes with the points routes**

Replace both `app.get('/api/wallet', ...)` and `app.post('/api/wallet/bet', ...)` with:

```js
app.get('/api/points', verifyToken, async (req, res) => {
  await settlePredictions(req.user.username);
  const wallet = getWallet();
  const userData = ensurePoints(wallet, req.user.username);
  saveWallet(wallet);
  res.json(userData);
});

app.post('/api/predictions', verifyToken, (req, res) => {
  const { matchId, homeTeam, awayTeam, outcome } = req.body;
  if (!matchId || !['home', 'draw', 'away'].includes(outcome))
    return res.status(400).json({ error: 'Missing or invalid fields' });

  const wallet = getWallet();
  const userData = ensurePoints(wallet, req.user.username);

  if (userData.predictions.find((p) => p.matchId === matchId))
    return res.status(400).json({ error: 'You already predicted this match' });

  const prediction = {
    id: Date.now().toString(),
    matchId,
    homeTeam,
    awayTeam,
    outcome,
    status: 'pending',
    placedAt: new Date().toISOString(),
    settledAt: null,
  };
  userData.predictions.unshift(prediction);
  saveWallet(wallet);

  res.json({ points: userData.points, prediction });
});
```

- [ ] **Step 5: Restart the server and verify with curl**

```bash
curl -s -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" -d '{"username":"plantest_pts","password":"password123"}'
```
Expected: `{"token":"...","username":"plantest_pts"}` — copy the token into `$TOKEN` for the next commands.

```bash
curl -s http://localhost:5000/api/points -H "Authorization: Bearer $TOKEN"
```
Expected: `{"points":0,"predictions":[]}`

```bash
curl -s -X POST http://localhost:5000/api/predictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"matchId":999999,"homeTeam":"A","awayTeam":"B","outcome":"home"}'
```
Expected: `{"points":0,"prediction":{"id":"...","matchId":999999,"homeTeam":"A","awayTeam":"B","outcome":"home","status":"pending","placedAt":"...","settledAt":null}}`

```bash
curl -s -X POST http://localhost:5000/api/predictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"matchId":999999,"homeTeam":"A","awayTeam":"B","outcome":"away"}'
```
Expected: `{"error":"You already predicted this match"}` (duplicate-match rejection works)

```bash
curl -s -X POST http://localhost:5000/api/wallet/bet -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```
Expected: `Cannot POST /api/wallet/bet` (old route is gone)

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "Replace wallet/betting endpoints with points/predictions endpoints"
```

---

### Task 4: Reset existing wallet data to the new shape

**Files:**
- Create (temporary, not committed): `scripts/resetPoints.js`
- Modify (data only): `server/wallet.json`

**Interfaces:**
- Consumes: nothing from other tasks (pure data migration), but must run after Task 3 so the new shape is the one being migrated to.

- [ ] **Step 1: Write the reset script**

```js
// scripts/resetPoints.js
const fs = require('fs');
const path = require('path');

const WALLET_FILE = path.join(__dirname, '..', 'server', 'wallet.json');
const wallet = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));

for (const username of Object.keys(wallet)) {
  wallet[username] = { points: 0, predictions: [] };
}

fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
console.log(`Reset ${Object.keys(wallet).length} users to { points: 0, predictions: [] }`);
```

- [ ] **Step 2: Run it**

Run: `node scripts/resetPoints.js`
Expected: `Reset <N> users to { points: 0, predictions: [] }` where N includes the 298 seeded users plus any others (`test`, `testuser2`, `Tester`, etc.) and the `plantest_pts` user created in Task 3.

- [ ] **Step 3: Verify**

Run: `node -e "const w=require('./server/wallet.json'); const bad=Object.entries(w).filter(([,v]) => !('points' in v) || !('predictions' in v)); console.log('bad entries:', bad.length)"`
Expected: `bad entries: 0`

- [ ] **Step 4: Delete the script (data file stays modified)**

```bash
rm scripts/resetPoints.js
```

No commit needed for `server/wallet.json` itself — it is runtime data, not yet tracked by git (the whole `server/` directory is currently untracked).

---

### Task 5: Rename `WalletContext` to `PointsContext` and update all consumers

**Files:**
- Create: `src/PointsContext.js`
- Delete: `src/WalletContext.js`
- Modify: `src/navbar.js`, `src/Prediction.js`, `src/MatchDetail.js`, `src/BetHistory.js`, `src/App.js`

**Interfaces:**
- Produces: `PointsProvider` (React component), `usePoints(): { points: number|null, predictions: Prediction[], fetchPoints: () => Promise<void>, submitPrediction: (data: { matchId, homeTeam, awayTeam, outcome }) => Promise<{ points, prediction }> }`.
- This task only renames the interface and mechanically updates call sites (`useWallet` → `usePoints`, `balance` → `points`, `bets` → `predictions`, `placeBet` → `submitPrediction`). Wording ("coin" → "point") and fixtures-based data loading are separate later tasks — this task's only goal is "same behavior, new names, app still builds."

- [ ] **Step 1: Create `src/PointsContext.js`**

```js
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
```

- [ ] **Step 2: Delete the old context file**

```bash
rm src/WalletContext.js
```

- [ ] **Step 3: Update `src/App.js`**

Change the imports:
```js
import { WalletProvider } from './WalletContext';
```
to:
```js
import { PointsProvider } from './PointsContext';
```

Change the provider usage:
```jsx
    <AuthProvider>
      <WalletProvider>
        <Router>
```
to:
```jsx
    <AuthProvider>
      <PointsProvider>
        <Router>
```
and the matching closing tag `</WalletProvider>` to `</PointsProvider>`.

- [ ] **Step 4: Update `src/navbar.js`**

Change:
```js
import { useWallet } from './WalletContext';
```
to:
```js
import { usePoints } from './PointsContext';
```
Change:
```js
  const { balance } = useWallet();
```
to:
```js
  const { points } = usePoints();
```
Change the balance display block:
```jsx
          {balance !== null && (
            <span className="navbar-balance">
              🪙 {balance.toLocaleString()}
            </span>
          )}
```
to:
```jsx
          {points !== null && (
            <span className="navbar-balance">
              🪙 {points.toLocaleString()}
            </span>
          )}
```
(icon/wording cleanup happens in Task 10 — this step only renames the variable.)

- [ ] **Step 5: Update `src/Prediction.js`**

Change:
```js
import { useWallet } from './WalletContext';
```
to:
```js
import { usePoints } from './PointsContext';
```
Change:
```js
  const { balance, bets, placeBet } = useWallet();
```
to:
```js
  const { points, predictions: serverPredictions, submitPrediction } = usePoints();
```
Change every remaining use of `balance` in the JSX to `points`, every use of `bets` to `serverPredictions`, and the call:
```js
      await placeBet({
        matchId: match.id,
        homeTeam: match.homeTeam.shortName || match.homeTeam.name,
        awayTeam: match.awayTeam.shortName || match.awayTeam.name,
        outcome,
      });
```
to:
```js
      await submitPrediction({
        matchId: match.id,
        homeTeam: match.homeTeam.shortName || match.homeTeam.name,
        awayTeam: match.awayTeam.shortName || match.awayTeam.name,
        outcome,
      });
```

- [ ] **Step 6: Update `src/MatchDetail.js`**

Change:
```js
import { useWallet } from './WalletContext';
```
to:
```js
import { usePoints } from './PointsContext';
```
Change:
```js
  const { bets, placeBet } = useWallet();
```
to:
```js
  const { predictions, submitPrediction } = usePoints();
```
Change:
```js
  const existing = bets?.find(b => b.matchId === Number(matchId));
```
to:
```js
  const existing = predictions?.find(p => p.matchId === Number(matchId));
```
Change the `placeBet({...})` call inside `handleSubmit` to `submitPrediction({...})` (same argument shape).
Change every remaining `existing.status === 'won'` / `'lost'` check to `existing.status === 'correct'` / `'wrong'` (the new status vocabulary from Task 3) in both the icon logic and the meta text.

- [ ] **Step 7: Update `src/BetHistory.js`**

Change:
```js
import { useWallet } from './WalletContext';
```
to:
```js
import { usePoints } from './PointsContext';
```
Change:
```js
  const { balance, bets, fetchWallet } = useWallet();

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);
```
to:
```js
  const { points, predictions, fetchPoints } = usePoints();

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);
```
Rename the local variable `bets` to `predictions` everywhere it's used below (`bets.map`, `bets.filter`, `bets.length`) and `balance` to `points`. Leave the `won`/`lost` status strings as-is for now — Task 8 rewrites this file's status vocabulary and layout properly.

- [ ] **Step 8: Verify the app builds**

Run: `npm run build`
Expected: build succeeds (`Compiled successfully` or `Compiled with warnings` — warnings about unused vars are fine, but there must be no `Failed to compile` error referencing `WalletContext`, `useWallet`, `balance`, `bets`, or `placeBet`).

- [ ] **Step 9: Commit**

```bash
git add src/PointsContext.js src/App.js src/navbar.js src/Prediction.js src/MatchDetail.js src/BetHistory.js
git rm src/WalletContext.js
git commit -m "Rename WalletContext to PointsContext across the app"
```

---

### Task 6: `Prediction.js` — use fixtures.json, drop coin wording

**Files:**
- Modify: `src/Prediction.js`, `src/Prediction.css`

**Interfaces:**
- Consumes: `src/data/fixtures.json` (Task 1), `usePoints()` (Task 5).

- [ ] **Step 1: Replace the API-driven match list with the static fixtures list, filtered to "upcoming"**

Replace:
```js
import axios from 'axios';
import { useWallet } from './WalletContext';
import './Prediction.css';

const API_KEY = process.env.REACT_APP_FOOTBALL_API_KEY;
const BASE_URL = '/v4';

const Prediction = () => {
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [saved, setSaved] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
```
with:
```js
import fixtures from './data/fixtures.json';
import { usePoints } from './PointsContext';
import './Prediction.css';

const Prediction = () => {
  const [predictions, setPredictions] = useState({});
  const [saved, setSaved] = useState({});
```
(`matches`, `loading`, `error` are no longer needed — there's no fetch to track.)

Replace the `useEffect` that fetches matches:
```js
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('wc_predictions') || '{}');
    setPredictions(stored);

    const fetch = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${BASE_URL}/competitions/WC/matches?status=SCHEDULED&status=TIMED`, {
          headers: { 'X-Auth-Token': API_KEY },
        });
        setMatches(res.data.matches.slice(0, 20));
      } catch {
        setError('Failed to load upcoming matches.');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);
```
with:
```js
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('wc_predictions') || '{}');
    setPredictions(stored);
  }, []);

  const matches = fixtures
    .filter((m) => new Date(m.utcDate).getTime() > Date.now())
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, 20);
```

Remove the now-unused `loading`/`error` guard renders:
```js
  if (loading) return <div className="loading"><div className="spinner" /><span>Loading upcoming matches...</span></div>;
  if (error) return <div className="error-box">{error}</div>;
  if (matches.length === 0) return (
```
becomes:
```js
  if (matches.length === 0) return (
```

- [ ] **Step 2: Wire `usePoints` and update wording**

Replace:
```js
  const { balance, bets, placeBet } = useWallet();
```
with:
```js
  const { points, predictions: serverPredictions, submitPrediction } = usePoints();
```
(this matches Task 5's mechanical rename — Task 5 already did this; this step is a no-op if Task 5 ran first, included here so this task is self-contained if executed standalone.)

Replace the balance bar:
```jsx
      {balance !== null && (
        <div className="balance-bar">
          <span className="balance-label">Your Score</span>
          <span className="balance-amount">{balance.toLocaleString()} <span className="balance-unit">coins</span></span>
        </div>
      )}
```
with:
```jsx
      {points !== null && (
        <div className="balance-bar">
          <span className="balance-label">Your Points</span>
          <span className="balance-amount">{points.toLocaleString()}</span>
        </div>
      )}
```

Replace:
```js
          const existing = bets?.find(b => b.matchId === match.id);
```
with:
```js
          const existing = serverPredictions?.find((p) => p.matchId === match.id);
```

Replace the section title and result text:
```jsx
                <div className="bet-section-title">Predict Winner (+1 coin if correct)</div>
```
with:
```jsx
                <div className="bet-section-title">Predict Winner (+1 point if correct)</div>
```
and:
```jsx
                        {existing.status === 'pending'
                          ? 'Waiting for result…'
                          : existing.status === 'won'
                            ? 'Correct! +1 coin 🪙'
                            : 'Wrong — 0 coins'}
```
with:
```jsx
                        {existing.status === 'pending'
                          ? 'Waiting for result…'
                          : existing.status === 'correct'
                            ? 'Correct! +1 point ⭐'
                            : 'Wrong — 0 points'}
```

Replace the `handleSubmitPick` body's `placeBet` call with `submitPrediction` (same args), matching Task 5.

- [ ] **Step 3: Drop the now-unused `balance-unit` CSS class**

In `src/Prediction.css`, delete the `.balance-unit { ... }` rule block (lines 30-36) since the markup no longer renders a `coins` unit span.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: succeeds with no errors. Then run `npm start`, open `/prediction` in the browser, and confirm: the page renders upcoming matches with no network request to `football-data.org` for the match list (check the Network tab — there should be no call to `/v4/competitions/WC/matches` from this page), and picking Home/Draw/Away and confirming still posts to `/api/predictions`.

- [ ] **Step 5: Commit**

```bash
git add src/Prediction.js src/Prediction.css
git commit -m "Prediction page reads schedule from static fixtures, drops coin wording"
```

---

### Task 7: `MatchDetail.js` — use fixtures.json for match metadata

**Files:**
- Modify: `src/MatchDetail.js`

**Interfaces:**
- Consumes: `src/data/fixtures.json` (Task 1), `usePoints()` (Task 5).
- The live score/status still comes from the backend proxy (`/v4/matches/:id` → `server/index.js`'s `/api/*` route, now cached per Task 2); only the team names/crests come from the static file as a fallback while that request is in flight or if it fails.

- [ ] **Step 1: Import fixtures and use them as the initial match state**

Replace:
```js
import { useWallet } from './WalletContext';
import './MatchDetail.css';
```
with:
```js
import fixtures from './data/fixtures.json';
import { usePoints } from './PointsContext';
import './MatchDetail.css';
```

Replace:
```js
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
```
with:
```js
  const staticMatch = fixtures.find((f) => f.id === Number(matchId)) || null;
  const [match, setMatch] = useState(staticMatch);
  const [loading, setLoading] = useState(!staticMatch);
  const [error, setError] = useState(null);
```

- [ ] **Step 2: Merge live score/status onto the static fixture instead of fully replacing it**

Replace:
```js
  useEffect(() => {
    const fetchData = async () => {
      try {
        const matchRes = await axios.get(`/v4/matches/${matchId}`, {
          headers: { 'X-Auth-Token': process.env.REACT_APP_FOOTBALL_API_KEY },
        });
        setMatch(matchRes.data);
      } catch {
        setError('Failed to load match details.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [matchId]);
```
with:
```js
  useEffect(() => {
    const fetchData = async () => {
      try {
        const matchRes = await axios.get(`/v4/matches/${matchId}`, {
          headers: { 'X-Auth-Token': process.env.REACT_APP_FOOTBALL_API_KEY },
        });
        setMatch(matchRes.data);
      } catch {
        if (!staticMatch) setError('Failed to load match details.');
        // else: keep showing the static fixture (teams/date) with no live score
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);
```

- [ ] **Step 3: Guard the score-dependent rendering for the static-only fallback**

The static fixture has no `status`/`score`. Replace:
```js
  if (loading) return <div className="loading"><div className="spinner" /><span>Loading match...</span></div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!match) return null;

  const canPredict = BETTABLE.includes(match.status);
```
with:
```js
  if (loading) return <div className="loading"><div className="spinner" /><span>Loading match...</span></div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!match) return null;

  const canPredict = BETTABLE.includes(match.status || 'SCHEDULED');
```
and the score-hero conditional:
```jsx
          {['FINISHED', 'IN_PLAY', 'PAUSED'].includes(match.status) ? (
```
with:
```jsx
          {match.status && ['FINISHED', 'IN_PLAY', 'PAUSED'].includes(match.status) ? (
```
and the `closedLabel` computation:
```js
  const closedLabel = match.status === 'FINISHED'
    ? 'This match has finished — predictions are closed.'
    : ['IN_PLAY', 'PAUSED'].includes(match.status)
      ? 'This match is in play — predictions are closed.'
      : 'Predictions are not available for this match.';
```
stays as-is (it's only read when `canPredict` is false, and `match.status` will be a real value by then in the common case; if it's ever `undefined` it falls through to the generic "not available" message, which is correct).

- [ ] **Step 4: Update the points wording (Task 5 already renamed the hook; this step is the coin→point text)**

Replace every occurrence of `+1 coin` with `+1 point`, `🪙` with `⭐`, and `won`/`lost` status checks with `correct`/`wrong`:
```jsx
              {canPredict && !existing && <span className="bet-hint">— Correct = +1 coin</span>}
```
→
```jsx
              {canPredict && !existing && <span className="bet-hint">— Correct = +1 point</span>}
```
```js
                    {existing.status === 'won' ? '✅' : existing.status === 'lost' ? '❌' : '🎯'}
```
→
```js
                    {existing.status === 'correct' ? '✅' : existing.status === 'wrong' ? '❌' : '🎯'}
```
```jsx
                      {existing.status === 'pending'
                        ? 'Waiting for the match to finish…'
                        : existing.status === 'won'
                          ? 'Correct! You earned +1 coin 🪙'
                          : 'Wrong prediction — 0 coins'}
```
→
```jsx
                      {existing.status === 'pending'
                        ? 'Waiting for the match to finish…'
                        : existing.status === 'correct'
                          ? 'Correct! You earned +1 point ⭐'
                          : 'Wrong prediction — 0 points'}
```
```jsx
                  <div className="detail-bet-prompt">Pick a result above — correct gets you +1 coin</div>
```
→
```jsx
                  <div className="detail-bet-prompt">Pick a result above — correct gets you +1 point</div>
```
```jsx
          <div className="odds-footer">Predict the winner — correct = 1 coin, wrong = 0</div>
```
→
```jsx
          <div className="odds-footer">Predict the winner — correct = 1 point, wrong = 0</div>
```

- [ ] **Step 5: Prune dead odds/amount CSS from `src/MatchDetail.css`**

The current `MatchDetail.js` never renders an odds value or an amount input (it only renders Home/Draw/Away pick buttons), so these rule blocks in `src/MatchDetail.css` are dead and can be deleted:
- `.odd-value { ... }`
- `.odds-container.multi-line { ... }`
- `.detail-bet-input { ... }`, `.detail-bet-input::-webkit-inner-spin-button, .detail-bet-input::-webkit-outer-spin-button { ... }`, `.detail-bet-input:focus { ... }`
- `.detail-bet-coin { ... }`
- `.detail-bet-potential { ... }`
- `.detail-balance { ... }`

Leave `.hc-line` alone — it's pre-existing dead CSS unrelated to this feature (no handicap UI ever rendered it in the current codebase), not introduced by this refactor; removing it is optional cleanup, not required for spec coverage.

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: succeeds with no errors.

Manual check: `npm start`, navigate to `/match/<a real matchId from fixtures.json>`. Confirm team names/crest render immediately (from the static file) even before the live `/v4/matches/:id` call resolves, and that the score/status still updates once that call completes.

- [ ] **Step 7: Commit**

```bash
git add src/MatchDetail.js src/MatchDetail.css
git commit -m "MatchDetail uses static fixtures for team/date metadata and points wording"
```

---

### Task 8: Rename `BetHistory` to `PredictionHistory` and simplify

**Files:**
- Create: `src/PredictionHistory.js`, `src/PredictionHistory.css`
- Delete: `src/BetHistory.js`, `src/BetHistory.css`

**Interfaces:**
- Consumes: `usePoints()` (Task 5).
- This component no longer needs `market`/`line`/`odds`/`amount`/`payout` display logic — every prediction is now a single Home/Draw/Away pick.

- [ ] **Step 1: Create `src/PredictionHistory.js`**

```js
import React, { useEffect } from 'react';
import { usePoints } from './PointsContext';
import './PredictionHistory.css';

const pickLabel = (prediction) => {
  if (prediction.outcome === 'home') return prediction.homeTeam;
  if (prediction.outcome === 'away') return prediction.awayTeam;
  return 'Draw';
};

const StatusBadge = ({ status }) => {
  const map = {
    pending: { label: 'Pending', cls: 'badge-pending' },
    correct: { label: 'Correct', cls: 'badge-won' },
    wrong:   { label: 'Wrong',   cls: 'badge-lost' },
  };
  const { label, cls } = map[status] || { label: status, cls: '' };
  return <span className={`bet-badge ${cls}`}>{label}</span>;
};

const PredictionHistory = () => {
  const { points, predictions, fetchPoints } = usePoints();

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  const correct = predictions.filter((p) => p.status === 'correct').length;
  const wrong = predictions.filter((p) => p.status === 'wrong').length;

  return (
    <div className="bets-page">
      <div className="page-header">
        <h1 className="page-title">MY PREDICTIONS</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Prediction History</p>
      </div>

      <div className="wallet-summary card">
        <div className="summary-item">
          <span className="summary-label">Points</span>
          <span className="summary-value gold">{points !== null ? points.toLocaleString() : '—'}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">Correct</span>
          <span className="summary-value green">{correct}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Wrong</span>
          <span className="summary-value red">{wrong}</span>
        </div>
      </div>

      {predictions.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          No predictions yet. Go to Predict to make your first pick!
        </div>
      ) : (
        <div className="bets-list">
          {predictions.map((prediction) => (
            <div key={prediction.id} className={`bet-card card ${prediction.status}`}>
              <div className="bet-card-header">
                <div className="bet-match">
                  <span className="bet-home">{prediction.homeTeam}</span>
                  <span className="bet-vs">vs</span>
                  <span className="bet-away">{prediction.awayTeam}</span>
                </div>
                <StatusBadge status={prediction.status} />
              </div>

              <div className="bet-card-body">
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Your Pick</span>
                  <span className="bet-detail-value pick">{pickLabel(prediction)}</span>
                </div>
                <div className="bet-detail-row">
                  <span className="bet-detail-label">Result</span>
                  <span className={`bet-detail-value ${prediction.status === 'correct' ? 'green' : prediction.status === 'wrong' ? 'red' : 'gold'}`}>
                    {prediction.status === 'pending' ? 'Pending' : prediction.status === 'correct' ? '+1 point' : '0 points'}
                  </span>
                </div>
              </div>

              <div className="bet-card-footer">
                {new Date(prediction.placedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PredictionHistory;
```

- [ ] **Step 2: Create `src/PredictionHistory.css` from the old file, dropping money-specific rules**

Copy `src/BetHistory.css` to `src/PredictionHistory.css`, then delete these rule blocks that no longer apply (no `coin-unit` span, no `bet-market-tag` badge, no `summary-divider` between Won/Lost since this version only has one divider — keep the rest of the layout/badge/card styling unchanged):
- `.coin-unit { ... }`
- `.bet-market-tag { ... }`

(Every other rule — `.bets-page`, `.wallet-summary`, `.summary-item`, `.summary-label`, `.summary-value` and its `.gold/.green/.red` variants, `.bets-list`, `.bet-card` and its status variants, `.bet-card-header`, `.bet-match`, `.bet-vs`, `.bet-badge` and its variants, `.bet-card-body`, `.bet-detail-row/label/value` and variants, `.bet-card-footer`, the `@media` block — is still used by the new JSX above and stays unchanged.)

- [ ] **Step 3: Delete the old files**

```bash
rm src/BetHistory.js src/BetHistory.css
```

- [ ] **Step 4: Update `src/App.js` to use the new component and route**

Replace:
```js
import BetHistory from './BetHistory';
```
with:
```js
import PredictionHistory from './PredictionHistory';
```
Replace:
```jsx
          <Route path="/bets" element={<ProtectedRoute><BetHistory /></ProtectedRoute>} />
```
with:
```jsx
          <Route path="/predictions" element={<ProtectedRoute><PredictionHistory /></ProtectedRoute>} />
```

- [ ] **Step 5: Update the nav link in `src/navbar.js`**

Replace:
```jsx
          <li><NavLink to="/bets" onClick={() => setMenuOpen(false)}>My Predictions</NavLink></li>
```
with:
```jsx
          <li><NavLink to="/predictions" onClick={() => setMenuOpen(false)}>My Predictions</NavLink></li>
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: succeeds with no errors, no remaining reference to `BetHistory` anywhere (`grep -rn "BetHistory" src` returns nothing).

Manual check: `npm start`, click "My Predictions" in the nav, confirm it loads `/predictions` and shows the summary card + list (or the empty state).

- [ ] **Step 7: Commit**

```bash
git add src/PredictionHistory.js src/PredictionHistory.css src/App.js src/navbar.js
git rm src/BetHistory.js src/BetHistory.css
git commit -m "Rename BetHistory to PredictionHistory and drop market/odds display"
```

---

### Task 9: `Home.js` — fixtures as base, live score/status merged in

**Files:**
- Modify: `src/Home.js`

**Interfaces:**
- Consumes: `src/data/fixtures.json` (Task 1). No dependency on the points system.

- [ ] **Step 1: Seed state from the static fixtures, then merge in live data**

Replace:
```js
import axios from 'axios';
import './Home.css';

const API_KEY = process.env.REACT_APP_FOOTBALL_API_KEY;
const BASE_URL = '/v4';

const Home = () => {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/competitions/WC/matches`, {
          headers: { 'X-Auth-Token': API_KEY },
        });
        const fetchedMatches = res.data.matches;
        setMatches(fetchedMatches);
      } catch (err) {
        setError('Failed to load matches. Check your API key.');
      } finally {
        setLoading(false);
      }
    };
    fetchMatches();
  }, []);
```
with:
```js
import axios from 'axios';
import fixtures from './data/fixtures.json';
import './Home.css';

const API_KEY = process.env.REACT_APP_FOOTBALL_API_KEY;
const BASE_URL = '/v4';

const baseMatches = fixtures
  .slice()
  .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
  .map((f) => ({ ...f, status: 'SCHEDULED', score: { fullTime: { home: null, away: null } } }));

const Home = () => {
  const [matches, setMatches] = useState(baseMatches);
  const [loading, setLoading] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/competitions/WC/matches`, {
          headers: { 'X-Auth-Token': API_KEY },
        });
        const liveById = new Map(res.data.matches.map((m) => [m.id, m]));
        setMatches(baseMatches.map((m) => liveById.get(m.id) || m));
      } catch {
        setLiveError(true);
      }
    };
    fetchLiveData();
  }, []);
```

- [ ] **Step 2: Remove the old loading/error gates and add a quiet live-data warning instead**

Replace:
```js
  if (loading) return (
    <div className="loading">
      <div className="spinner" />
      <span>Loading matches...</span>
    </div>
  );

  if (error) return <div className="error-box">{error}</div>;

  return (
```
with:
```js
  return (
```
(remove the unused `loading` state setter call too — `setLoading` is no longer needed since the page renders immediately from `baseMatches`; delete the `const [loading, setLoading] = useState(false);` line and replace `if (loading) ...` removal above with nothing, since there's no longer a loading phase.)

Then, right after `<p className="page-subtitle">FIFA World Cup 2026</p>`, add:
```jsx
      {liveError && (
        <div className="error-box" style={{ marginBottom: '1rem' }}>
          Showing scheduled fixtures — live scores are temporarily unavailable.
        </div>
      )}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: succeeds with no errors (no unused `loading`/`error`/`setLoading` left behind — `grep -n "setLoading\|useState(true)" src/Home.js` should return nothing for the old loading state).

Manual check: `npm start`, open `/` — the match list should render immediately (no spinner) with all 104 fixtures, then scores/status fill in once the live call resolves. Stop the backend server and refresh: the page should still show the full fixture list (with `VS` placeholders) plus the "Showing scheduled fixtures…" notice, instead of a blank error page.

- [ ] **Step 4: Commit**

```bash
git add src/Home.js
git commit -m "Home page renders from static fixtures with live score/status merged in"
```

---

### Task 10: Final wording pass + end-to-end smoke test

**Files:**
- Modify: `src/navbar.js`

**Interfaces:**
- None new — this task only finishes the cosmetic rename started in Task 5 and does the full smoke test across all prior tasks.

- [ ] **Step 1: Finish the navbar wording**

Replace:
```jsx
          {points !== null && (
            <span className="navbar-balance">
              🪙 {points.toLocaleString()}
            </span>
          )}
```
with:
```jsx
          {points !== null && (
            <span className="navbar-balance">
              ⭐ {points.toLocaleString()} pts
            </span>
          )}
```

- [ ] **Step 2: Full build check**

Run: `npm run build`
Expected: `Compiled successfully` (warnings OK, no errors). Run `grep -rln "useWallet\|WalletContext\|placeBet\|🪙\|coin" src` — expected: no matches (everything renamed/reworded).

- [ ] **Step 3: Manual end-to-end smoke test**

With the backend running (`node server/index.js`) and frontend running (`npm start`):
1. Register a fresh test user, confirm login redirects to `/` and the navbar shows `⭐ 0 pts`.
2. Open `/match/<id>` for an upcoming match, pick a winner, confirm the navbar points value doesn't change yet (no settlement until the match finishes) but `/predictions` now lists the pick as "Pending".
3. Open `/prediction`, confirm the same upcoming matches appear (loaded from `fixtures.json`, no `/v4/competitions/WC/matches` call in the Network tab for this page) and that picking a result there also lands in `/predictions`.
4. Open `/` (Home), confirm fixtures render immediately and scores fill in for `FINISHED`/`IN_PLAY` matches.
5. Open `/standings`, confirm it still loads (now via the cached `/api/competitions/WC/standings` route from Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/navbar.js
git commit -m "Finish points wording in the navbar"
```
