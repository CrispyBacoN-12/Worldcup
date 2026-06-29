// Reset every player's points to 0. Does not touch balance, staked
// predictions, or bills — only the points field.
//
//   MONGODB_URI=... node resetAllPoints.js            (dry run, no writes)
//   MONGODB_URI=... node resetAllPoints.js --apply
const storage = require('./storage');

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();

  const rows = Object.entries(wallet)
    .map(([username, u]) => ({ username, points: u.points || 0 }))
    .filter((r) => r.points !== 0);

  console.log(`\n${rows.length} player(s) with non-zero points:`);
  console.log('  ' + 'username'.padEnd(22) + 'points');
  for (const r of rows) {
    console.log('  ' + r.username.padEnd(22) + String(r.points).padStart(6));
  }

  if (!apply) {
    console.log('\n(dry run — no changes written. Re-run with --apply to save.)');
    return;
  }

  for (const u of Object.values(wallet)) u.points = 0;
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Reset points to 0 for ${rows.length} player(s).`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
