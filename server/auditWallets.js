// Read-only audit of every wallet: points, available balance, total staked,
// and prediction counts. Helps see how much "bug money" ended up as points or
// as placed bets. Writes nothing.
//
//   MONGODB_URI=... node auditWallets.js
const storage = require('./storage');

const sumRemaining = (grants) => (grants || []).reduce((s, g) => s + g.remaining, 0);
const totalStaked = (u) => {
  let t = 0;
  for (const p of u.predictions || []) if (typeof p.stake === 'number') t += p.stake;
  if (u.stepPrediction) t += u.stepPrediction.stake || 0;
  return t;
};

const main = async () => {
  await storage.init();
  const wallet = await storage.getWallet();

  const rows = Object.entries(wallet).map(([username, u]) => ({
    username,
    points: u.points || 0,
    balance: sumRemaining(u.dailyGrants),
    staked: totalStaked(u),
    preds: (u.predictions || []).length + (u.stepPrediction ? 1 : 0),
    lastDate: u.lastAllowanceDate || '-',
  }));

  rows.sort((a, b) => (b.points + b.balance + b.staked) - (a.points + a.balance + a.staked));

  console.log('\n' + 'username'.padEnd(22) + 'points'.padStart(8) + 'balance'.padStart(9) +
    'staked'.padStart(8) + 'preds'.padStart(7) + '  lastAllowanceDate');
  let tp = 0, tb = 0, ts = 0;
  for (const r of rows) {
    tp += r.points; tb += r.balance; ts += r.staked;
    console.log(
      r.username.padEnd(22) +
      String(r.points).padStart(8) + String(r.balance).padStart(9) +
      String(r.staked).padStart(8) + String(r.preds).padStart(7) +
      '  ' + r.lastDate
    );
  }
  console.log('\n' + `players: ${rows.length} | total points: ${tp} | total balance: ${tb} | total staked: ${ts}`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
