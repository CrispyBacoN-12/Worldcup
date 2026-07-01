// Set every player's available balance (dailyGrants) to exactly 300.
// Replaces whatever grants they currently have with one grant of 300 for
// today (Thailand calendar day). Does not touch points, predictions, or
// step predictions.
//
//   MONGODB_URI=... node setAllBalanceTo300.js            (dry run, no writes)
//   MONGODB_URI=... node setAllBalanceTo300.js --apply
const storage = require('./storage');

const TARGET = 300;
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
const todayThai = () => new Date(Date.now() + THAI_OFFSET_MS).toISOString().slice(0, 10);

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();
  const today = todayThai();

  const rows = Object.entries(wallet)
    .map(([username, u]) => ({
      username,
      u,
      current: (u.dailyGrants || []).reduce((s, g) => s + g.remaining, 0),
    }))
    .filter((r) => r.current !== TARGET);

  console.log(`\nToday (Thai): ${today}`);
  console.log(`${rows.length} player(s) with balance != ${TARGET}:`);
  console.log('  ' + 'username'.padEnd(22) + 'current -> new');
  for (const r of rows) {
    console.log('  ' + r.username.padEnd(22) + String(r.current).padStart(7) + ' -> ' + TARGET);
  }

  if (!apply) {
    console.log('\n(dry run — no changes written. Re-run with --apply to save.)');
    return;
  }

  for (const r of rows) {
    r.u.dailyGrants = [{ amount: TARGET, grantedAt: new Date().toISOString(), remaining: TARGET }];
    r.u.lastAllowanceDate = today;
    r.u.lastAllowanceAmount = TARGET;
  }
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Set balance to ${TARGET} for ${rows.length} player(s).`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
