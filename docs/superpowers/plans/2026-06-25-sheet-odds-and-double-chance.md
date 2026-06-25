# Google Sheet Odds Feed & Double Chance Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `server/data/matchOdds.json` odds file with a live feed pulled from a published Google Sheet (CSV), and add Double Chance betting markets (1X, 12, X2) alongside the existing 1X2 (home/draw/away) market, for both single predictions and step (parlay) bets.

**Architecture:** Backend fetches and caches the published CSV in memory (same in-process caching idiom as the existing football-data API cache), parses it into a `{ matchId: { outcome: multiplier } }` map, and serves it via the existing `/api/odds` route. The outcome set grows from 3 values to 6 (`home`, `draw`, `away`, `1X`, `12`, `X2`); a single `outcomeWins(outcome, winner)` helper replaces the duplicated 3-way correctness checks in both settlement functions. Missing odds (sheet has no row, or a fetch has never succeeded) make that match/outcome unbettable rather than falling back to a default. Frontend renders 6 outcome buttons per match instead of 3, disabling any button whose odds are unavailable.

**Tech Stack:** Express (`server/index.js`), axios (already a dependency, reused for the CSV fetch — no new dependency added), React (`src/Prediction.js`, `src/PointsContext.js`, `src/PredictionHistory.js`). No backend test framework is configured in this codebase (no test script in `server/package.json`, no test files) — verification is manual, via `node -e` sanity checks for pure functions and `curl`/the running app for integration, consistent with every prior plan in `docs/superpowers/plans/`.

## Global Constraints

- Sheet CSV columns (header row required, located by name not position): `matchId, home, draw, away, 1X, 12, X2`. Cell values are decimal multipliers (e.g. `2.1`); empty/non-numeric cells mean "no odds for this outcome."
- `ODDS_SHEET_CSV_URL` is a new env var (`server/.env` locally, a Render env var in production) holding the published-CSV URL. Not committed to git (`.env` is already gitignored).
- Cache TTL for the CSV fetch: 60 seconds (`ODDS_CACHE_TTL_MS = 60_000`).
- If a CSV fetch fails (network error, non-200, unparseable) and a previous successful fetch exists, keep serving that stale cached data. Only a fetch that has *never* succeeded results in empty odds.
- A match/outcome with no available multiplier is a hard rejection at bet-placement time (`400`), not a default multiplier. There is no more "default ×2" anywhere in the system.
- Outcome enum everywhere it's validated or displayed: `['home', 'draw', 'away', '1X', '12', 'X2']`.
- Double Chance correctness: `1X` wins on `HOME_TEAM` or `DRAW`; `12` wins on `HOME_TEAM` or `AWAY_TEAM`; `X2` wins on `DRAW` or `AWAY_TEAM`.
- `src/MatchDetail.js` has no betting UI (removed in an earlier change) — this plan does not touch it.
- `server/data/matchOdds.json` and the `DEFAULT_ODDS_MULTIPLIER` constant are deleted, not deprecated-in-place.

---

### Task 1: Sheet-backed odds cache, wired into `GET /api/odds`

**Files:**
- Modify: `server/index.js:28-31` (odds setup block) and `server/index.js:398-400` (`/api/odds` route)
- Delete: `server/data/matchOdds.json`

**Interfaces:**
- Produces: `async function fetchOddsFromSheet()` → resolves to `{ [matchId: string]: { [outcome: string]: number } }` (only outcomes with a valid numeric cell are present). Task 2 calls this before settling/validating any prediction. `OUTCOMES` constant (`['home', 'draw', 'away', '1X', '12', 'X2']`) is also defined here — Task 2, Task 4, and Task 5 all reference it (Task 4/5 redeclare their own copy in frontend files since there's no shared module between server and client in this codebase; match the array exactly).

- [ ] **Step 1: Remove the static odds file and its constants**

Delete `server/data/matchOdds.json`:

```bash
rm "server/data/matchOdds.json"
```

In `server/index.js`, replace lines 28-31:

```js
const MATCH_ODDS_FILE = nodePath.join(__dirname, 'data', 'matchOdds.json');
const matchOdds = JSON.parse(fs.readFileSync(MATCH_ODDS_FILE, 'utf8'));
const DEFAULT_ODDS_MULTIPLIER = 2;
const getOddsMultiplier = (matchId, outcome) => matchOdds[matchId]?.[outcome] ?? DEFAULT_ODDS_MULTIPLIER;
```

with:

```js
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
```

- [ ] **Step 2: Sanity-check `parseOddsCsv` in isolation before wiring it up**

Run this from the project root — it pastes the same function body to check edge cases (header order independence, missing cells, unknown matchId rows) before it's relied on by the live route:

```bash
node -e "
const OUTCOMES = ['home', 'draw', 'away', '1X', '12', 'X2'];
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

const csv = 'draw,matchId,home,away,1X,12,X2\n2.5,111,1.8,,1.2,1.1,1.9\n3.0,222,2.0,2.0,,,';
const parsed = parseOddsCsv(csv);
console.log(JSON.stringify(parsed, null, 2));
console.assert(parsed['111'].home === 1.8, 'home odds for 111');
console.assert(parsed['111'].away === undefined, 'blank away cell omitted');
console.assert(parsed['222']['1X'] === undefined, 'blank 1X cell omitted');
console.assert(parsed['111']['1X'] === 1.2, 'column order independent of position');
console.log('ALL ASSERTIONS PASSED');
"
```

Expected output ends with `ALL ASSERTIONS PASSED` and the printed JSON shows `"111": { "draw": 2.5, "home": 1.8, "1X": 1.2, "12": 1.1, "X2": 1.9 }` (no `away` key) and `"222": { "draw": 3, "home": 2, "away": 2 }` (no `1X`/`12`/`X2` keys).

- [ ] **Step 3: Update the `/api/odds` route to serve the live-fetched data**

Replace (around line 398, find by searching for `app.get('/api/odds'`):

```js
app.get('/api/odds', (req, res) => {
  res.json({ odds: matchOdds, defaultMultiplier: DEFAULT_ODDS_MULTIPLIER });
});
```

with:

```js
app.get('/api/odds', async (req, res) => {
  const odds = await fetchOddsFromSheet();
  res.json({ odds });
});
```

- [ ] **Step 4: Verify end-to-end against a local test CSV server**

This starts the real backend pointed at a throwaway local CSV server, confirms `/api/odds` returns the parsed shape, then tears both down. Run from the project root:

```bash
node -e "
const http = require('http');
const csv = 'matchId,home,draw,away,1X,12,X2\n555,1.9,3.1,4.0,1.3,1.1,1.7\n';
http.createServer((req, res) => { res.writeHead(200); res.end(csv); }).listen(5099, () => console.log('csv server up'));
" &
echo $! > /tmp/csvserver.pid
sleep 1
ODDS_SHEET_CSV_URL=http://localhost:5099 node server/index.js &
echo $! > /tmp/oddsserver.pid
sleep 2
curl -s http://localhost:5000/api/odds
echo
kill $(cat /tmp/oddsserver.pid) $(cat /tmp/csvserver.pid)
```

Expected output: `{"odds":{"555":{"home":1.9,"draw":3.1,"away":4,"1X":1.3,"12":1.1,"X2":1.7}}}`

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git rm server/data/matchOdds.json
git commit -m "Replace static match odds with live Google Sheet CSV feed"
```

---

### Task 2: Double Chance outcome enum + shared settlement logic + endpoint validation

**Files:**
- Modify: `server/index.js:181-270` (`settlePredictions`, `settleStepPrediction`)
- Modify: `server/index.js:462-569` (`/api/predictions`, `/api/step-predictions`)

**Interfaces:**
- Consumes: `OUTCOMES`, `fetchOddsFromSheet()`, `getOddsMultiplier(odds, matchId, outcome)` from Task 1.
- Produces: `outcomeWins(outcome, winner)` — used only within this task's two settlement functions.

- [ ] **Step 1: Add the shared `outcomeWins` helper and use it in `settlePredictions`**

Add directly above `settlePredictions` (around line 181):

```js
const outcomeWins = (outcome, winner) => {
  if (outcome === 'home') return winner === 'HOME_TEAM';
  if (outcome === 'away') return winner === 'AWAY_TEAM';
  if (outcome === 'draw') return winner === 'DRAW';
  if (outcome === '1X') return winner === 'HOME_TEAM' || winner === 'DRAW';
  if (outcome === '12') return winner === 'HOME_TEAM' || winner === 'AWAY_TEAM';
  if (outcome === 'X2') return winner === 'DRAW' || winner === 'AWAY_TEAM';
  return false;
};
```

In `settlePredictions`, replace:

```js
      const winner = match.score.winner;
      const correct =
        (prediction.outcome === 'home' && winner === 'HOME_TEAM') ||
        (prediction.outcome === 'away' && winner === 'AWAY_TEAM') ||
        (prediction.outcome === 'draw' && winner === 'DRAW');

      const multiplier = getOddsMultiplier(prediction.matchId, prediction.outcome);
      prediction.payout = correct ? Math.round(prediction.stake * multiplier) : 0;
```

with:

```js
      const correct = outcomeWins(prediction.outcome, match.score.winner);

      // Odds can change in the sheet between placement and settlement; fall
      // back to the multiplier of 1 (no winnings beyond the stake) rather
      // than letting a missing row turn a real win into a NaN payout.
      const odds = await fetchOddsFromSheet();
      const multiplier = getOddsMultiplier(odds, prediction.matchId, prediction.outcome) ?? 1;
      prediction.payout = correct ? Math.round(prediction.stake * multiplier) : 0;
```

- [ ] **Step 2: Use `outcomeWins` in `settleStepPrediction` too**

Replace this whole block (it spans from the `winner` lookup through the `anyWrong` update right after it):

```js
      const winner = match.score.winner;
      const correct =
        (leg.outcome === 'home' && winner === 'HOME_TEAM') ||
        (leg.outcome === 'away' && winner === 'AWAY_TEAM') ||
        (leg.outcome === 'draw' && winner === 'DRAW');

      leg.status = correct ? 'correct' : 'wrong';
      changed = true;
      if (!correct) anyWrong = true;
```

with:

```js
      leg.status = outcomeWins(leg.outcome, match.score.winner) ? 'correct' : 'wrong';
      changed = true;
      if (leg.status === 'wrong') anyWrong = true;
```

- [ ] **Step 3: Verify `outcomeWins` covers all six outcomes correctly**

```bash
node -e "
const outcomeWins = (outcome, winner) => {
  if (outcome === 'home') return winner === 'HOME_TEAM';
  if (outcome === 'away') return winner === 'AWAY_TEAM';
  if (outcome === 'draw') return winner === 'DRAW';
  if (outcome === '1X') return winner === 'HOME_TEAM' || winner === 'DRAW';
  if (outcome === '12') return winner === 'HOME_TEAM' || winner === 'AWAY_TEAM';
  if (outcome === 'X2') return winner === 'DRAW' || winner === 'AWAY_TEAM';
  return false;
};
console.assert(outcomeWins('1X', 'HOME_TEAM') === true, '1X vs HOME_TEAM');
console.assert(outcomeWins('1X', 'DRAW') === true, '1X vs DRAW');
console.assert(outcomeWins('1X', 'AWAY_TEAM') === false, '1X vs AWAY_TEAM');
console.assert(outcomeWins('12', 'DRAW') === false, '12 vs DRAW');
console.assert(outcomeWins('12', 'HOME_TEAM') === true, '12 vs HOME_TEAM');
console.assert(outcomeWins('X2', 'AWAY_TEAM') === true, 'X2 vs AWAY_TEAM');
console.assert(outcomeWins('X2', 'HOME_TEAM') === false, 'X2 vs HOME_TEAM');
console.log('ALL ASSERTIONS PASSED');
"
```

Expected output: `ALL ASSERTIONS PASSED`

- [ ] **Step 4: Extend outcome validation and add the odds-availability check in `/api/predictions`**

Replace:

```js
app.post('/api/predictions', verifyToken, async (req, res) => {
  const { matchId, homeTeam, awayTeam, outcome, stake } = req.body;
  if (!matchId || !['home', 'draw', 'away'].includes(outcome))
    return res.status(400).json({ error: 'Missing or invalid fields' });
```

with:

```js
app.post('/api/predictions', verifyToken, async (req, res) => {
  const { matchId, homeTeam, awayTeam, outcome, stake } = req.body;
  if (!matchId || !OUTCOMES.includes(outcome))
    return res.status(400).json({ error: 'Missing or invalid fields' });
```

Then, right after the existing `BETTABLE` status check block (which currently ends with the `catch { return res.status(502)... }` before `deductStake(userData, stake);`), insert the odds check:

```js
  try {
    const match = await fetchFootballData(`matches/${matchId}`);
    if (!BETTABLE.includes(match.status))
      return res.status(400).json({ error: 'Predictions are closed for this match' });
  } catch {
    return res.status(502).json({ error: 'Could not verify match status' });
  }

  const odds = await fetchOddsFromSheet();
  const multiplier = getOddsMultiplier(odds, matchId, outcome);
  if (multiplier == null)
    return res.status(400).json({ error: 'Odds are not available for this match yet' });

  deductStake(userData, stake);
```

- [ ] **Step 5: Same two changes in `/api/step-predictions`**

Replace:

```js
  if (!legs.every((l) => l && l.matchId && ['home', 'draw', 'away'].includes(l.outcome) && l.homeTeam && l.awayTeam))
    return res.status(400).json({ error: 'Missing or invalid fields' });
```

with:

```js
  if (!legs.every((l) => l && l.matchId && OUTCOMES.includes(l.outcome) && l.homeTeam && l.awayTeam))
    return res.status(400).json({ error: 'Missing or invalid fields' });
```

Replace the multiplier-accumulation loop:

```js
  let combinedMultiplier = 1;
  try {
    for (const leg of legs) {
      const match = await fetchFootballData(`matches/${leg.matchId}`);
      if (!BETTABLE.includes(match.status))
        return res.status(400).json({ error: 'Predictions are closed for one of these matches' });
      combinedMultiplier *= getOddsMultiplier(leg.matchId, leg.outcome);
    }
  } catch {
    return res.status(502).json({ error: 'Could not verify match status' });
  }
```

with:

```js
  let combinedMultiplier = 1;
  try {
    const odds = await fetchOddsFromSheet();
    for (const leg of legs) {
      const match = await fetchFootballData(`matches/${leg.matchId}`);
      if (!BETTABLE.includes(match.status))
        return res.status(400).json({ error: 'Predictions are closed for one of these matches' });
      const multiplier = getOddsMultiplier(odds, leg.matchId, leg.outcome);
      if (multiplier == null)
        return res.status(400).json({ error: 'Odds are not available for one of these matches yet' });
      combinedMultiplier *= multiplier;
    }
  } catch {
    return res.status(502).json({ error: 'Could not verify match status' });
  }
```

- [ ] **Step 6: Verify the running server end-to-end (odds-unavailable rejection)**

With the backend running (`PORT` default 5000, no `ODDS_SHEET_CSV_URL` set so the cache stays `{}`), register a user and attempt a prediction:

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" -d '{"username":"plantest","password":"plantest123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
curl -s -X POST http://localhost:5000/api/predictions -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"matchId":537390,"homeTeam":"A","awayTeam":"B","outcome":"1X","stake":10}'
```

Expected output: `{"error":"Odds are not available for this match yet"}` with HTTP 400 (no odds configured, so every outcome is rejected — this confirms the fail-closed behavior from the Global Constraints, and that `'1X'` is now accepted by the outcome-shape validation rather than being rejected as an invalid field).

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "Add Double Chance outcomes (1X/12/X2) with odds-availability gating"
```

---

### Task 3: Frontend — `PointsContext.js` drops the default-multiplier fallback

**Files:**
- Modify: `src/PointsContext.js:15-31`

**Interfaces:**
- Consumes: `/api/odds` response shape `{ odds }` (no more `defaultMultiplier` field, per Task 1).
- Produces: `getMultiplier(matchId, outcome)` now returns `number | undefined` (previously always a `number`). Task 4 and Task 5 both branch on this return value.

- [ ] **Step 1: Remove the `defaultMultiplier` state and fallback**

Replace:

```js
  const [odds, setOdds] = useState({});
  const [defaultMultiplier, setDefaultMultiplier] = useState(2);

  useEffect(() => {
    axios.get(`${BASE}/api/odds`)
      .then((res) => {
        setOdds(res.data.odds ?? {});
        setDefaultMultiplier(res.data.defaultMultiplier ?? 2);
      })
      .catch(() => {});
  }, []);

  const getMultiplier = useCallback(
    (matchId, outcome) => odds[matchId]?.[outcome] ?? defaultMultiplier,
    [odds, defaultMultiplier]
  );
```

with:

```js
  const [odds, setOdds] = useState({});

  useEffect(() => {
    axios.get(`${BASE}/api/odds`)
      .then((res) => setOdds(res.data.odds ?? {}))
      .catch(() => {});
  }, []);

  const getMultiplier = useCallback(
    (matchId, outcome) => odds[matchId]?.[outcome],
    [odds]
  );
```

- [ ] **Step 2: Verify the frontend still compiles**

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup" && CI=true npm run build
```

Expected output ends with `Compiled successfully.` `Prediction.js` still renders only 3 outcome buttons at this point and doesn't yet branch on `getMultiplier` returning `undefined` — that's fine, Task 4 handles it. This step only confirms `PointsContext.js` itself has no syntax/reference errors.

- [ ] **Step 3: Commit**

```bash
git add src/PointsContext.js
git commit -m "Drop default-multiplier fallback now that odds are availability-gated"
```

---

### Task 4: Frontend — `Prediction.js` six-outcome grid with odds-aware disabling

**Files:**
- Modify: `src/Prediction.js` (outcome lists at lines 234-248, 298-312; `outcomeLabel` at lines 121-124; existing-bet displays at lines 177, 219-220)
- Modify: `src/Prediction.css` (extend `.bet-outcomes` grid for 6 buttons; add a disabled-button style)

**Interfaces:**
- Consumes: `getMultiplier(matchId, outcome) => number | undefined` from Task 3.

- [ ] **Step 1: Define the shared outcome list and extend `outcomeLabel`**

In `src/Prediction.js`, replace the `outcomeLabel` function (lines 121-124):

```js
  const outcomeLabel = (match, outcome) =>
    outcome === 'home' ? (match.homeTeam.shortName || match.homeTeam.name)
    : outcome === 'away' ? (match.awayTeam.shortName || match.awayTeam.name)
    : 'Draw';
```

with:

```js
  const homeAbbr = (match) => match.homeTeam.shortName || match.homeTeam.name;
  const awayAbbr = (match) => match.awayTeam.shortName || match.awayTeam.name;

  const outcomeLabel = (match, outcome) => {
    if (outcome === 'home') return homeAbbr(match);
    if (outcome === 'away') return awayAbbr(match);
    if (outcome === 'draw') return 'Draw';
    if (outcome === '1X') return `${homeAbbr(match)} or Draw`;
    if (outcome === '12') return `${homeAbbr(match)} or ${awayAbbr(match)}`;
    if (outcome === 'X2') return `Draw or ${awayAbbr(match)}`;
    return outcome;
  };

  const outcomeButtons = (match) => [
    { key: 'home', label: homeAbbr(match) },
    { key: 'draw', label: 'Draw' },
    { key: 'away', label: awayAbbr(match) },
    { key: '1X', label: '1X' },
    { key: '12', label: '12' },
    { key: 'X2', label: 'X2' },
  ];
```

- [ ] **Step 2: Use `outcomeButtons` + odds-aware disabling in Single mode**

Replace the Single-mode outcome row (lines 234-248):

```js
                      <div className="bet-outcomes">
                        {[
                          { key: 'home', label: match.homeTeam.shortName || match.homeTeam.name },
                          { key: 'draw', label: 'Draw' },
                          { key: 'away', label: match.awayTeam.shortName || match.awayTeam.name },
                        ].map(({ key, label }) => (
                          <button
                            key={key}
                            className={`bet-outcome-btn ${pick === key ? 'selected' : ''}`}
                            onClick={() => setPick(match.id, key)}
                          >
                            <span className="outcome-label">{label}</span>
                          </button>
                        ))}
                      </div>
```

with:

```js
                      <div className="bet-outcomes">
                        {outcomeButtons(match).map(({ key, label }) => {
                          const multiplier = getMultiplier(match.id, key);
                          const unavailable = multiplier == null;
                          return (
                            <button
                              key={key}
                              className={`bet-outcome-btn ${pick === key ? 'selected' : ''}`}
                              onClick={() => !unavailable && setPick(match.id, key)}
                              disabled={unavailable}
                            >
                              <span className="outcome-label">{label}</span>
                              <span className="outcome-multiplier">
                                {unavailable ? 'N/A' : `×${multiplier}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
```

- [ ] **Step 3: Same treatment for Step mode's outcome row**

Replace the Step-mode outcome row (lines 298-312):

```js
                    <div className="bet-outcomes">
                      {[
                        { key: 'home', label: match.homeTeam.shortName || match.homeTeam.name },
                        { key: 'draw', label: 'Draw' },
                        { key: 'away', label: match.awayTeam.shortName || match.awayTeam.name },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          className={`bet-outcome-btn ${stepPick === key ? 'selected' : ''}`}
                          onClick={() => setStepPick(match.id, key)}
                        >
                          <span className="outcome-label">{label}</span>
                        </button>
                      ))}
                    </div>
```

with:

```js
                    <div className="bet-outcomes">
                      {outcomeButtons(match).map(({ key, label }) => {
                        const multiplier = getMultiplier(match.id, key);
                        const unavailable = multiplier == null;
                        return (
                          <button
                            key={key}
                            className={`bet-outcome-btn ${stepPick === key ? 'selected' : ''}`}
                            onClick={() => !unavailable && setStepPick(match.id, key)}
                            disabled={unavailable}
                          >
                            <span className="outcome-label">{label}</span>
                            <span className="outcome-multiplier">
                              {unavailable ? 'N/A' : `×${multiplier}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
```

- [ ] **Step 4: Fix the two remaining 3-way outcome ternaries (existing-bet displays)**

Line 177 (the open-step summary), replace:

```js
                {leg.homeTeam} vs {leg.awayTeam} — {leg.outcome === 'home' ? leg.homeTeam : leg.outcome === 'away' ? leg.awayTeam : 'Draw'}
```

with:

```js
                {leg.homeTeam} vs {leg.awayTeam} — {outcomeLabel({ homeTeam: { name: leg.homeTeam }, awayTeam: { name: leg.awayTeam } }, leg.outcome)}
```

Lines 219-220 are already calling `outcomeLabel(match, existing.outcome)`, which now handles all 6 outcomes automatically since Step 1 extended that function — no change needed there.

- [ ] **Step 5: Update `Prediction.css` for a 6-button grid and disabled state**

In `src/Prediction.css`, replace:

```css
.bet-outcomes {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
```

with:

```css
.bet-outcomes {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
```

Add this new block right after the existing `.bet-outcome-btn.selected .outcome-label { color: var(--text-primary); }` rule:

```css
.bet-outcome-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bet-outcome-btn:disabled:hover {
  border-color: var(--border);
}

.outcome-multiplier {
  font-size: 0.65rem;
  color: var(--text-muted);
}

.bet-outcome-btn.selected .outcome-multiplier {
  color: var(--accent-gold);
}
```

- [ ] **Step 6: Verify the build compiles**

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup" && CI=true npm run build
```

Expected output ends with `Compiled successfully.`

- [ ] **Step 7: Commit**

```bash
git add src/Prediction.js src/Prediction.css
git commit -m "Add Double Chance outcome buttons with odds-aware disabling to Predict page"
```

---

### Task 5: Frontend — `PredictionHistory.js` six-outcome labels

**Files:**
- Modify: `src/PredictionHistory.js:5-9, 21-22`

**Interfaces:**
- Consumes: `prediction.outcome` / `leg.outcome` values, now one of the 6 `OUTCOMES` values from Task 2's stored predictions.

- [ ] **Step 1: Extend `pickLabel` to cover all 6 outcomes**

Replace:

```js
const pickLabel = (prediction) => {
  if (prediction.outcome === 'home') return prediction.homeTeam;
  if (prediction.outcome === 'away') return prediction.awayTeam;
  return 'Draw';
};
```

with:

```js
const pickLabel = (prediction) => {
  const { outcome, homeTeam, awayTeam } = prediction;
  if (outcome === 'home') return homeTeam;
  if (outcome === 'away') return awayTeam;
  if (outcome === 'draw') return 'Draw';
  if (outcome === '1X') return `${homeTeam} or Draw`;
  if (outcome === '12') return `${homeTeam} or ${awayTeam}`;
  if (outcome === 'X2') return `Draw or ${awayTeam}`;
  return outcome;
};
```

- [ ] **Step 2: Extend `StepLegLabel` the same way**

Replace:

```js
const StepLegLabel = (leg) =>
  leg.outcome === 'home' ? leg.homeTeam : leg.outcome === 'away' ? leg.awayTeam : 'Draw';
```

with:

```js
const StepLegLabel = (leg) => pickLabel(leg);
```

(`leg` already has `homeTeam`/`awayTeam`/`outcome` fields with the same shape as a `prediction`, so `pickLabel` works unchanged on it.)

- [ ] **Step 3: Verify the build compiles**

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup" && CI=true npm run build
```

Expected output ends with `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/PredictionHistory.js
git commit -m "Extend prediction history labels to cover Double Chance outcomes"
```
