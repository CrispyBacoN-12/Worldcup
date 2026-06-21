# Exact-Score Bonus Prediction — Design

## Goal

Add an optional "exact score" prediction alongside the existing home/draw/away (1x2) pick. Getting the outcome right still earns 1 point; getting the exact final score right too earns 3 bonus points, for 4 points total.

## Scoring rule

- Outcome wrong → 0 points (unchanged).
- Outcome correct, no exact-score match (or no score predicted) → 1 point (unchanged).
- Outcome correct AND predicted score matches the final score exactly → 4 points total (1 + 3 bonus).

## Data model

`server/wallet.json` prediction objects gain one new optional field:

```js
{
  id, matchId, homeTeam, awayTeam, outcome, status, placedAt, settledAt,
  predictedScore: { home: number, away: number } | null,  // new
}
```

`status` gains a new possible value: `'exact'` (in addition to existing `'pending'`, `'correct'`, `'wrong'`), set when the bonus is awarded.

## Frontend — `src/MatchDetail.js`

- Below the existing home/draw/away buttons, add two number inputs (home score, away score). They are always rendered but **disabled until an outcome is selected** (`sel` is non-null), since a score without a known outcome pick is ambiguous.
- Both inputs are optional:
  - Both empty at submit time → `predictedScore: null` sent (today's 1x2-only behavior, unchanged).
  - One filled, one empty → treated as incomplete; submit button stays disabled with a hint that both are needed (or neither).
  - Both filled → must be non-negative integers, and must agree with the selected outcome:
    - `home`-outcome requires `homeScore > awayScore`
    - `away`-outcome requires `awayScore > homeScore`
    - `draw`-outcome requires `homeScore === awayScore`
  - Inconsistent combination → submit button disabled, inline message: "สกอร์ไม่ตรงกับผลที่เลือก".
- Existing prediction display (the `existing` block showing pending/correct/wrong) gains a 4th branch for `status === 'exact'`: shows the predicted score next to "Your pick" and a message like "สกอร์ถูกเป๊ะ! ได้ +4 แต้ม 🎯⭐" instead of the current "Correct! You earned +1 point ⭐".

## Backend — `server/index.js`

**`POST /api/predictions`** (around line 187): accept an optional `predictedScore: { home, away }` field in the request body.
- If present, validate: both `home` and `away` are non-negative integers, and the combination agrees with `outcome` using the same rule as the frontend. Invalid or inconsistent → `400` with an error message (defense in depth — the API can be called directly, not just through the UI).
- If valid (or omitted), store it on the prediction object as `predictedScore` (or `null` if omitted).

**`settlePredictions()`** (around line 105): when a pending prediction's match is `FINISHED`:
- Compute `correct` exactly as today (outcome match against `match.score.winner`).
- If `correct` and `prediction.predictedScore` is non-null and matches `match.score.fullTime.home`/`.away` exactly: set `status = 'exact'` and `userData.points += 4`.
- Else if `correct`: set `status = 'correct'` and `userData.points += 1` (unchanged).
- Else: set `status = 'wrong'`, no points (unchanged).

## Testing

No automated frontend test suite exists (consistent with the rest of this codebase). Manual verification:
1. Open a `SCHEDULED`/`TIMED` match's detail page, pick an outcome, leave score blank → submit works exactly as before (1x2-only).
2. Pick an outcome, enter a score consistent with it → submit succeeds, prediction stored with `predictedScore`.
3. Pick "Home Win" but enter an away-leaning score (e.g. 1-2) → submit button stays disabled with the inline warning.
4. Manually flip a test match to `FINISHED` with a score in `server/wallet.json`'s referenced fixture data (or via a finished real match once available) and call `GET /api/points` → confirm `status` becomes `'exact'` and `points` increases by 4 when the score was predicted exactly, or `'correct'`/+1 when only the outcome was right.
