# Match History Page — Design

## Goal

Split the Home (score) page so it only shows matches that have not finished. Matches that have finished move to a new "Match History" page.

## Decisions

- **Home page** (`src/Home.js`) shows `SCHEDULED`, `TIMED`, `IN_PLAY`, and `PAUSED` matches. It no longer shows `FINISHED` matches.
- **New Match History page** (`src/MatchHistory.js`) shows only `FINISHED` matches, sorted most-recent first (descending by `utcDate` — the opposite of Home's chronological-ascending order, since history reads naturally newest-on-top).
- Both pages fetch the same data source (`fixtures.json` static scaffold, live-merged via `GET /api/competitions/WC/matches`), filtered differently after the merge. No new backend endpoint is needed.
- Match History reuses the same card visuals as Home (team crests, score, date, stage badge) and the same click-through to `/match/:matchId`.
- Match History has no filter tabs — every match shown is `FINISHED`, so tabs would have nothing to filter.
- No pagination on Match History. World Cup 2026 has at most 104 matches; Home already renders that count unpaginated today, so this introduces no new perf concern.

## Shared logic

`statusLabel()` and `formatDate()` currently live inside `Home.js` and are needed, unchanged, by `MatchHistory.js`. Extract both into a new pure-function module `src/matchUtils.js`:

```js
// src/matchUtils.js
export const statusLabel = (status) => {
  const map = {
    FINISHED: { label: 'FT', cls: 'status-ft' },
    IN_PLAY: { label: 'LIVE', cls: 'status-live' },
    PAUSED: { label: 'HT', cls: 'status-live' },
    TIMED: { label: 'Upcoming', cls: 'status-upcoming' },
    SCHEDULED: { label: 'Scheduled', cls: 'status-upcoming' },
  };
  return map[status] || { label: status, cls: '' };
};

export const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
```

`Home.js` and `MatchHistory.js` both import from `./matchUtils` instead of defining their own copies.

## Home.js changes

- Filter tabs shrink from `['ALL', 'FINISHED', 'IN_PLAY', 'SCHEDULED']` to `['ALL', 'IN_PLAY', 'SCHEDULED']`.
- The rendered list additionally excludes `FINISHED` matches regardless of which tab is active:
  ```js
  const filtered = matches
    .filter(m => m.status !== 'FINISHED')
    .filter(m => filter === 'ALL' || m.status === filter);
  ```
- Page title/subtitle, live-error banner, and card markup are unchanged.
- `statusLabel`/`formatDate` are imported from `src/matchUtils.js` instead of being defined locally.

## MatchHistory.js (new file)

- Same data fetching pattern as Home: static `baseMatches` from `fixtures.json` (status forced to `SCHEDULED` as a placeholder, since only fixtures with a live-confirmed `FINISHED` status will actually render), merged with live data from `GET /api/competitions/WC/matches` on mount.
- Renders only matches where `status === 'FINISHED'`, sorted descending by `utcDate`.
- Page header: title "MATCH HISTORY", subtitle "FIFA World Cup 2026 — Completed Matches".
- Same live-error banner pattern as Home ("Live results temporarily unavailable" or similar) if the fetch fails.
- Empty state: "No matches have finished yet." when the finished list is empty.
- Card markup is the same shape as Home's match card (team crests, score, date, stage badge, click-through to `/match/:matchId`) — reuses `Home.css` classes (`.match-card`, `.match-teams`, etc.) rather than duplicating CSS; a new `MatchHistory.css` only holds page-specific overrides (page title) if any are needed.

## Routing and navigation

- `src/App.js`: add `<Route path="/history" element={<ProtectedRoute><MatchHistory /></ProtectedRoute>} />` alongside the existing routes, importing `MatchHistory` from `./MatchHistory`.
- `src/navbar.js`: add `<li><NavLink to="/history" onClick={() => setMenuOpen(false)}>History</NavLink></li>` after the "My Predictions" link.

## Error handling

Identical to Home's existing pattern: if the live fetch fails, fall back to showing the static fixture scaffold (which won't include any `FINISHED` matches, since the scaffold always seeds `status: 'SCHEDULED'`) and show a banner. This means if live data is unavailable, Match History will simply show its empty state plus the error banner — acceptable, since there's no cached "last known finished match list" to fall back to.

## Testing

No automated test suite exists for frontend components in this project (verified: no `*.test.js` files for `Home.js`/`Standings.js`/etc.). Verification is manual: run `npm start`, confirm Home no longer lists any `FINISHED` match, confirm `/history` lists only `FINISHED` matches sorted newest-first, confirm navbar link works, confirm clicking a History card still opens the correct `MatchDetail` page.
