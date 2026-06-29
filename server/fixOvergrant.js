// Step 1 cleanup for the daily-allowance refill bug.
//
//   MONGODB_URI=... node fixOvergrant.js            (audit only, no writes)
//   MONGODB_URI=... node fixOvergrant.js --apply     (zero out leftover bug money)
//
// Rule: a player legitimately gets TARGET (300) per day. Anyone who has already
// staked >= TARGET today has used their full legitimate allowance, so any
// remaining balance is leftover bug money -> set their balance to 0.
// Players who staked MORE than TARGET (bet with bug money) are flagged but
// handled in a later step.
const storage = require('./storage');

const TODAY = '2026-06-29';   // UTC date the bug applied to
const TARGET = 300;            // correct daily allowance

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
    const isToday = u.lastAllowanceDate === TODAY || grants.some((g) => onDay(g.grantedAt, TODAY));
    if (!isToday) continue;

    const remaining = sumRemaining(grants);
    const staked = stakedOn(u, TODAY);
    const usedFullAllowance = staked >= TARGET;          // -> zero leftover now
    const overStaked = staked > TARGET;                  // -> handle later
    rows.push({ username, u, remaining, staked, effective: remaining + staked, usedFullAllowance, overStaked });
  }

  rows.sort((a, b) => b.effective - a.effective);
  console.log(`\nToday's players (${rows.length}) — TARGET ${TARGET}:`);
  console.log('  ' + 'username'.padEnd(22) + 'remaining  staked  effective  action');
  for (const r of rows) {
    const action = r.usedFullAllowance ? (r.remaining > 0 ? '-> set 0' : '') : '';
    const note = r.overStaked ? '  (over-staked, later)' : '';
    console.log(
      '  ' + r.username.padEnd(22) +
      String(r.remaining).padStart(9) + String(r.staked).padStart(8) +
      String(r.effective).padStart(11) + '  ' + action + note
    );
  }

  const toZero = rows.filter((r) => r.usedFullAllowance && r.remaining > 0);
  const removed = toZero.reduce((s, r) => s + r.remaining, 0);
  console.log(`\n${toZero.length} player(s) staked >= ${TARGET}; will zero ${removed} leftover coins.`);
  console.log(`${rows.filter((r) => r.overStaked).length} player(s) over-staked (>${TARGET}) — left for the next step.`);

  if (!apply) {
    console.log('\n(audit only — re-run with --apply to write.)');
    return;
  }

  for (const r of toZero) {
    r.u.dailyGrants = [];
    r.u.lastAllowanceDate = TODAY;
    r.u.lastAllowanceAmount = TARGET;
  }
  await storage.saveWallet(wallet);
  console.log(`\n✓ Applied. Zeroed leftover balance for ${toZero.length} player(s).`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
