# Total Goals & Handicap Markets — Design

## Goal

Add two new betting markets alongside the existing 1X2/Double Chance
("moneyline") market: **Total Goals** (over/under a line) and **Handicap**
(home/away against a line). Both are usable in single predictions and as
step (parlay) legs, same as the existing market. Lines and odds are sourced
from the same Google Sheet already used for moneyline odds. A third market
("penalty award") was considered and dropped — football-data.org's free
tier doesn't expose in-match penalty events, and admin-entered results
weren't wanted for this feature.

## Market definitions

- **Total Goals**: over/under the published `line` (regular-time goals,
  home + away combined). Lines are half-integers (e.g. `2.5`, `3.5`) by
  design, so a push/tie is impossible.
- **Handicap**: `line` is always expressed relative to the home team (e.g.
  `-1.5` means the home team must win by 2+ goals; `+1.5` means the home
  team can lose by 1 and still cover). Also half-integer lines only, so no
  push case. Outcome is `home` or `away` — no draw option, since a
  half-line handicap always produces a winner.

Both markets settle off **regular-time (90-minute) goals**, using the
existing `regularTimeResult(match)` helper (already correctly derived by
subtracting `extraTime` from `fullTime` — no changes needed there).

## Data model

```js
const MARKETS = {
  moneyline: ['home', 'draw', 'away', '1X', '12', 'X2'],
  total: ['over', 'under'],
  handicap: ['home', 'away'],
};
```

Every prediction and step-leg record gains a `market` field. It defaults to
`'moneyline'` — existing stored predictions have no `market` field, and are
treated as `'moneyline'` wherever the field is read (`prediction.market ??
'moneyline'`), so no data migration is needed.

`total`/`handicap` predictions also store a `line` (number), captured **at
placement time** from the odds sheet — not supplied by the client. This
differs from the existing moneyline `multiplier`, which is intentionally
read fresh from the sheet at settlement time (see `settlePredictions`'s
existing comment on why: odds can legitimately change between placement and
settlement). The `line` can't work the same way: for total/handicap markets
the line defines what "correct" even means, so if it drifted between
placement and settlement, a bet could flip outcome without the player ever
seeing the line they were actually playing against. Pinning `line` at
placement and floating only the payout multiplier keeps both properties:
the odds still reflect the latest sheet at settlement (existing behavior,
unchanged for moneyline and reused for total/handicap's multiplier), while
the bet's definition stays fixed to what the player saw when they placed it.

Example single prediction record (total market):

```js
{
  id: '...', matchId: 537388, homeTeam: 'ENG', awayTeam: 'ARG',
  market: 'total', outcome: 'over', line: 2.5,
  stake: 100, status: 'pending', payout: null,
  placedAt: '...', settledAt: null,
}
```

Step-leg records gain the same `market`/`line` fields; everything else
about `stepPredictions` (combined multiplier, all-or-nothing settlement)
is unchanged.

## Odds sheet format

New columns added to the existing published sheet, alongside `matchId,
home, draw, away, 1X, 12, X2`:

```
totalLine, totalOver, totalUnder, handicapLine, handicapHome, handicapAway
```

`parseOddsCsv` changes its output shape from a flat per-match object to a
per-market nested object:

```js
result[matchId] = {
  moneyline: { home, draw, away, '1X': .., '12': .., X2: .. },
  total: { line, over, under },       // present only if all 3 cells are numeric
  handicap: { line, home, away },     // present only if all 3 cells are numeric
};
```

Same "blank = unavailable" convention as today: a match missing any of the
3 total or 3 handicap cells simply doesn't offer that market yet (all-or-
nothing per market, so a half-filled row can't produce a line with no
price or a price with no line).

`getOddsMultiplier(odds, matchId, market, outcome)` and a new
`getOddsLine(odds, matchId, market)` replace the old 2-arg
`getOddsMultiplier(odds, matchId, outcome)`:

```js
const getOddsMultiplier = (odds, matchId, market, outcome) =>
  odds[matchId]?.[market]?.[outcome];

const getOddsLine = (odds, matchId, market) =>
  odds[matchId]?.[market]?.line;
```

(`moneyline` entries have no `line` — `getOddsLine` simply returns
`undefined` for that market, which callers never use.)

## Settlement

`server/index.js` gets one new helper, used by both `settlePredictions` and
`settleStepPrediction` alongside the existing `outcomeWins`:

```js
// Regular-time goal-based win check for total/handicap markets. `regular`
// is regularTimeResult(match) — { home, away } — already computed by the
// caller before this is invoked.
const marketOutcomeWins = (market, outcome, line, regular) => {
  if (market === 'total') {
    const totalGoals = regular.home + regular.away;
    return outcome === 'over' ? totalGoals > line : totalGoals < line;
  }
  if (market === 'handicap') {
    const adjustedHome = regular.home + line;
    return outcome === 'home' ? adjustedHome > regular.away : adjustedHome < regular.away;
  }
  return false; // unreachable for 'moneyline', which uses outcomeWins instead
};
```

Both settlement functions branch on `market` before computing correctness:

```js
const regular = regularTimeResult(match);
const market = prediction.market ?? 'moneyline';
const correct = market === 'moneyline'
  ? outcomeWins(prediction.outcome, regularTimeWinner(match))
  : marketOutcomeWins(market, prediction.outcome, prediction.line, regular);
```

The payout multiplier lookup changes from `getOddsMultiplier(odds,
matchId, outcome)` to `getOddsMultiplier(odds, matchId, market, outcome)`
— same fallback-to-`1` behavior as today if the sheet no longer has a row
for that match/market/outcome by settlement time.

`regularTimeKnown`/`regularTimeWinner`/`regularTimeResult` themselves need
no changes — they already return what's needed.

## API (`server/index.js`)

`POST /api/predictions` and `POST /api/step-predictions`:

- Accept an optional `market` field (each leg, for step) — defaults to
  `'moneyline'` if omitted, so an old cached frontend bundle still works
  unchanged during a deploy.
- Validate `market` is a known key of `MARKETS`, and `outcome` is a member
  of `MARKETS[market]` (replaces today's flat `OUTCOMES.includes(outcome)`
  check).
- After the existing match-status (`BETTABLE`) check, look up odds via
  `fetchOddsFromSheet()` as today, but market-aware:
  - `moneyline`: unchanged — `getOddsMultiplier(odds, matchId, 'moneyline', outcome)`,
    400 `'Odds are not available for this match yet'` if missing.
  - `total`/`handicap`: `getOddsLine(odds, matchId, market)` and
    `getOddsMultiplier(odds, matchId, market, outcome)`. If either is
    missing, same 400 as above. If both present, store `line` on the
    created prediction/leg record (the multiplier itself isn't stored,
    matching existing moneyline behavior).
- The step "each match can only appear once" check stays keyed by
  `matchId` alone — a match can't appear twice in one step even under two
  different markets. Keeps the parlay model simple and avoids reasoning
  about correlated outcomes (e.g. `total:over` + `handicap:home` on the
  same match) within one combined-multiplier product.

## Frontend

**`src/PointsContext.js`**:
- `getMultiplier` becomes `(matchId, market, outcome) => odds[matchId]?.[market]?.[outcome]`.
- New `getLine(matchId, market) => odds[matchId]?.[market]?.line`.
- `submitPrediction`/`submitStepPrediction` pass `market` through to the
  API call bodies (already pass-through objects, no other change needed).

**`src/Prediction.js`**:
- Each match card's bet section gets two more outcome rows below the
  existing 6-button moneyline row, each only rendered when
  `getLine(match.id, market)` is defined for that match:
  - **Total row**: two buttons, `Over {line}` / `Under {line}`, each
    showing its multiplier the same way existing buttons do
    (`×{multiplier}` / `N/A` when unavailable).
  - **Handicap row**: two buttons, `{homeAbbr} {line >= 0 ? '+' : ''}{line}`
    / `{awayAbbr} {-line >= 0 ? '+' : ''}{-line}` (away's displayed line is
    always the negation of the stored home-relative line), each showing
    its multiplier the same way.
- `picks`/`stepPicks` state shape changes from `{ [matchId]: outcome }` to
  `{ [matchId]: { market, outcome } }` so a match can have at most one
  active pick across all three market rows at once (selecting a Total
  button clears any Moneyline/Handicap selection on that same card, and
  vice versa) — this mirrors the existing single-pick-per-match invariant
  and keeps the stake/submit UI (one stake input per card) unambiguous.
- `outcomeLabel(match, market, outcome, line)` extends to cover the new
  markets: `total` → `` `Over ${line}` `` / `` `Under ${line}` ``;
  `handicap` → `` `${teamAbbr} ${signedLine}` ``.
- Step slip / existing-bet display (`step.legs`, `serverPredictions`)
  render using the same extended `outcomeLabel`, reading each leg's/
  prediction's own stored `market`/`line` (defaulting `market` to
  `'moneyline'` for older records with none, per the data-model section).
- `src/PredictionHistory.js` (if it independently formats outcome labels)
  gets the same `outcomeLabel` extension — needs a quick check during
  implementation for any duplicated label logic outside `Prediction.js`.

## Removed / changed contracts

- `getOddsMultiplier(odds, matchId, outcome)` (2-arg-after-odds signature)
  is replaced by the 3-arg `getOddsMultiplier(odds, matchId, market,
  outcome)` everywhere it's called (`server/index.js` and
  `src/PointsContext.js`).
- `OUTCOMES` (flat array) is replaced by `MARKETS` (object keyed by market
  name). Any remaining direct use of `OUTCOMES.includes(...)` for
  validation is replaced by `MARKETS[market]?.includes(outcome)`.

## Testing

No automated frontend test suite exists (consistent with the rest of this
codebase, per the prior sheet-odds spec). Manual verification:

1. Publish a test sheet row with `totalLine=2.5, totalOver=1.9,
   totalUnder=1.9, handicapLine=-1, handicapHome=1.8, handicapAway=2.0` for
   one match. Confirm `/api/odds` returns nested `total`/`handicap` objects
   for that match within a minute of publishing.
2. Leave `totalUnder` blank for a match that has `totalLine`/`totalOver`
   filled in. Confirm neither Total button renders/enables for that match
   (all-or-nothing per market) and a same-match `market: 'total'`
   prediction request returns 400.
3. Place a `total`/`over` prediction on a match with `line: 2.5`. Then
   change the sheet's `totalLine` to `3.5` before the match finishes.
   Confirm settlement still uses `2.5` (the line stored at placement), not
   the sheet's current value — proving the line-pinning behavior works.
4. Settle a `handicap`/`home` prediction with `line: -1.5` against a
   regular-time result of `2-1` (adjusted home score `0.5`, below away's
   `1`) — confirm it settles `wrong`. Then re-run against `3-1` (adjusted
   `1.5` vs `1`) — confirm `correct`.
5. Build a step with one `moneyline:1X` leg and one `total:under` leg on
   two different matches; confirm `combinedMultiplier` is the product of
   both sheet-sourced multipliers and both legs carry their own
   `market`/`line`.
6. Confirm a pre-existing prediction record (no `market` field, created
   before this change) still displays and settles correctly as moneyline.
