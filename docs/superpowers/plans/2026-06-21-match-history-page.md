# Match History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home page shows only matches that haven't finished; finished matches move to a new Match History page at `/history`.

**Architecture:** Extract `statusLabel`/`formatDate` from `Home.js` into a shared `src/matchUtils.js` module. Modify `Home.js` to exclude `FINISHED` matches. Add a new `MatchHistory.js` page that fetches the same data (static fixtures + live merge) and renders only `FINISHED` matches, newest first. Wire up routing (`/history`) and a navbar link.

**Tech Stack:** React (CRA), react-router-dom, axios. No backend changes. No test framework is configured for the frontend (no `*.test.js` files exist for any page component) — verification is manual via `npm start`.

## Global Constraints

- Match History shows only matches with `status === 'FINISHED'`, sorted descending by `utcDate` (newest first).
- Home shows everything except `FINISHED` (i.e. `SCHEDULED`, `TIMED`, `IN_PLAY`, `PAUSED`); its filter tabs become `['ALL', 'IN_PLAY', 'SCHEDULED']`.
- Match History has no filter tabs and no pagination.
- Both pages must use identical `statusLabel()`/`formatDate()` logic, sourced from one shared module (`src/matchUtils.js`) — no duplicated copies.
- Match History reuses Home's existing card markup/classes (`.match-card`, `.match-teams`, `.score-box`, etc. from `Home.css`) rather than duplicating CSS.
- Data source for both pages: static `src/data/fixtures.json` scaffold, live-merged via `GET ${REACT_APP_SERVER_URL || 'http://localhost:5000'}/api/competitions/WC/matches` on mount (same pattern as current `Home.js`).
- Routing: new route `/history` wrapped in the existing `ProtectedRoute` component, same as all other authenticated routes in `src/App.js`.
- Navbar: new link labeled "History" pointing to `/history`, placed after "My Predictions" in `src/navbar.js`.

---

### Task 1: Extract shared match-display utilities into `src/matchUtils.js`

**Files:**
- Create: `src/matchUtils.js`
- Modify: `src/Home.js` (lines 35-49 — remove local `statusLabel`/`formatDate`, import from `./matchUtils` instead)

**Interfaces:**
- Produces: `statusLabel(status: string) => { label: string, cls: string }`, `formatDate(dateStr: string) => string` — both pure functions, no React/component dependency. Task 3 (MatchHistory.js) imports both from `./matchUtils`.

- [ ] **Step 1: Create `src/matchUtils.js` with the extracted functions**

```js
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

- [ ] **Step 2: Update `src/Home.js` to import from the new module and delete the local copies**

In `src/Home.js`, add this import alongside the existing ones at the top of the file:

```js
import { statusLabel, formatDate } from './matchUtils';
```

Then delete the local `statusLabel` and `formatDate` function definitions (currently lines 35-49 of `src/Home.js`):

```js
  const statusLabel = (status) => {
    const map = {
      FINISHED: { label: 'FT', cls: 'status-ft' },
      IN_PLAY: { label: 'LIVE', cls: 'status-live' },
      PAUSED: { label: 'HT', cls: 'status-live' },
      TIMED: { label: 'Upcoming', cls: 'status-upcoming' },
      SCHEDULED: { label: 'Scheduled', cls: 'status-upcoming' },
    };
    return map[status] || { label: status, cls: '' };
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
```

Remove this whole block (both functions). Do not leave an empty blank gap of more than one line where they were.

- [ ] **Step 3: Verify the app still compiles and Home still renders correctly**

Run: `npm start` (or if already running, just check the browser auto-reloads)
Expected: No console errors about `statusLabel`/`formatDate` being undefined; Home page renders match cards with status badges and dates exactly as before (FT/LIVE/HT/Upcoming/Scheduled labels still show correctly).

Stop the dev server after confirming (Ctrl+C), since later tasks will need to restart it anyway.

- [ ] **Step 4: Commit**

```bash
git add src/matchUtils.js src/Home.js
git commit -m "Extract statusLabel/formatDate into shared matchUtils module"
```

---

### Task 2: Make Home page exclude FINISHED matches

**Files:**
- Modify: `src/Home.js` (filter tabs array, and the `filtered` computation)

**Interfaces:**
- Consumes: nothing new (uses existing `matches` state and `filter` state already in `Home.js`).
- Produces: nothing new for other tasks — this task is self-contained.

- [ ] **Step 1: Change the filter tabs list to remove `'FINISHED'`**

In `src/Home.js`, find this line (the array driving the rendered filter-tab buttons):

```js
        {['ALL', 'FINISHED', 'IN_PLAY', 'SCHEDULED'].map(f => (
```

Replace it with:

```js
        {['ALL', 'IN_PLAY', 'SCHEDULED'].map(f => (
```

The label-mapping line right below it currently reads:

```js
            {f === 'ALL' ? 'All' : f === 'FINISHED' ? 'Finished' : f === 'IN_PLAY' ? 'Live' : 'Upcoming'}
```

Replace it with (drop the now-impossible `'FINISHED'` branch):

```js
            {f === 'ALL' ? 'All' : f === 'IN_PLAY' ? 'Live' : 'Upcoming'}
```

- [ ] **Step 2: Exclude FINISHED matches from the rendered list regardless of which tab is active**

Find this line in `src/Home.js`:

```js
  const filtered = matches.filter(m => filter === 'ALL' || m.status === filter);
```

Replace it with:

```js
  const filtered = matches
    .filter(m => m.status !== 'FINISHED')
    .filter(m => filter === 'ALL' || m.status === filter);
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm start`, open the Home page (`/`).
Expected: No match card shows status "FT". The filter tabs read "All / Live / Upcoming" (no "Finished" tab). If any real fixture in `src/data/fixtures.json` already has a finished match merged in via the live API, confirm it no longer appears on Home.

Stop the dev server after confirming.

- [ ] **Step 4: Commit**

```bash
git add src/Home.js
git commit -m "Home page excludes finished matches"
```

---

### Task 3: Create the Match History page

**Files:**
- Create: `src/MatchHistory.js`
- Create: `src/MatchHistory.css`

**Interfaces:**
- Consumes: `statusLabel`, `formatDate` from `./matchUtils` (produced by Task 1). Reuses CSS classes already defined in `src/Home.css` (`.home-page`, `.page-header`, `.page-title`, `.page-subtitle`, `.error-box`, `.empty-state`, `.matches-list`, `.match-card`, `.match-meta`, `.match-stage`, `.match-status`, `.match-date`, `.match-teams`, `.team`, `.team-crest`, `.team-name`, `.score-box`, `.score`).
- Produces: default export `MatchHistory` (a React component), consumed by Task 4 (`App.js` routing).

- [ ] **Step 1: Create `src/MatchHistory.css` with page-specific overrides only**

```css
.history-page .page-title {
  letter-spacing: 0.05em;
}
```

This file exists so the page can carry its own minor overrides later without touching `Home.css`; today it only needs the title's letter-spacing tweak to distinguish it slightly from Home's title styling.

- [ ] **Step 2: Create `src/MatchHistory.js`**

```js
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import fixtures from './data/fixtures.json';
import { statusLabel, formatDate } from './matchUtils';
import './Home.css';
import './MatchHistory.css';

const BASE_URL = `${process.env.REACT_APP_SERVER_URL || 'http://localhost:5000'}/api`;

const baseMatches = fixtures
  .slice()
  .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
  .map((f) => ({ ...f, status: 'SCHEDULED', score: { fullTime: { home: null, away: null } } }));

const MatchHistory = () => {
  const [matches, setMatches] = useState(baseMatches);
  const [liveError, setLiveError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const res = await axios.get(`${BASE_URL}/competitions/WC/matches`);
        const liveById = new Map(res.data.matches.map((m) => [m.id, m]));
        setMatches(baseMatches.map((m) => liveById.get(m.id) || m));
      } catch {
        setLiveError(true);
      }
    };
    fetchLiveData();
  }, []);

  const finished = matches
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

  return (
    <div className="home-page history-page">
      <div className="page-header">
        <h1 className="page-title">MATCH HISTORY</h1>
        <p className="page-subtitle">FIFA World Cup 2026 — Completed Matches</p>
      </div>

      {liveError && (
        <div className="error-box" style={{ marginBottom: '1rem' }}>
          Live results are temporarily unavailable.
        </div>
      )}

      {finished.length === 0 ? (
        <div className="empty-state">No matches have finished yet.</div>
      ) : (
        <div className="matches-list">
          {finished.map(match => {
            const { label, cls } = statusLabel(match.status);
            const home = match.homeTeam;
            const away = match.awayTeam;
            const score = match.score.fullTime;
            return (
              <div key={match.id} className="match-card" onClick={() => navigate(`/match/${match.id}`)} style={{ cursor: 'pointer' }}>
                <div className="match-meta">
                  <span className="match-stage">{match.stage?.replace(/_/g, ' ')}</span>
                  <span className={`match-status ${cls}`}>{label}</span>
                  <span className="match-date">{formatDate(match.utcDate)}</span>
                </div>

                <div className="match-teams">
                  <div className="team home">
                    {home.crest && <img src={home.crest} alt={home.name} className="team-crest" />}
                    <span className="team-name">{home.shortName || home.name}</span>
                  </div>

                  <div className="score-box">
                    <span className="score">{score.home ?? '-'} : {score.away ?? '-'}</span>
                  </div>

                  <div className="team away">
                    <span className="team-name">{away.shortName || away.name}</span>
                    {away.crest && <img src={away.crest} alt={away.name} className="team-crest" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MatchHistory;
```

- [ ] **Step 3: Verify the component compiles**

Run: `npm start`
Expected: No compile errors. The route doesn't exist yet (Task 4), so this can only be confirmed by absence of build errors at this point — full visual verification happens in Task 4.

Stop the dev server after confirming no compile errors.

- [ ] **Step 4: Commit**

```bash
git add src/MatchHistory.js src/MatchHistory.css
git commit -m "Add Match History page component"
```

---

### Task 4: Wire up routing and navbar link

**Files:**
- Modify: `src/App.js` (add import + route)
- Modify: `src/navbar.js` (add nav link)

**Interfaces:**
- Consumes: `MatchHistory` default export from `./MatchHistory` (produced by Task 3); existing `ProtectedRoute` component already defined in `src/App.js`.

- [ ] **Step 1: Add the import and route in `src/App.js`**

Find this import block near the top of `src/App.js`:

```js
import MatchDetail from './MatchDetail';
import PredictionHistory from './PredictionHistory';
```

Add a new import line after `MatchDetail`:

```js
import MatchDetail from './MatchDetail';
import MatchHistory from './MatchHistory';
import PredictionHistory from './PredictionHistory';
```

Find this route line:

```js
          <Route path="/match/:matchId" element={<ProtectedRoute><MatchDetail /></ProtectedRoute>} />
```

Add a new route directly after it:

```js
          <Route path="/match/:matchId" element={<ProtectedRoute><MatchDetail /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><MatchHistory /></ProtectedRoute>} />
```

- [ ] **Step 2: Add the navbar link in `src/navbar.js`**

Find this line:

```js
          <li><NavLink to="/predictions" onClick={() => setMenuOpen(false)}>My Predictions</NavLink></li>
```

Add a new link directly after it:

```js
          <li><NavLink to="/predictions" onClick={() => setMenuOpen(false)}>My Predictions</NavLink></li>
          <li><NavLink to="/history" onClick={() => setMenuOpen(false)}>History</NavLink></li>
```

- [ ] **Step 3: Manually verify the full feature end-to-end**

Run: `npm start`, log in, and check:
1. Navbar shows a "History" link after "My Predictions".
2. Clicking it navigates to `/history` and renders the Match History page with header "MATCH HISTORY".
3. Only matches with status FT (FINISHED) appear on `/history`, newest date first.
4. Going back to Home (`/`), no FT matches appear there; filter tabs read "All / Live / Upcoming".
5. Clicking a match card on `/history` navigates to `/match/:matchId` and shows the correct match detail (same as clicking a card on Home).
6. If no real-world matches have finished yet (likely, given the World Cup hasn't started as of fixture data), confirm the empty state "No matches have finished yet." renders correctly on `/history` instead of a blank page.

Expected: All six checks pass with no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.js src/navbar.js
git commit -m "Wire up /history route and navbar link for Match History page"
```
