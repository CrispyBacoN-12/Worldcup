# Champion Pick & Top Scorer Points = Odds × 100 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A correct Champion Pick or Top Scorer pick pays `round(100 * multiplier)` points, where `multiplier` is that pick's odds (per-team for Champion, per-player for Top Scorer via a new Google Sheet feed).

**Architecture:** Champion Pick already multiplies a base constant by a per-team `multiplier` from `server/data/championTeams.json` — only the constant changes. Top Scorer gets a second, independent Google Sheet CSV feed (separate cache from the match-odds feed, since the row shape differs: one multiplier per player, not six per match), fetched at settlement time to look up the actual winning player's multiplier.

**Tech Stack:** Express (`server/index.js`), axios (already a dependency). No backend test framework is configured in this codebase — verification is manual via `node -e` sanity checks and `curl`/direct `wallet.json` edits against the running server, consistent with every prior plan in `docs/superpowers/plans/`.

## Global Constraints

- Champion Pick formula becomes `Math.round(100 * team.multiplier)` (was `Math.round(10 * team.multiplier)`) — only the constant changes, nothing else about Champion Pick.
- New env var `PLAYER_ODDS_SHEET_CSV_URL` (separate from `ODDS_SHEET_CSV_URL`). CSV columns (header required, located by name): `playerId, multiplier`.
- Player-odds cache: 60-second TTL, stale-cache-on-failure fallback, `{}` if never successfully fetched — same caching idiom as the match-odds feed, but its own separate cache variable (different row shape).
- `AwardPick.js` (the picker UI) is unchanged — no odds-availability gating on which player can be picked, since there's no stake at risk.
- Top Scorer settlement formula: `Math.round(AWARD_BASE_POINTS * multiplier)` where `AWARD_BASE_POINTS = 100` and `multiplier = playerOdds[actual.actualPlayerId] ?? 1` (graceful fallback, not a rejection — no stake to protect here).
- `server/data/awards.json`'s `basePoints` field is removed (superseded by the formula above).

---

### Task 1: Champion Pick base points constant

**Files:**
- Modify: `server/index.js` (the `CHAMPION_BASE_POINTS` constant, currently around line 88)

**Interfaces:**
- None — this is a single constant value change with no signature impact on any other task.

- [ ] **Step 1: Change the constant**

Find and replace:

```js
const CHAMPION_BASE_POINTS = 10;
```

with:

```js
const CHAMPION_BASE_POINTS = 100;
```

- [ ] **Step 2: Verify settlement uses the new constant**

With the backend not running yet, confirm the only other reference to `CHAMPION_BASE_POINTS` is the settlement formula:

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup" && grep -n "CHAMPION_BASE_POINTS" server/index.js
```

Expected output: two lines — the constant declaration (now `= 100;`) and `pick.pointsAwarded = correct ? Math.round(CHAMPION_BASE_POINTS * multiplier) : 0;`. No other usages.

- [ ] **Step 3: End-to-end settlement check**

Start the backend, register a test user, manually set that user's `championPick` to a real team id with `status: 'pending'`, and manually set that team's `multiplier` to `2` in `server/data/championTeams.json` for the test (revert after). Then hit `/api/points` and confirm the payout is `200`.

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup" && node server/index.js > /tmp/champtest.log 2>&1 &
echo $! > /tmp/champtest.pid
sleep 2
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" -d '{"username":"champtest","password":"champtest123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
node -e "
const fs = require('fs');
const w = JSON.parse(fs.readFileSync('server/wallet.json','utf8'));
w.champtest.championPick = { teamId: 762, name: 'Argentina', shortName: 'Argentina', crest: '', placedAt: new Date().toISOString(), status: 'pending', pointsAwarded: null, settledAt: null };
fs.writeFileSync('server/wallet.json', JSON.stringify(w, null, 2));
const teams = JSON.parse(fs.readFileSync('server/data/championTeams.json','utf8'));
const argentina = teams.find(t => t.id === 762);
argentina.multiplier = 2;
fs.writeFileSync('server/data/championTeams.json', JSON.stringify(teams, null, 2));
console.log('test data set, Argentina multiplier = 2');
"
curl -s http://localhost:5000/api/points -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data', d => { const j = JSON.parse(d); console.log('championPick.status:', j.championPick.status, 'pointsAwarded:', j.championPick.pointsAwarded); })"
kill $(cat /tmp/champtest.pid)
```

This test relies on the FINAL match (`FINAL_MATCH_ID`) already being `FINISHED` with Argentina as the actual winner to settle as `correct` — since the real tournament hasn't reached the final yet, this step is a **dry-run structural check only**: confirm the request doesn't error and `championPick.status` stays `'pending'` (expected, since the final hasn't been played, so `settleChampionPick`'s `match.status !== 'FINISHED'` guard returns early). Re-run this same check after the real final settles to see the actual `200`-point payout. Revert the test `multiplier` edit on `championTeams.json` back to `1` immediately after this check:

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup" && git checkout -- server/data/championTeams.json
```

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "Increase Champion Pick base points to 100 per multiplier"
```

---

### Task 2: Top Scorer player-odds sheet feed + settlement

**Files:**
- Modify: `server/index.js` (odds setup region, `settleAwardPicks`, `/api/points` handler)
- Modify: `server/data/awards.json`

**Interfaces:**
- Produces: `async function fetchPlayerOddsFromSheet()` → resolves to `{ [playerId: string]: number }`. `AWARD_BASE_POINTS` constant (`100`).
- Consumes: none from Task 1 (independent change).

- [ ] **Step 1: Add the player-odds cache, parser, and fetch function**

In `server/index.js`, add this block right after the existing match-odds setup (after the `getOddsMultiplier` function, before the `FIXTURES_FILE` line):

```js
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
```

This reuses `ODDS_CACHE_TTL_MS` (already defined for the match-odds feed) — same 60-second TTL applies to both feeds.

- [ ] **Step 2: Verify the parser in isolation**

```bash
node -e "
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

const csv = 'multiplier,playerId\n3.5,444\n2.0,555';
const parsed = parsePlayerOddsCsv(csv);
console.log(JSON.stringify(parsed));
console.assert(parsed['444'] === 3.5, 'player 444 multiplier');
console.assert(parsed['555'] === 2, 'player 555 multiplier');
console.assert(parsed['999'] === undefined, 'unknown player has no entry');
console.log('ALL ASSERTIONS PASSED');
"
```

Expected output: `{"444":3.5,"555":2}` then `ALL ASSERTIONS PASSED`.

- [ ] **Step 3: Add `AWARD_BASE_POINTS` and update `settleAwardPicks` to use the player-odds multiplier**

Find the `AWARD_TYPES` declaration and add the new constant right after it:

```js
const AWARD_TYPES = ['topScorer'];
const AWARD_BASE_POINTS = 100;
```

Replace `settleAwardPicks`:

```js
const settleAwardPicks = (username) => {
  const wallet = getWallet();
  const userData = touchWallet(wallet, username);
  if (!userData.awardPicks) return;

  const awards = getAwards();
  let changed = false;
  for (const type of AWARD_TYPES) {
    const pick = userData.awardPicks[type];
    const actual = awards[type];
    if (!pick || pick.status !== 'pending' || !actual || actual.actualPlayerId == null) continue;

    const correct = pick.playerId === actual.actualPlayerId;
    pick.status = correct ? 'correct' : 'wrong';
    pick.pointsAwarded = correct ? actual.basePoints : 0;
    pick.settledAt = new Date().toISOString();
    if (correct) userData.points += pick.pointsAwarded;
    changed = true;
  }

  if (changed) saveWallet(wallet);
};
```

with:

```js
const settleAwardPicks = async (username) => {
  const wallet = getWallet();
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

  if (changed) saveWallet(wallet);
};
```

- [ ] **Step 4: Await `settleAwardPicks` in the `/api/points` handler**

Find:

```js
  await settleChampionPick(req.user.username);
  settleAwardPicks(req.user.username);
```

Replace with:

```js
  await settleChampionPick(req.user.username);
  await settleAwardPicks(req.user.username);
```

- [ ] **Step 5: Remove the now-unused `basePoints` field from `awards.json`**

Replace the contents of `server/data/awards.json`:

```json
{
  "topScorer": { "actualPlayerId": null, "actualPlayerName": null, "basePoints": 15 }
}
```

with:

```json
{
  "topScorer": { "actualPlayerId": null, "actualPlayerName": null }
}
```

- [ ] **Step 6: Syntax-check and end-to-end settlement test**

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup\server" && node -c index.js && echo "syntax OK"
```

Expected output: `syntax OK`

Then verify settlement end-to-end with a local CSV server, a manually-set `awards.json` winner, and a manually-set pending pick:

```bash
cd "c:\Users\Kannithi\Documents\VS code\worldcup"
node -e "
const http = require('http');
const csv = 'playerId,multiplier\n9999,3\n';
http.createServer((req, res) => { res.writeHead(200); res.end(csv); }).listen(5098, () => console.log('player odds csv server up'));
" > /tmp/playeroddscsv.log 2>&1 &
echo \$! > /tmp/playeroddscsv.pid
sleep 1

node -e "
const fs = require('fs');
const awards = JSON.parse(fs.readFileSync('server/data/awards.json','utf8'));
awards.topScorer.actualPlayerId = 9999;
awards.topScorer.actualPlayerName = 'Test Player';
fs.writeFileSync('server/data/awards.json', JSON.stringify(awards, null, 2));
"

PLAYER_ODDS_SHEET_CSV_URL=http://localhost:5098 node server/index.js > /tmp/awardtest.log 2>&1 &
echo \$! > /tmp/awardtest.pid
sleep 2

TOKEN=\$(curl -s -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" -d '{"username":"awardtest","password":"awardtest123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

node -e "
const fs = require('fs');
const w = JSON.parse(fs.readFileSync('server/wallet.json','utf8'));
w.awardtest.awardPicks = { topScorer: { playerId: 9999, playerName: 'Test Player', teamName: null, placedAt: new Date().toISOString(), status: 'pending', pointsAwarded: null, settledAt: null } };
fs.writeFileSync('server/wallet.json', JSON.stringify(w, null, 2));
"

curl -s http://localhost:5000/api/points -H "Authorization: Bearer \$TOKEN" | node -e "process.stdin.on('data', d => { const j = JSON.parse(d); console.log('pointsAwarded:', j.awardPicks.topScorer.pointsAwarded, 'status:', j.awardPicks.topScorer.status); })"

kill \$(cat /tmp/awardtest.pid) \$(cat /tmp/playeroddscsv.pid) 2>/dev/null
git checkout -- server/data/awards.json
```

Expected output line: `pointsAwarded: 300 status: correct` (multiplier 3 × `AWARD_BASE_POINTS` 100 = 300). The final `git checkout` reverts the manual `awards.json` test edit so the real (unannounced) winner stays `null`.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/data/awards.json
git commit -m "Add Google Sheet player-odds feed for Top Scorer points"
```
