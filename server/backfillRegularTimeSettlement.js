// Backfill for the regular-time-result fix: predictions/step-legs that were
// ALREADY settled (status 'correct'/'wrong') using match.score.winner (which
// includes extra time/penalties) instead of the 90-minute result. Only
// matches that actually went to extra time or penalties can possibly have a
// wrong verdict — matches decided in regular time are unaffected and skipped.
//
//   MONGODB_URI=... FOOTBALL_API_KEY=... ODDS_SHEET_CSV_URL=... node backfillRegularTimeSettlement.js            (dry run)
//   MONGODB_URI=... FOOTBALL_API_KEY=... ODDS_SHEET_CSV_URL=... node backfillRegularTimeSettlement.js --apply
const axios = require('axios');
const nodePath = require('path');
try {
  process.loadEnvFile(nodePath.join(__dirname, '.env'));
} catch {
  // .env is optional in environments where these vars are set another way
}
const storage = require('./storage');

const API_KEY = process.env.FOOTBALL_API_KEY;
const BASE = 'https://api.football-data.org/v4';
const ODDS_SHEET_CSV_URL = process.env.ODDS_SHEET_CSV_URL;
const OUTCOMES = ['home', 'draw', 'away', '1X', '12', 'X2'];

const outcomeWins = (outcome, winner) => {
  if (outcome === 'home') return winner === 'HOME_TEAM';
  if (outcome === 'away') return winner === 'AWAY_TEAM';
  if (outcome === 'draw') return winner === 'DRAW';
  if (outcome === '1X') return winner === 'HOME_TEAM' || winner === 'DRAW';
  if (outcome === '12') return winner === 'HOME_TEAM' || winner === 'AWAY_TEAM';
  if (outcome === 'X2') return winner === 'DRAW' || winner === 'AWAY_TEAM';
  return false;
};

// score.fullTime is the running/final total (regular + extra-time goals), not
// a frozen 90-min snapshot, and score.duration unreliably stays "REGULAR"
// even once extra time has happened — derive the 90-min score by subtracting
// extraTime goals from fullTime instead of trusting either field directly.
const regularTimeResult = (match) => {
  const { fullTime, extraTime } = match.score;
  if (extraTime && extraTime.home != null) {
    return { home: fullTime.home - extraTime.home, away: fullTime.away - extraTime.away };
  }
  return { home: fullTime.home, away: fullTime.away };
};

const regularTimeWinner = (match) => {
  const { home, away } = regularTimeResult(match);
  if (home > away) return 'HOME_TEAM';
  if (away > home) return 'AWAY_TEAM';
  return 'DRAW';
};

const wentToExtraTime = (match) => match.score.extraTime && match.score.extraTime.home != null;

const parseOddsCsv = (csvText) => {
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const result = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    header.forEach((col, i) => { row[col] = cells[i]; });
    const matchId = row.matchId;
    if (!matchId) continue;
    const outcomes = {};
    for (const outcome of OUTCOMES) {
      const raw = row[outcome];
      const value = Number(raw);
      if (raw !== undefined && raw !== '' && !Number.isNaN(value)) outcomes[outcome] = value;
    }
    result[matchId] = outcomes;
  }
  return result;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 8 requests/minute on the football-data plan in use elsewhere in this app —
// stay well under that with a fixed delay since this is a one-off batch run,
// not a live request queue.
const fetchMatch = async (matchId) => {
  const res = await axios.get(`${BASE}/matches/${matchId}`, { headers: { 'X-Auth-Token': API_KEY } });
  await sleep(7500);
  return res.data;
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();

  const matchIds = new Set();
  for (const userData of Object.values(wallet)) {
    for (const p of userData.predictions || []) {
      if ((p.status === 'correct' || p.status === 'wrong') && p.stake != null) matchIds.add(p.matchId);
    }
    const step = userData.stepPrediction;
    if (step) {
      for (const leg of step.legs || []) {
        if (leg.status === 'correct' || leg.status === 'wrong') matchIds.add(leg.matchId);
      }
    }
  }

  console.log(`Checking ${matchIds.size} unique settled match id(s) for extra-time/penalties...`);
  const matches = new Map();
  let i = 0;
  for (const matchId of matchIds) {
    i++;
    try {
      const match = await fetchMatch(matchId);
      if (match.status === 'FINISHED' && wentToExtraTime(match)) {
        matches.set(matchId, match);
        console.log(`  [${i}/${matchIds.size}] ${matchId}: went to extra time — candidate`);
      } else {
        console.log(`  [${i}/${matchIds.size}] ${matchId}: ${match.status}, regular time — skip`);
      }
    } catch (err) {
      console.log(`  [${i}/${matchIds.size}] ${matchId}: fetch failed (${err.message}) — skip`);
    }
  }

  if (matches.size === 0) {
    console.log('\nNo matches went to extra time/penalties among settled bets. Nothing to backfill.');
    return;
  }

  let odds = {};
  if (ODDS_SHEET_CSV_URL) {
    try {
      const res = await axios.get(ODDS_SHEET_CSV_URL);
      odds = parseOddsCsv(res.data);
    } catch {
      // fall back to {} -> multiplier 1 for everything, same as live settlement's fallback
    }
  }
  const getOddsMultiplier = (matchId, outcome) => odds[matchId]?.[outcome];

  const predictionFixes = [];
  const legFixes = [];
  const stepRecalcs = [];

  for (const [username, userData] of Object.entries(wallet)) {
    for (const p of userData.predictions || []) {
      const match = matches.get(p.matchId);
      if (!match || p.stake == null || (p.status !== 'correct' && p.status !== 'wrong')) continue;

      const correctNow = outcomeWins(p.outcome, regularTimeWinner(match));
      const wasCorrect = p.status === 'correct';
      if (correctNow === wasCorrect) continue;

      const multiplier = getOddsMultiplier(p.matchId, p.outcome) ?? 1;
      const newPayout = correctNow ? Math.round(p.stake * multiplier) : 0;
      predictionFixes.push({
        username, prediction: p,
        oldStatus: p.status, oldPayout: p.payout || 0,
        newStatus: correctNow ? 'correct' : 'wrong', newPayout,
      });
    }

    const step = userData.stepPrediction;
    if (!step) continue;
    let stepTouched = false;
    for (const leg of step.legs || []) {
      const match = matches.get(leg.matchId);
      if (!match || (leg.status !== 'correct' && leg.status !== 'wrong')) continue;

      const correctNow = outcomeWins(leg.outcome, regularTimeWinner(match));
      const newStatus = correctNow ? 'correct' : 'wrong';
      if (newStatus === leg.status) continue;

      legFixes.push({ username, leg, oldStatus: leg.status, newStatus });
      stepTouched = true;
    }
    if (stepTouched) {
      const allCorrect = step.legs.every((l) => l.status === 'correct' ||
        legFixes.some((f) => f.leg === l && f.newStatus === 'correct'));
      const newLegStatuses = step.legs.map((l) => {
        const fix = legFixes.find((f) => f.leg === l);
        return fix ? fix.newStatus : l.status;
      });
      const newAllCorrect = newLegStatuses.every((s) => s === 'correct');
      const newPayout = newAllCorrect ? Math.round(step.stake * step.combinedMultiplier) : 0;
      stepRecalcs.push({
        username, step,
        oldStatus: step.status, oldPayout: step.payout || 0,
        newStatus: newAllCorrect ? 'correct' : 'wrong', newPayout,
      });
    }
  }

  console.log(`\nSingle-prediction fixes: ${predictionFixes.length}`);
  for (const f of predictionFixes) {
    console.log(`  ${f.username.padEnd(20)} match ${f.prediction.matchId} (${f.prediction.outcome}): ${f.oldStatus}/${f.oldPayout} -> ${f.newStatus}/${f.newPayout}`);
  }

  console.log(`\nStep-prediction leg fixes: ${legFixes.length}`);
  for (const f of legFixes) {
    console.log(`  ${f.username.padEnd(20)} leg match ${f.leg.matchId}: ${f.oldStatus} -> ${f.newStatus}`);
  }

  console.log(`\nStep-prediction overall recalcs: ${stepRecalcs.length}`);
  for (const r of stepRecalcs) {
    console.log(`  ${r.username.padEnd(20)} step: ${r.oldStatus}/${r.oldPayout} -> ${r.newStatus}/${r.newPayout}`);
  }

  if (!apply) {
    console.log('\n(dry run — no changes written. Re-run with --apply to save.)');
    return;
  }

  for (const f of predictionFixes) {
    const userData = wallet[f.username];
    if (f.oldStatus === 'correct') userData.points -= f.oldPayout;
    f.prediction.status = f.newStatus;
    f.prediction.payout = f.newPayout;
    if (f.newStatus === 'correct') userData.points += f.newPayout;
  }

  for (const f of legFixes) f.leg.status = f.newStatus;

  for (const r of stepRecalcs) {
    const userData = wallet[r.username];
    if (r.oldStatus === 'correct') userData.points -= r.oldPayout;
    r.step.status = r.newStatus;
    r.step.payout = r.newPayout;
    if (r.newStatus === 'correct') userData.points += r.newPayout;
  }

  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Fixed ${predictionFixes.length} prediction(s) and ${stepRecalcs.length} step prediction(s).`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
