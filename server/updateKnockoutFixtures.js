#!/usr/bin/env node
// Run: FOOTBALL_API_KEY=your_key node server/updateKnockoutFixtures.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {}

const API_KEY = process.env.FOOTBALL_API_KEY;
if (!API_KEY) {
  console.error('Missing FOOTBALL_API_KEY env var');
  process.exit(1);
}

const SRC_FIXTURES = path.join(__dirname, '..', 'src', 'data', 'fixtures.json');
const SERVER_FIXTURES = path.join(__dirname, 'data', 'fixtures.json');

const pick = (team) => team
  ? { id: team.id ?? null, name: team.name ?? null, shortName: team.shortName ?? null, crest: team.crest ?? null }
  : { id: null, name: null, shortName: null, crest: null };

async function fetchAllMatches() {
  const url = 'https://api.football-data.org/v4/competitions/WC/matches?season=2026';
  console.log('Fetching from football-data.org...');
  const res = await axios.get(url, { headers: { 'X-Auth-Token': API_KEY } });
  return res.data.matches;
}

async function main() {
  const apiMatches = await fetchAllMatches();
  console.log(`Fetched ${apiMatches.length} matches from API`);

  // Build lookup by match id
  const byId = {};
  for (const m of apiMatches) byId[m.id] = m;

  let updatedCount = 0;

  function updateFile(filePath) {
    const fixtures = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let changed = 0;

    for (const fixture of fixtures) {
      if (fixture.stage === 'GROUP_STAGE') continue;
      const live = byId[fixture.id];
      if (!live) continue;

      const homeOld = fixture.homeTeam.name;
      const awayOld = fixture.awayTeam.name;
      const homeNew = live.homeTeam?.name ?? null;
      const awayNew = live.awayTeam?.name ?? null;

      if (homeNew !== homeOld || awayNew !== awayOld) {
        fixture.homeTeam = pick(live.homeTeam);
        fixture.awayTeam = pick(live.awayTeam);
        console.log(`  [${fixture.id}] ${fixture.stage} ${fixture.utcDate.slice(0, 10)}: ${homeNew} vs ${awayNew}`);
        changed++;
      }
    }

    if (changed > 0) {
      fs.writeFileSync(filePath, JSON.stringify(fixtures, null, 2));
      console.log(`Updated ${changed} matches in ${path.basename(filePath)}`);
    } else {
      console.log(`No changes needed in ${path.basename(filePath)}`);
    }
    return changed;
  }

  updatedCount += updateFile(SRC_FIXTURES);
  updatedCount += updateFile(SERVER_FIXTURES);

  console.log(`\nDone. Total fields updated across both files: ${updatedCount}`);
}

main().catch((err) => {
  console.error('Error:', err.response?.data ?? err.message);
  process.exit(1);
});
