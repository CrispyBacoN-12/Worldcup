# Prediction Staking & Daily Money Allowance — Design

## Goal

Replace the flat-points match-prediction system with a money-staking system: users must stake money to predict a match outcome, and a correct pick pays out based on per-match odds. Money is funded by a daily allowance that expires if unused. This removes the exact-score bonus feature added previously — match predictions go back to outcome-only (home/draw/away), now wrapped in staking.

Champion Pick (predicting the tournament winner) is unaffected — it keeps using the existing `points` field.

## Daily allowance

- Once per UTC calendar day, each user is credited `100 * N`, where `N` is the number of matches in `src/data/fixtures.json` whose `utcDate` falls on the current UTC date.
- Granted lazily: any wallet-touching request checks `userData.lastAllowanceDate` (a `'YYYY-MM-DD'` UTC string) against today's date. If it doesn't match, grant today's allowance and update the field. No cron job — the check runs inline wherever the wallet is read or written.
- Each grant is stored as an entry: `{ amount, grantedAt: ISOString, remaining: amount }` in `userData.dailyGrants` (an array, since multiple days' grants can coexist if unused).
- On the same lazy check, drop any grant whose `grantedAt` is more than 24 hours in the past — its `remaining` amount is forfeited (removed from the array, not moved anywhere).

## Permanent money vs. expiring grants

- `userData.money` is a single number: permanent winnings, never expires.
- Available balance for staking = `sum(g.remaining for g in dailyGrants) + userData.money`.
- When a stake is placed, deduct from `dailyGrants` first, oldest grant first (soonest to expire), reducing each grant's `remaining` until it hits 0 before moving to the next grant. Only once all grants are exhausted does the deduction touch `userData.money`.
- When a stake wins, the payout is added to `userData.money` (permanent) — winnings are never subject to the 24h expiry, even if the original stake came from an expiring grant.

## Odds

New file `server/data/matchOdds.json`, keyed by `matchId` (string) → `{ "home": number, "draw": number, "away": number }`. Starts as `{}`. Any match/outcome not present in the file uses a default multiplier of `2`. The user will fill in real per-match numbers later (same pattern as `server/data/championTeams.json`'s `multiplier` field) — no code changes needed for that update.

## Predictions data model

`server/wallet.json` per-user prediction objects (replacing the previous shape):

```js
{
  id, matchId, homeTeam, awayTeam, outcome,   // unchanged
  stake: number,           // new — required, positive integer
  status: 'pending' | 'correct' | 'wrong',
  payout: number | null,   // new — null while pending, 0 if wrong, stake*multiplier if correct
  placedAt, settledAt,     // unchanged
}
```

The `predictedScore` field and `'exact'` status from the previous exact-score-bonus feature are removed. Predictions placed under the old format (no `stake` field) are left untouched in `wallet.json` — they simply won't be revisited by the new settlement logic (a one-line guard skips any pending prediction missing a `stake`), since this app has no production users with real money at stake yet.

## Backend — `server/index.js`

**Wallet helper:** add `touchWallet(wallet, username)` (called everywhere `ensurePoints` is currently called, replacing it) that:
1. Runs the existing `ensurePoints` initialization (points, predictions, money: 0, dailyGrants: [], championPick stays as-is).
2. Drops any `dailyGrants` entries older than 24h.
3. If `userData.lastAllowanceDate` isn't today's UTC date, computes today's match count from `src/data/fixtures.json` (require it directly — same cross-package read pattern as `championTeams.json`), grants `100 * count` as a new entry, and updates `lastAllowanceDate`.

**`POST /api/predictions`:** body becomes `{ matchId, homeTeam, awayTeam, outcome, stake }`.
- 400 if `stake` isn't a positive integer.
- 400 if `stake` exceeds the available balance (`sum(dailyGrants.remaining) + money`).
- On success: deduct the stake per the rule above, store the prediction with `status: 'pending'`, `payout: null`.
- Drop the `predictedScore` validation block and `scoreMatchesOutcome` helper entirely (exact-score feature removed).

**`settlePredictions(username)`:**
- Skip any pending prediction missing a `stake` field (legacy data).
- For predictions with a `stake`: determine `correct` exactly as before (outcome vs. `match.score.winner`).
- Correct → look up the multiplier from `matchOdds.json` (default `2`) for this match/outcome, `payout = round(stake * multiplier)`, add to `userData.money`, `status: 'correct'`.
- Wrong → `payout: 0`, `status: 'wrong'` (the stake was already deducted at placement — no further deduction here).

**`GET /api/points`** (or a renamed/extended wallet endpoint) returns the full wallet shape including `money`, `dailyGrants` (each with `grantedAt` so the frontend can compute "expires in"), and `predictions`.

## Frontend

**`src/PointsContext.js`** — expose `money` and `dailyGrants` (in addition to existing `points`/`predictions`/`championPick`). `submitPrediction` now sends `{ matchId, homeTeam, awayTeam, outcome, stake }`.

**`src/MatchDetail.js`** — remove the score-input block (`homeScore`/`awayScore` state, `scoreMatchesOutcome`, the score JSX, the `'exact'` status branch). Add a stake-amount number input next to the outcome picker; "Confirm Prediction" stays disabled until an outcome is selected and the stake is a positive integer not exceeding the available balance. Existing-prediction display shows the stake and (once settled) the payout instead of points.

**`src/Prediction.js`** — same stake field added to its existing per-match bet section (the unrelated `localStorage`-only score-guess UI in this file is untouched — it's a separate, already-existing feature not part of this redesign).

**New wallet display** — a small balance bar (reused across `Prediction.js`/`MatchDetail.js`, e.g. a `WalletBar` component or inline markup) showing the total available balance, and if any grant expires within 24h, the soonest expiry as a relative time ("expires in Xh").

**`src/PredictionHistory.js`** — summary card shows `money` alongside `points`; each prediction card shows `stake` and (once settled) `payout` instead of "+1 point" / "0 points".

## Testing

No automated frontend test suite exists (consistent with the rest of this codebase). Manual verification:
1. Fresh user, no prior wallet — first request grants `100 * (today's match count)`, confirmed via the new wallet endpoint.
2. Place a stake on a bettable match — balance decreases by the stake amount, prediction stored with `status: 'pending'`.
3. Attempt to stake more than the available balance — `400`.
4. Temporarily point `FINAL_MATCH_ID`-style test logic at an already-`FINISHED` match (or manually edit `wallet.json`) to confirm settlement: correct pick adds `round(stake * multiplier)` to `money`; wrong pick adds nothing (stake already gone).
5. Manually backdate a `dailyGrants` entry's `grantedAt` by more than 24h in `wallet.json`, then trigger any wallet-touching request — confirm the stale grant is dropped and no longer counted in the available balance.
