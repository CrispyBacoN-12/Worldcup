# Google Sheet Odds Feed & Double Chance Markets — Design

## Goal

Replace the static `server/data/matchOdds.json` file with odds pulled live from a
published Google Sheet (CSV), so the odds can be edited without a code deploy.
At the same time, add Double Chance betting markets (1X, 12, X2) alongside the
existing 1X2 (home/draw/away) market, for both single-match predictions and
step (parlay) legs.

## Odds source: Google Sheet CSV

- The user publishes a Google Sheet to the web as CSV (Sheet → File → Share →
  Publish to web → CSV). The resulting URL is set as `ODDS_SHEET_CSV_URL` in
  `server/.env` (and as a Render env var for production) — same pattern as
  `FOOTBALL_API_KEY`/`JWT_SECRET`.
- Sheet layout: one row per match, columns `matchId, home, draw, away, 1X, 12, X2`.
  Header row is required and used to locate columns by name (not by position),
  so column order in the sheet doesn't matter. `matchId` must match the
  football-data.org match id used in `src/data/fixtures.json`.
- Each odds cell is a decimal multiplier (e.g. `2.1`). Empty/non-numeric cells
  mean "no odds for this match/outcome" (see fallback behavior below).

## Backend odds cache (`server/index.js`)

- Add `fetchOddsFromSheet()`: fetches `ODDS_SHEET_CSV_URL`, parses CSV with a
  small inline parser (no new dependency — split on newlines, then on commas;
  the data is fully numeric/IDs, no quoted commas expected), and builds an
  object keyed by `matchId` (string) → `{ home, draw, away, '1X', '12', 'X2' }`
  (only including outcomes that had a valid numeric cell).
- Cache the parsed result in memory: `{ data, fetchedAt }`. Refetch when the
  cache is older than `ODDS_CACHE_TTL_MS = 60_000` (1 minute) — matches this
  app's existing `cacheTtlFor` pattern for the football-data proxy. If the
  fetch fails (network error, non-200, unparseable CSV) and a previous
  successful fetch exists, keep serving the stale cached data rather than
  wiping it — only a never-yet-successful fetch results in "no odds at all".
- Replace `getOddsMultiplier(matchId, outcome)`: look up
  `oddsCache.data[matchId]?.[outcome]`. Return `undefined` if missing (no
  more `DEFAULT_ODDS_MULTIPLIER` fallback — `matchOdds.json` and the constant
  are deleted). Callers must treat `undefined` as "this bet is closed."
- `GET /api/odds` returns `{ odds: oddsCache.data, fetchedAt: oddsCache.fetchedAt }`
  (drop `defaultMultiplier` from the response — there's no longer a default).

## Outcome enum change (1X2 + Double Chance)

Every place that currently validates
`['home', 'draw', 'away'].includes(outcome)` (single predictions, step legs)
becomes:

```js
const OUTCOMES = ['home', 'draw', 'away', '1X', '12', 'X2'];
```

Winner-check logic (used in `settlePredictions` and `settleStepPrediction`)
extends from a single equality check to a small lookup:

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

Both `settlePredictions` and `settleStepPrediction` (and the inline
correctness check previously duplicated in each) call this single shared
helper instead of their own inline boolean expressions.

## Odds-unavailable fallback (placement time)

`POST /api/predictions` and `POST /api/step-predictions` already fetch each
leg's live match status before accepting a bet. Add an odds check next to
that status check:

```js
const multiplier = getOddsMultiplier(matchId, outcome);
if (multiplier == null)
  return res.status(400).json({ error: 'Odds are not available for this match yet' });
```

This is a hard rejection, not a default — per the chosen fallback behavior,
a match/outcome with no sheet row (or a sheet that's never been successfully
fetched) simply cannot be bet on until odds appear.

## Frontend

- **`src/PointsContext.js`** — `getMultiplier(matchId, outcome)` now returns
  `undefined` when odds are missing (it already reads from the `/api/odds`
  response; the only change is there's no `defaultMultiplier` fallback to
  return instead).
- **`src/Prediction.js` / `src/MatchDetail.js`** — the existing 3-button
  outcome row (Home / Draw / Away) becomes a 6-button grid: Home, Draw, Away,
  1X, 12, X2. Each button's label includes the multiplier (e.g. "Home ×2.10")
  when available. A button whose `getMultiplier` is `undefined` renders
  `disabled` with label suffix "(unavailable)" instead of a multiplier.
- Step mode (`src/Prediction.js`) uses the same 6-button grid per match card;
  `stepCombinedMultiplier` multiplies whichever of the 6 outcomes were picked
  per leg, unchanged otherwise.
- **`outcomeLabel`/`pickLabel` helpers** (`Prediction.js`, `MatchDetail.js`,
  `PredictionHistory.js`) extend from a 3-way ternary to handle all 6 values,
  e.g. `'1X'` → `"${homeName} or Draw"`, `'12'` → `"${homeName} or ${awayName}"`,
  `'X2'` → `"Draw or ${awayName}"`.

## Removed

- `server/data/matchOdds.json` (deleted — replaced by the live sheet feed).
- `DEFAULT_ODDS_MULTIPLIER` constant.
- `defaultMultiplier` field from the `/api/odds` response and from
  `PointsContext.js`'s state.

## Testing

No automated frontend test suite exists (consistent with the rest of this
codebase). Manual verification:

1. Publish a test sheet with 2-3 matches, each with all 6 odds columns
   filled in. Confirm `/api/odds` returns those multipliers within a minute
   of publishing.
2. Remove the `away` value for one match's row (leave the cell blank).
   Confirm the Away button for that match is disabled and a same-match
   prediction request with `outcome: 'away'` returns 400.
3. Temporarily point `ODDS_SHEET_CSV_URL` at an unreachable URL after a
   successful fetch. Confirm odds already cached keep working (stale-cache
   fallback) rather than disappearing immediately.
4. Place a `1X` prediction on a match, then (via test data or a manually
   edited `wallet.json` + a `FINISHED` match with `winner: 'DRAW'`) confirm
   settlement marks it `correct`.
5. Build a step with one `12` leg and one `home` leg; confirm
   `combinedMultiplier` is the product of both sheet-sourced multipliers.
