// Quick admin view of every player's picks.
// Reads from MongoDB when MONGODB_URI is set, otherwise the local wallet.json.
// Usage:
//   node viewPlayers.js              -> all players
//   node viewPlayers.js <username>   -> one player
//   node viewPlayers.js --active     -> only players who picked something
//   MONGODB_URI=... node viewPlayers.js   -> view the live Render database
const storage = require('./storage');

const main = async () => {
await storage.init();
const wallet = await storage.getWallet();

const arg = process.argv[2];
const activeOnly = arg === '--active';
const onlyUser = arg && !arg.startsWith('--') ? arg : null;

const icon = (status) =>
  status === 'correct' ? '✓' : status === 'wrong' ? '✗' : '⏳';

const hasPicks = (d) =>
  (d.predictions && d.predictions.length) ||
  d.stepPrediction ||
  d.championPick ||
  (d.awardPicks && Object.keys(d.awardPicks).length);

let entries = Object.entries(wallet);
if (onlyUser) entries = entries.filter(([u]) => u.toLowerCase() === onlyUser.toLowerCase());
if (activeOnly) entries = entries.filter(([, d]) => hasPicks(d));
entries.sort((a, b) => (b[1].points || 0) - (a[1].points || 0));

if (entries.length === 0) {
  console.log('No players found.');
  process.exit(0);
}

console.log(`\n=== Players (${entries.length}) ===\n`);

for (const [username, d] of entries) {
  console.log(`👤 ${username}   —   ${d.points || 0} points`);

  const preds = d.predictions || [];
  if (preds.length) {
    console.log('  Match predictions:');
    for (const p of preds) {
      console.log(`    ${icon(p.status)} ${p.homeTeam} vs ${p.awayTeam} → ${p.outcome}  (stake ${p.stake ?? '-'}, payout ${p.payout ?? '-'})`);
    }
  }

  if (d.stepPrediction) {
    const s = d.stepPrediction;
    console.log(`  Step ${icon(s.status)} (stake ${s.stake}, x${s.combinedMultiplier?.toFixed?.(2) ?? s.combinedMultiplier}, payout ${s.payout ?? '-'}):`);
    for (const leg of s.legs) {
      console.log(`    ${icon(leg.status)} ${leg.homeTeam} vs ${leg.awayTeam} → ${leg.outcome}`);
    }
  }

  if (d.championPick) {
    const c = d.championPick;
    console.log(`  🏆 Champion: ${c.name} ${icon(c.status)} (points ${c.pointsAwarded ?? '-'})`);
  }

  if (d.awardPicks) {
    for (const [type, a] of Object.entries(d.awardPicks)) {
      console.log(`  ⚽ ${type}: ${a.playerName} ${icon(a.status)} (points ${a.pointsAwarded ?? '-'})`);
    }
  }

  if (!hasPicks(d)) console.log('  (no picks yet)');
  console.log('');
}
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
