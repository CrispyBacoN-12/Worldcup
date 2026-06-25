# Champion Pick & Top Scorer Points = Odds × 100 — Design

## Goal

Change how points are awarded for the two tournament-long picks (Champion Pick
and Top Scorer) so a correct pick pays `round(100 * multiplier)` points,
where `multiplier` is that pick's odds. Champion Pick already has a
per-team `multiplier` in `server/data/championTeams.json` — only the base
constant changes (`10` → `100`). Top Scorer currently has no per-player odds
at all (flat `basePoints: 15` regardless of who's picked); this adds a
Google Sheet odds feed for player multipliers, mirroring the match-odds
sheet feed already built for predictions.

## Champion Pick

`CHAMPION_BASE_POINTS` in `server/index.js` changes from `10` to `100`. No
other change — `settleChampionPick` already does
`Math.round(CHAMPION_BASE_POINTS * multiplier)` using each team's
`multiplier` field from `championTeams.json`.

## Top Scorer player odds: a second Google Sheet

- New env var `PLAYER_ODDS_SHEET_CSV_URL` (server `.env` locally, Render env
  var in production) — a second published-to-web CSV, separate from
  `ODDS_SHEET_CSV_URL`. Columns (header required, located by name):
  `playerId, multiplier`. One row per player the sheet owner has assigned
  odds to — it does not need to cover all ~50 live scorer candidates, only
  whichever player(s) the sheet owner has filled in.
- Backend caches and parses this sheet the same way as the match-odds sheet:
  60-second TTL, stale-cache-on-fetch-failure fallback, never-fetched-yet
  defaults to `{}`. This is a second, independent cache/fetch pair — not a
  merge with the match-odds cache, since the row shape is different (one
  multiplier per player, not six per match).
- `AwardPick.js` (the picker UI) is unaffected — it still lists all live
  scorer candidates from the football-data API and lets the user pick any of
  them, with no odds-availability gating. Unlike match betting, there's no
  stake at risk here, so there's no fairness reason to restrict picks to
  only the players who happen to have a sheet row yet.

## Settlement (`settleAwardPicks`)

`settleAwardPicks` becomes `async` (it now needs to await the player-odds
fetch) and the `/api/points` handler awaits it instead of calling it
synchronously.

When the actual winner (`actual.actualPlayerId`, hand-filled in
`server/data/awards.json` once FIFA announces it — unchanged) matches the
user's pick:

```js
const playerOdds = await fetchPlayerOddsFromSheet();
const multiplier = playerOdds[actual.actualPlayerId] ?? 1;
pick.pointsAwarded = correct ? Math.round(AWARD_BASE_POINTS * multiplier) : 0;
```

`AWARD_BASE_POINTS = 100` (parallel constant to `CHAMPION_BASE_POINTS`). If
the actual winner has no row in the player-odds sheet, the multiplier falls
back to `1` (100 points flat) — same defensive fallback already used for
match-prediction settlement when a match's odds row disappears between
placement and settlement. This is a deliberate difference from match
betting's fail-closed behavior: there's no stake to protect here, only a
points payout, so a missing row degrades gracefully instead of blocking
anything.

`server/data/awards.json`'s `basePoints: 15` field is removed (superseded by
the `AWARD_BASE_POINTS * multiplier` formula) — the file becomes:

```json
{
  "topScorer": { "actualPlayerId": null, "actualPlayerName": null }
}
```

## Testing

No automated backend test framework exists in this codebase (consistent
with every prior plan). Manual verification:

1. Publish a test player-odds sheet with one row (`playerId, multiplier`).
   Point `PLAYER_ODDS_SHEET_CSV_URL` at it and confirm
   `fetchPlayerOddsFromSheet()` returns that player's multiplier (via a
   temporary log or a one-off script, same pattern as the match-odds CSV
   verification).
2. Manually set `awards.json`'s `actualPlayerId` to a test player who has a
   sheet row with `multiplier: 3`, and a test user's `awardPicks.topScorer`
   to the same player ID with `status: 'pending'`. Hit `/api/points` and
   confirm `pointsAwarded` becomes `300` and `points` increases by `300`.
3. Repeat with `actualPlayerId` set to a player with no sheet row — confirm
   `pointsAwarded` falls back to `100` (multiplier 1) instead of erroring.
4. Manually set a test user's `championPick` to the correct team with
   `status: 'pending'` and that team's `multiplier: 2` in
   `championTeams.json`. Confirm settlement now awards `200` points (was
   `20` before this change).
