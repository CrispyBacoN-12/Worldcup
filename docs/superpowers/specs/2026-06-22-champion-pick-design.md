# Champion Pick — Design

## Goal

Let users pick which team they think will win the World Cup overall, separate from the existing per-match predictions. A correct pick earns bonus points; picks lock once the knockout Round of 32 begins.

## Scoring

- Base points for a correct champion pick: `10`.
- Each team has a `multiplier` (default `1` for every team at launch). Points awarded for a correct pick = `round(10 * multiplier)`.
- Wrong pick → 0 points. No pick made → nothing to settle.
- The `multiplier` values are placeholders today. The user will edit `server/data/championTeams.json` by hand later with real odds-derived numbers (e.g. from Polymarket) — no code changes required for that update.

## Lock deadline

Picks can be made or changed freely until **2026-06-28T19:00:00Z**, the kickoff of the first `LAST_32` (Round of 32) match per `src/data/fixtures.json`. After that instant, the pick is frozen both client- and server-side.

This timestamp is hardcoded as `CHAMPION_LOCK_AT` in `server/index.js`, with a comment noting it was derived from the earliest `LAST_32`-stage `utcDate` in `fixtures.json`.

## Settlement

The Final match has a fixed id, `537390` (the `FINAL`-stage entry in `fixtures.json`, with teams still `null`/TBD until the bracket resolves). This is hardcoded as `FINAL_MATCH_ID` in `server/index.js`.

When `GET /api/points` is called:
1. If the user has a `championPick` with `status: 'pending'`, fetch match `537390` via the existing `fetchFootballData` helper.
2. If that match's `status !== 'FINISHED'`, leave it pending.
3. If `FINISHED`: derive the actual champion's team id from `match.score.winner` (`HOME_TEAM` → `match.homeTeam.id`, `AWAY_TEAM` → `match.awayTeam.id`). Compare to the stored pick's `teamId`.
4. Correct → `status: 'correct'`, `pointsAwarded = round(10 * multiplier)`, add to `userData.points`. Wrong → `status: 'wrong'`, `pointsAwarded: 0`.

## Data model

`server/data/championTeams.json` — single source of truth for valid teams, display data, and odds:

```js
[
  { "id": 762, "name": "Argentina", "shortName": "Argentina", "crest": "https://crests.football-data.org/762.svg", "multiplier": 1 },
  // ... all 48 World Cup teams, ids/names/crests taken from src/data/fixtures.json
]
```

`server/wallet.json` per-user record gains one new optional field:

```js
{
  points,
  predictions: [...],
  championPick: {
    teamId: number,
    name: string,
    shortName: string,
    crest: string | null,
    placedAt: ISO string,
    status: 'pending' | 'correct' | 'wrong',
    pointsAwarded: number | null,
    settledAt: ISO string | null,
  } | undefined,
}
```

## Backend — `server/index.js`

- `GET /api/champion/teams` — no auth (consistent with the existing football-data proxy route). Returns `{ lockAt: CHAMPION_LOCK_AT, teams: <contents of championTeams.json> }`.
- `POST /api/champion-pick` — requires auth (`verifyToken`). Body: `{ teamId }`.
  - 400 if `teamId` is not a key in `championTeams.json`.
  - 400 if `Date.now() >= CHAMPION_LOCK_AT` ("Champion picks are locked").
  - Otherwise look up the team's `name`/`shortName`/`crest` from `championTeams.json`, and upsert (overwrite if one already exists, since picks are freely changeable pre-lock) `wallet[user].championPick = { teamId, name, shortName, crest, placedAt: now, status: 'pending', pointsAwarded: null, settledAt: null }`.
  - Returns `{ points, championPick }`.
- `GET /api/points` — extend to also run champion-pick settlement (see Settlement above) before responding, and include `championPick` in the JSON payload alongside the existing `points`/`predictions`.

## Frontend

**`src/PointsContext.js`** — add `championPick` state (populated from `GET /api/points`'s response) and a `submitChampionPick(teamId)` function that POSTs to `/api/champion-pick` and updates local state, mirroring the existing `submitPrediction` pattern.

**`src/ChampionPick.js`** (new) + **`src/ChampionPick.css`** (new):
- On mount, `GET /api/champion/teams` to get `{ lockAt, teams }`.
- A text input filters the 48-team grid by name (case-insensitive substring match) — needed since 48 cards is a lot to scan.
- Each team renders as a card (crest + name), matching the visual style of `.odd-box` cards in `MatchDetail.css`.
- **Before lock, no existing pick:** tapping a card selects it (highlight, like the existing outcome-picker buttons); a "Confirm Pick" button appears once a team is selected and calls `submitChampionPick`.
- **Before lock, existing pick:** show the picked team prominently with a "เปลี่ยนทีม" (change pick) button that re-opens the grid for a new selection (still calls the same `submitChampionPick`, which overwrites).
- **After lock:** grid is not interactive. Show the picked team and its status:
  - `pending` → "รอจบทัวร์นาเมนต์…" (waiting for the tournament to finish)
  - `correct` → "ทายถูก! ได้ +N แต้ม 🏆" (using the actual `pointsAwarded`)
  - `wrong` → "ทายพลาด — 0 แต้ม"
  - If the user never made a pick before lock, show "คุณไม่ได้ทายแชมป์ไว้ก่อนปิดรับ" (no pick was made before lock).

**`src/App.js`** — add `<Route path="/champion" element={<ProtectedRoute><ChampionPick /></ProtectedRoute>} />`.

**`src/navbar.js`** — add a nav link "ทายแชมป์" pointing to `/champion`, after the existing "History" link.

## Testing

No automated frontend test suite exists (consistent with the rest of this codebase). Manual verification:
1. Before the lock deadline: open `/champion`, filter for a team by typing part of its name, select it, confirm — `GET /api/points` afterward shows the `championPick` with `status: 'pending'`.
2. Pick a different team before lock — confirms the overwrite (only one `championPick` is ever stored, not a list).
3. Call `POST /api/champion-pick` directly after temporarily setting `CHAMPION_LOCK_AT` to a past timestamp (or wait for real lock) — expect `400 Champion picks are locked`.
4. Manually flip `server/wallet.json`'s `championPick.status` away from `'pending'` is not how settlement is tested — instead, temporarily point `FINAL_MATCH_ID` at an already-`FINISHED` match during local testing to confirm settlement math (`points += round(10 * multiplier)` on a correct pick, `0` on a wrong one), then revert the constant.
