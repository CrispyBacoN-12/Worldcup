// Cleanup for the daily-allowance bug (matches not played yet, so nothing is
// legitimately earned):
//   1. Clear ALL players' points to 0.
//   2. For players who over-staked (> TARGET today), wipe their predictions,
//      step prediction, and balance.
// Champion / Top Scorer picks are NOT touched.
//
//   MONGODB_URI=... node resetBugDamage.js            (dry run, no writes)
//   MONGODB_URI=... node resetBugDamage.js --apply
const storage = require('./storage');

const TODAY = '2026-06-29';
const TARGET = 300;

const totalStaked = (u) => {
  let t = 0;
  for (const p of u.predictions || []) if (typeof p.stake === 'number') t += p.stake;
  if (u.stepPrediction) t += u.stepPrediction.stake || 0;
  return t;
};
const balanceOf = (u) => (u.dailyGrants || []).reduce((s, g) => s + g.remaining, 0);

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();

  let pointsCleared = 0;
  let playersWithPoints = 0;
  const wiped = [];

  for (const [username, u] of Object.entries(wallet)) {
    if (u.points > 0) { pointsCleared += u.points; playersWithPoints++; }

    if (totalStaked(u) > TARGET) {
      wiped.push({
        username,
        staked: totalStaked(u),
        balance: balanceOf(u),
        preds: (u.predictions || []).length + (u.stepPrediction ? 1 : 0),
      });
    }
  }

  console.log(`\n1) Clear points: ${pointsCleared} total points from ${playersWithPoints} player(s) -> 0`);
  console.log(`\n2) Wipe bills + balance for ${wiped.length} over-staked player(s):`);
  console.log('  ' + 'username'.padEnd(22) + 'staked  balance  preds');
  for (const w of wiped) {
    console.log('  ' + w.username.padEnd(22) + String(w.staked).padStart(6) + String(w.balance).padStart(9) + String(w.preds).padStart(7));
  }

  if (!apply) {
    console.log('\n(dry run — no changes written. Re-run with --apply to save.)');
    return;
  }

  const wipedNames = new Set(wiped.map((w) => w.username));
  for (const [username, u] of Object.entries(wallet)) {
    u.points = 0;
    if (wipedNames.has(username)) {
      u.predictions = [];
      u.stepPrediction = null;
      u.dailyGrants = [];
      u.lastAllowanceDate = TODAY;
      u.lastAllowanceAmount = TARGET;
    }
  }
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Cleared points for all; wiped ${wiped.length} over-staked player(s).`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
