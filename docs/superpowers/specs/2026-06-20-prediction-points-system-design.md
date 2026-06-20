# Prediction Points System & API Reliability — Design

## Background

The app currently has a virtual-currency betting system (coins, odds, 1x2/Handicap/Over-Under markets, stakes). It also calls football-data.org directly from many pages, which has hit `429 Too Many Requests` and `504` timeouts on the free-tier API key (~10 req/min limit).

This design replaces the betting system with a simple prediction/points system, and fixes the API reliability problem by (a) caching/throttling calls to football-data.org and (b) locking the static parts of the match schedule (teams, kickoff time, venue) into a bundled JSON file so pages don't need to hit the API just to know who plays whom and when.

## 1. Prediction Points System

### Data model

Per-user record in `server/wallet.json` (file kept, shape changes):

```json
{
  "<username>": {
    "points": 0,
    "predictions": [
      {
        "id": "...",
        "matchId": 12345,
        "homeTeam": "Brazil",
        "awayTeam": "Argentina",
        "outcome": "home",
        "status": "pending",
        "placedAt": "2026-06-20T10:00:00.000Z",
        "settledAt": null
      }
    ]
  }
}
```

- `outcome`: `'home' | 'draw' | 'away'`
- `status`: `'pending' | 'correct' | 'wrong'`
- One prediction per match per user (a new pick for an already-predicted match is rejected, not overwritten).
- No `odds`, `amount`, `line`, `market`, `payout`, `potential` fields — money/stakes concept is removed entirely.

### Backend

- `GET /api/wallet` → renamed `GET /api/points`. Settles pending predictions for finished matches (+1 point per correct pick, 0 for wrong, no push/refund concept needed), returns `{ points, predictions }`.
- `POST /api/wallet/bet` → renamed `POST /api/predictions`. Body: `{ matchId, homeTeam, awayTeam, outcome }`. Validates `outcome` is required and is one of home/draw/away, and that the user doesn't already have a pending/settled prediction for that `matchId`. No balance or amount checks.
- `ensureWallet` → `ensurePoints`, defaults to `{ points: 0, predictions: [] }`. Used by both registration and the points/predictions routes.
- `settleBets` → `settlePredictions`: for each pending prediction, fetch the match (through the new cached fetch helper, see §2), and if `FINISHED`, compare `outcome` to `match.score.winner` (`HOME_TEAM`/`AWAY_TEAM`/`DRAW`) and set `status` to `correct`/`wrong`, incrementing `points` by 1 on correct.

### Frontend

- `WalletContext.js` → `PointsContext.js`. Exposes `{ points, predictions, fetchPoints, submitPrediction }`, calls the renamed endpoints.
- `MatchDetail.js`: remove the Handicap and Over/Under sections entirely (components, state, CSS). The 1x2 section keeps the three buttons (Home/Draw/Away) but drops the odds display and amount input — clicking a team submits the prediction immediately (no separate "confirm with amount" step). Existing-prediction state shows pick + pending/correct/wrong instead of bet details.
- `Prediction.js`: keep the existing pick buttons (Home/Draw/Away) and "Save Score Guess" inputs as-is; replace `useWallet`/`placeBet` with `usePoints`/`submitPrediction`; replace "+1 coin" wording with "+1 point" and drop the coins unit from the balance bar (renders points instead).
- `BetHistory.js` + `BetHistory.css` → `PredictionHistory.js` + `PredictionHistory.css`, served at route `/predictions` (rename from `/bets`). Summary card shows Total Points, Correct count, Wrong count (drop Net P&L money math). Each card shows match, picked team/draw, and a Pending/Correct/Wrong badge — no odds/amount/payout rows.
- `navbar.js` / `Navbar.css`: replace the 🪙 balance display with a points display (e.g. "⭐ 12 pts"), rename the "My Bets" link to "My Predictions" pointing at `/predictions`.
- Delete `src/oddsUtils.js` (1x2/handicap/totals odds generation is no longer used anywhere).
- Prune now-dead CSS in `MatchDetail.css` (odds grid, handicap/total specific classes, bet amount input/coin/potential styles) and any "coin"-flavored classes left in `Prediction.css` / `PredictionHistory.css` that no longer apply.

### Data reset

- One-off script (run once, not committed) rewrites every existing entry in `server/wallet.json` — including the 298 seeded users (`6701001`-`6701298`) and any others — to `{ points: 0, predictions: [] }`.

## 2. Cache + Throttle for football-data.org calls

### Problem

Every page (`Home`, `Standings`, `Prediction`, `MatchDetail`) calls football-data.org independently, with no de-duplication or rate limiting. The free-tier key allows ~10 requests/minute; concurrent or repeated page loads exceed this and produce `429`s, and on at least one occasion the upstream API itself was unreachable, producing `504`s from our own proxy.

### Design

- Add a single helper in `server/index.js`, e.g. `fetchFootballData(path, params)`, that all football-data.org calls go through (the generic `/api/*` proxy route and `settlePredictions`).
- **Cache**: in-memory `Map` keyed by the full request URL, storing `{ data, expiresAt }`. TTL varies by endpoint:
  - match/score lookups (`/matches/:id`, the full matches list): 30–60s
  - standings (`/competitions/WC/standings`): 5 minutes
- **Throttle**: a simple queue/token-bucket that allows at most ~8 outgoing requests per rolling minute to football-data.org; requests beyond that wait in a FIFO queue rather than firing immediately and tripping the upstream rate limit. Cache hits bypass the queue entirely.
- On a genuine upstream failure (timeout or non-200), the existing proxy error handling is unchanged — it still surfaces the error status/message to the caller, it just goes through the cache/queue first.

## 3. Static fixture lock

### Problem

`Home.js` and `Prediction.js` fetch the full match list from the API just to know which teams play when — information that is fixed well before kickoff and doesn't need a live API call.

### Design

- Generate `src/data/fixtures.json` once (one-off script, run while the API is reachable) from `GET /v4/competitions/WC/matches`, keeping only the static fields per match: `id`, `utcDate`, `stage`, `group`, `venue`, `area`, `competition`, `homeTeam` (`id`/`name`/`shortName`/`crest`), `awayTeam` (same). Score and status are dropped — they're the dynamic part.
- **`Prediction.js`**: filters "upcoming" matches directly from `fixtures.json` by comparing `utcDate` to `Date.now()` — no API call needed at all for this page's match list.
- **`Home.js`**: renders the full list from `fixtures.json` immediately (so team names/dates always show even if the API is down), then fetches live score/status from `/api/competitions/WC/matches` (through the cache/throttle helper from §2) and merges `score`/`status` onto the static entries by `id`. If that fetch fails, the page still renders fixtures with scores shown as unavailable instead of a full-page error.
- **`MatchDetail.js`**: reads team/date/venue for the requested match from `fixtures.json` by `id`; still calls the API (via cache/throttle) for live score/status/winner for that single match.
- **`Standings.js`** is unaffected by the fixture lock (it needs the computed table, not fixture metadata) but benefits from the cache/throttle layer in §2.

## Out of scope

- No leaderboard / ranking across users.
- No re-fetch mechanism to update `fixtures.json` if the official schedule changes (knockout-stage pairings, postponements) — a manual re-run of the generation script would be needed; not automated.
- No changes to the auth system or the football-data.org API key itself.
