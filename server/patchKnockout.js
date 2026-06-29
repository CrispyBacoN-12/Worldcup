// Patch LAST_32 teams into both fixtures.json files
// Source: Yahoo Sports / Wikipedia Round of 32 results
const fs = require('fs');
const path = require('path');

// Team lookup built from group stage data already in the file
const TEAMS = {
  canada:       { id: 828,  name: 'Canada',           shortName: 'Canada',       crest: 'https://crests.football-data.org/canada.svg' },
  southAfrica:  { id: 774,  name: 'South Africa',     shortName: 'South Africa', crest: 'https://crests.football-data.org/9396.svg' },
  brazil:       { id: 764,  name: 'Brazil',            shortName: 'Brazil',       crest: 'https://crests.football-data.org/764.svg' },
  japan:        { id: 766,  name: 'Japan',             shortName: 'Japan',        crest: 'https://crests.football-data.org/766.svg' },
  germany:      { id: 759,  name: 'Germany',           shortName: 'Germany',      crest: 'https://crests.football-data.org/759.svg' },
  paraguay:     { id: 761,  name: 'Paraguay',          shortName: 'Paraguay',     crest: 'https://crests.football-data.org/761.svg' },
  netherlands:  { id: 8601, name: 'Netherlands',       shortName: 'Netherlands',  crest: 'https://crests.football-data.org/8601.svg' },
  morocco:      { id: 815,  name: 'Morocco',           shortName: 'Morocco',      crest: 'https://crests.football-data.org/morocco.svg' },
  ivoryCost:    { id: 1935, name: 'Ivory Coast',       shortName: 'Ivory Coast',  crest: 'https://crests.football-data.org/787.svg' },
  norway:       { id: 8872, name: 'Norway',            shortName: 'Norway',       crest: 'https://crests.football-data.org/813.svg' },
  france:       { id: 773,  name: 'France',            shortName: 'France',       crest: 'https://crests.football-data.org/773.svg' },
  sweden:       { id: 792,  name: 'Sweden',            shortName: 'Sweden',       crest: 'https://crests.football-data.org/792.svg' },
  mexico:       { id: 769,  name: 'Mexico',            shortName: 'Mexico',       crest: 'https://crests.football-data.org/769.svg' },
  ecuador:      { id: 791,  name: 'Ecuador',           shortName: 'Ecuador',      crest: 'https://crests.football-data.org/791.svg' },
  england:      { id: 770,  name: 'England',           shortName: 'England',      crest: 'https://crests.football-data.org/770.svg' },
  congoDR:      { id: 1934, name: 'Congo DR',          shortName: 'Congo DR',     crest: 'https://crests.football-data.org/congo_dr.svg' },
  belgium:      { id: 805,  name: 'Belgium',           shortName: 'Belgium',      crest: 'https://crests.football-data.org/805.svg' },
  senegal:      { id: 804,  name: 'Senegal',           shortName: 'Senegal',      crest: 'https://crests.football-data.org/senegal.svg' },
  usa:          { id: 771,  name: 'United States',     shortName: 'USA',          crest: 'https://crests.football-data.org/usa.svg' },
  bosnia:       { id: 1060, name: 'Bosnia-Herzegovina',shortName: 'Bosnia-H.',   crest: 'https://crests.football-data.org/bosnia.svg' },
  spain:        { id: 760,  name: 'Spain',             shortName: 'Spain',        crest: 'https://crests.football-data.org/760.svg' },
  austria:      { id: 816,  name: 'Austria',           shortName: 'Austria',      crest: 'https://crests.football-data.org/816.svg' },
  portugal:     { id: 765,  name: 'Portugal',          shortName: 'Portugal',     crest: 'https://crests.football-data.org/765.svg' },
  croatia:      { id: 799,  name: 'Croatia',           shortName: 'Croatia',      crest: 'https://crests.football-data.org/799.svg' },
  switzerland:  { id: 788,  name: 'Switzerland',       shortName: 'Switzerland',  crest: 'https://crests.football-data.org/788.svg' },
  algeria:      { id: 778,  name: 'Algeria',           shortName: 'Algeria',      crest: 'https://crests.football-data.org/algeria.svg' },
  australia:    { id: 779,  name: 'Australia',         shortName: 'Australia',    crest: 'https://crests.football-data.org/779.svg' },
  egypt:        { id: 825,  name: 'Egypt',             shortName: 'Egypt',        crest: 'https://crests.football-data.org/825.svg' },
  argentina:    { id: 762,  name: 'Argentina',         shortName: 'Argentina',    crest: 'https://crests.football-data.org/762.png' },
  capeVerde:    { id: 1930, name: 'Cape Verde Islands',shortName: 'Cape Verde',   crest: 'https://crests.football-data.org/cape_verde.svg' },
  colombia:     { id: 818,  name: 'Colombia',          shortName: 'Colombia',     crest: 'https://crests.football-data.org/818.svg' },
  ghana:        { id: 763,  name: 'Ghana',             shortName: 'Ghana',        crest: 'https://crests.football-data.org/ghana.svg' },
};

// fixture id → [homeTeam, awayTeam]
// Ordered by UTC kickoff time; source: Yahoo Sports schedule
const PATCHES = {
  537417: ['canada',      'southAfrica'],  // Jun 28 19:00 UTC
  537423: ['brazil',      'japan'],        // Jun 29 17:00 UTC
  537415: ['germany',     'paraguay'],     // Jun 29 20:30 UTC
  537418: ['netherlands', 'morocco'],      // Jun 30 01:00 UTC
  537424: ['ivoryCost',   'norway'],       // Jun 30 17:00 UTC
  537416: ['france',      'sweden'],       // Jun 30 21:00 UTC
  537425: ['mexico',      'ecuador'],      // Jul 01 01:00 UTC
  537426: ['england',     'congoDR'],      // Jul 01 16:00 UTC
  537422: ['belgium',     'senegal'],      // Jul 01 20:00 UTC
  537421: ['usa',         'bosnia'],       // Jul 02 00:00 UTC
  537420: ['spain',       'austria'],      // Jul 02 19:00 UTC
  537419: ['portugal',    'croatia'],      // Jul 02 23:00 UTC
  537429: ['switzerland', 'algeria'],      // Jul 03 03:00 UTC
  537428: ['australia',   'egypt'],        // Jul 03 18:00 UTC
  537427: ['argentina',   'capeVerde'],    // Jul 03 22:00 UTC
  537430: ['colombia',    'ghana'],        // Jul 04 01:30 UTC
};

function patchFile(filePath) {
  const fixtures = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = 0;
  for (const f of fixtures) {
    if (!PATCHES[f.id]) continue;
    const [homeKey, awayKey] = PATCHES[f.id];
    f.homeTeam = { ...TEAMS[homeKey] };
    f.awayTeam = { ...TEAMS[awayKey] };
    console.log(`  [${f.id}] ${f.stage} ${f.utcDate.slice(0,10)}: ${f.homeTeam.name} vs ${f.awayTeam.name}`);
    changed++;
  }
  fs.writeFileSync(filePath, JSON.stringify(fixtures, null, 2));
  console.log(`  → saved ${changed} patches to ${path.basename(filePath)}\n`);
}

const files = [
  path.join(__dirname, '..', 'src', 'data', 'fixtures.json'),
  path.join(__dirname, 'data', 'fixtures.json'),
];

for (const f of files) {
  console.log(`Patching ${f}`);
  patchFile(f);
}

console.log('Done!');
