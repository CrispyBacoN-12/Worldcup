// One-off audit + cleanup for the daily-allowance refill bug: some players were
// re-granted today's allowance every time they spent to zero.
//
//   MONGODB_URI=... node fixOvergrant.js            (audit only, no writes)
//   MONGODB_URI=... node fixOvergrant.js --apply     (trim leftover excess money)
//
// The audit shows each of today's players:
//   remaining   = unspent allowance still in the wallet
//   stakedToday = money already placed on predictions today
//   effective   = remaining + stakedToday  (what they actually received today)
// effective > TARGET means they were over-granted. --apply trims the UNSPENT
// excess back to TARGET; money already staked on predictions is left as-is.
const storage = require('./storage');

const TODAY = '2026-06-29';   // UTC date the bug applied to
const TARGET = 300;            // correct total allowance for that day

const onDay = (iso, day) => typeof iso === 'string' && iso.slice(0, 10) === day;
const sumRemaining = (grants) => grants.reduce((s, g) => s + g.remaining, 0);

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

  const rows = [];
  for (const [username, u] of Object.entries(wallet)) {
    const grants = u.dailyGrants || [];
    const todayGrants = grants.filter((g) => onDay(g.grantedAt, TODAY));
    const isToday = u.lastAllowanceDate === TODAY || todayGrants.length > 0;
    if (!isToday) continue;

    const remaining = sumRemaining(todayGrants);
    const staked = stakedOn(u, TODAY);
    const effective = remaining + staked;
    rows.push({ username, remaining, staked, effective, over: effective > TARGET });
  }

  rows.sort((a, b) => b.effective - a.effective);
  console.log(`\nToday's players (${rows.length}) — TARGET ${TARGET}:`);
  console.log('  username'.padEnd(24) + 'remaining  staked  effective  flag');
  for (const r of rows) {
    console.log(
      '  ' + r.username.padEnd(22) +
      String(r.remaining).padStart(9) + String(r.staked).padStart(8) +
      String(r.effective).padStart(11) + (r.over ? '   OVER' : '')
    );
  }
  const overCount = rows.filter((r) => r.over).length;
  console.log(`\n${overCount} player(s) received more than ${TARGET} today.`);

  if (!apply) {
    console.log('(audit only — re-run with --apply to trim unspent excess.)');
    return;
  }

  // Apply: cap unspent today-money to TARGET, leave staked predictions untouched.
  let trimmed = 0;
  for (const [username, u] of Object.entries(wallet)) {
    const grants = u.dailyGrants || [];
    const todayGrants = grants.filter((g) => onDay(g.grantedAt, TODAY));
    const isToday = u.lastAllowanceDate === TODAY || todayGrants.length > 0;
    if (!isToday) continue;

    const otherGrants = grants.filter((g) => !onDay(g.grantedAt, TODAY));
    const capped = Math.min(sumRemaining(todayGrants), TARGET);
    const newGrants = [...otherGrants];
    if (capped > 0) newGrants.push({ amount: capped, grantedAt: new Date().toISOString(), remaining: capped });
    if (sumRemaining(grants) !== sumRemaining(newGrants)) trimmed++;
    u.dailyGrants = newGrants;
    u.lastAllowanceDate = TODAY;
    u.lastAllowanceAmount = TARGET;
  }
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Trimmed unspent excess for ${trimmed} player(s); normalized all of today's players.`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
