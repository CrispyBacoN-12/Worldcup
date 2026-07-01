// Reduce all pending prediction stakes for 6701185 to 100 each.
// Total staked was 600 (rolled over from June 29 + June 30 grants, a bug).
// Correcting to 100 per bet = 400 total, matching the 4-match daily limit.
//
//   MONGODB_URI=... node fix6701185Stakes.js            (dry run)
//   MONGODB_URI=... node fix6701185Stakes.js --apply
const nodePath = require('path');
try { process.loadEnvFile(nodePath.join(__dirname, '.env')); } catch {}
const storage = require('./storage');

const TARGET_USER = '6701185';
const NEW_STAKE = 100;

const main = async () => {
  const apply = process.argv.includes('--apply');
  await storage.init();
  const wallet = await storage.getWallet();
  const u = wallet[TARGET_USER];
  if (!u) { console.log('User not found'); return; }

  const pending = (u.predictions || []).filter(p => p.status === 'pending' && p.stake != null);

  console.log(`\n${TARGET_USER} — ${pending.length} pending prediction(s):`);
  console.log('  ' + 'matchId'.padEnd(10) + 'outcome'.padEnd(8) + 'old stake'.padStart(10) + ' -> ' + 'new stake'.padStart(9));
  for (const p of pending) {
    console.log('  ' + String(p.matchId).padEnd(10) + p.outcome.padEnd(8) + String(p.stake).padStart(10) + ' -> ' + String(NEW_STAKE).padStart(9));
  }
  console.log(`\n  total staked: ${pending.reduce((s,p)=>s+p.stake,0)} -> ${pending.length * NEW_STAKE}`);

  if (!apply) {
    console.log('\n(dry run — re-run with --apply to save.)');
    return;
  }

  for (const p of pending) p.stake = NEW_STAKE;
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Set stake=100 on ${pending.length} prediction(s) for ${TARGET_USER}.`);
};

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
