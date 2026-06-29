// One-off cleanup for the daily-allowance refill bug: some players were
// re-granted today's allowance every time they spent to zero. This caps each
// player's UNSPENT money for today back to the correct daily total and records
// lastAllowanceAmount so the (fixed) server won't top them up again.
//
// Already-placed predictions are left untouched — this only trims leftover
// free money, it does not claw back stakes or winnings.
//
// IMPORTANT: deploy the server fix FIRST, then run this against the live DB:
//   MONGODB_URI=... node fixOvergrant.js            (dry run, shows changes)
//   MONGODB_URI=... node fixOvergrant.js --apply     (actually writes)
const storage = require('./storage');

const TODAY = '2026-06-29';   // UTC date the bug applied to
const TARGET = 300;            // correct total allowance for that day

const sumRemaining = (grants) => grants.reduce((s, g) => s + g.remaining, 0);

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();

  const changes = [];
  for (const [username, u] of Object.entries(wallet)) {
    if (u.lastAllowanceDate !== TODAY) continue;

    const grants = u.dailyGrants || [];
    const todayGrants = grants.filter((g) => g.grantedAt.slice(0, 10) === TODAY);
    const otherGrants = grants.filter((g) => g.grantedAt.slice(0, 10) !== TODAY);

    const todayRemaining = sumRemaining(todayGrants);
    const capped = Math.min(todayRemaining, TARGET);
    const before = sumRemaining(grants);

    const newGrants = [...otherGrants];
    if (capped > 0) {
      newGrants.push({ amount: capped, grantedAt: new Date().toISOString(), remaining: capped });
    }
    const after = sumRemaining(newGrants);

    if (before !== after) {
      changes.push({ username, before, after });
    }
    u.dailyGrants = newGrants;
    u.lastAllowanceAmount = TARGET;
  }

  if (changes.length) {
    console.log('Players with trimmed balance:');
    for (const c of changes) console.log(`  ${c.username}: ${c.before} -> ${c.after}`);
  } else {
    console.log('No over-granted balances found to trim.');
  }

  if (apply) {
    await storage.saveWallet(wallet);
    console.log(`\n✓ Applied. Normalized today's allowance for all of today's players.`);
  } else {
    console.log(`\n(dry run — no changes written. Re-run with --apply to save.)`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
