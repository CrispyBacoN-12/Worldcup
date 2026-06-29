// Step 2 cleanup for the daily-allowance refill bug.
//
//   MONGODB_URI=... node fixOvergrant2.js            (audit only, no writes)
//   MONGODB_URI=... node fixOvergrant2.js --apply     (write changes)
//
// Two groups, both today (TODAY):
//   A) Over-staked players (staked > TARGET=300): full reset — wipe their
//      predictions, stepPrediction and dailyGrants, then re-grant exactly
//      TARGET (300) so they can re-bet clean. (the "7 คน")
//   B) The one player sitting on a leftover balance of 400 with nothing
//      staked: not reset, just cut their balance down to 100.
const storage = require('./storage');

const TODAY = '2026-06-29';
const TARGET = 300;
const LEFTOVER_BALANCE = 400;   // group B trigger: balance sitting at this amount
const LEFTOVER_CUT_TO = 100;    // group B target: cut balance down to this amount

const onDay = (iso, day) => typeof iso === 'string' && iso.slice(0, 10) === day;
const sumRemaining = (grants) => (grants || []).reduce((s, g) => s + g.remaining, 0);

const stakedOn = (u, day) => {
  let total = 0;
  for (const p of u.predictions || []) {
    if (onDay(p.placedAt, day) && typeof p.stake === 'number') total += p.stake;
  }
  if (u.stepPrediction && onDay(u.stepPrediction.placedAt, day)) {
    total += u.stepPrediction.stake || 0;
  }
  return total;
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();

  const groupA = [];
  const groupB = [];

  for (const [username, u] of Object.entries(wallet)) {
    const remaining = sumRemaining(u.dailyGrants);
    const staked = stakedOn(u, TODAY);

    if (staked > TARGET) {
      groupA.push({ username, u, remaining, staked });
    } else if (staked === 0 && remaining === LEFTOVER_BALANCE) {
      groupB.push({ username, u, remaining, staked });
    }
  }

  console.log(`\nGroup A — over-staked (>${TARGET}), full reset + re-grant ${TARGET}: ${groupA.length} player(s)`);
  console.log('  ' + 'username'.padEnd(22) + 'remaining  staked');
  for (const r of groupA) {
    console.log('  ' + r.username.padEnd(22) + String(r.remaining).padStart(9) + String(r.staked).padStart(8));
  }

  console.log(`\nGroup B — leftover balance ${LEFTOVER_BALANCE}, cut to ${LEFTOVER_CUT_TO}: ${groupB.length} player(s)`);
  console.log('  ' + 'username'.padEnd(22) + 'remaining  staked');
  for (const r of groupB) {
    console.log('  ' + r.username.padEnd(22) + String(r.remaining).padStart(9) + String(r.staked).padStart(8));
  }

  if (!apply) {
    console.log('\n(audit only — re-run with --apply to write.)');
    return;
  }

  for (const r of groupA) {
    r.u.predictions = [];
    r.u.stepPrediction = null;
    r.u.dailyGrants = [{ amount: TARGET, grantedAt: new Date().toISOString(), remaining: TARGET }];
    r.u.lastAllowanceDate = TODAY;
    r.u.lastAllowanceAmount = TARGET;
  }
  for (const r of groupB) {
    r.u.dailyGrants = [{ amount: LEFTOVER_CUT_TO, grantedAt: new Date().toISOString(), remaining: LEFTOVER_CUT_TO }];
    r.u.lastAllowanceDate = TODAY;
    r.u.lastAllowanceAmount = LEFTOVER_CUT_TO;
  }
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Reset ${groupA.length} over-staked player(s) to ${TARGET}; cut ${groupB.length} leftover player(s) to ${LEFTOVER_CUT_TO}.`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
