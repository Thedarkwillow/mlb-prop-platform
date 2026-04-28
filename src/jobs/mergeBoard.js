import fs from 'fs';

const prizepicks = JSON.parse(fs.readFileSync('data/prizepicks-latest.json','utf8'));
const ballpark = JSON.parse(fs.readFileSync('data/ballpark-latest.json','utf8'));

function clean(v){return String(v??'').trim();}
function normName(v){
  return clean(v)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g,'')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function normTeam(v){return clean(v).toUpperCase().trim();}

function normalizeMarket(stat){
  const s = clean(stat).toLowerCase();
  if (s.includes('strikeout')) return 'strikeouts';
  if (s.includes('total bases')||s==='bases') return 'bases';
  if (s.includes('hits+runs+rbi')||s.includes('h+r+r')) return 'hrr';
  if (s==='hits'||s.includes('hits')) return 'hits';
  if (s.includes('home run')) return 'hr';
  if (s.includes('rbi')) return 'rbis';
  if (s==='runs'||s.includes('runs')) return 'runs';
  return null;
}

function projection(row, m){
  if(!row) return null;
  if(m==='hits') return row.hits;
  if(m==='bases') return row.bases;
  if(m==='hrr') return (row.hits??0)+(row.runs??0)+(row.rBIs??0);
  if(m==='hr') return row.homeRuns;
  if(m==='runs') return row.runs;
  if(m==='rbis') return row.rBIs;
  if(m==='strikeouts') return row.strikeouts;
  return null;
}

const bpIndex = new Map();
for(const r of ballpark){
  const key = `${normName(r.fullName)}|${normTeam(r.team)}`;
  bpIndex.set(key,r);
}

const merged = prizepicks.map(p=>{
  const player = p.player_name;
  const team = p.player_team;
  const market = normalizeMarket(p.stat||p.stat_short);

  const key = `${normName(player)}|${normTeam(team)}`;
  const bp = bpIndex.get(key)||null;

  const proj = projection(bp,market);
  const line = Number(p.line);
  const edge = (proj!=null && Number.isFinite(line))
    ? Number((proj-line).toFixed(3))
    : null;

  // confidence (simple starter)
  let confidence = 0;
  if(edge!==null){
    confidence += Math.min(Math.abs(edge),2);
  }
  if(bp){
    confidence += 1;
  }
  if(p.odds_tier==='standard'){
    confidence += 0.5;
  }

  return {
    recordType:'merged_prop',
    player,
    team,
    market,
    stat:p.stat,
    line,
    oddsTier:p.odds_tier,
    projection:proj,
    edge,
    confidence:Number(confidence.toFixed(3)),

    sourceType: bp?.recordType || null,

    game: bp
      ? `${clean(bp.team)} @ ${clean(bp.opponent)}`
      : `${p.away_team} @ ${p.home_team}`,

    gamePk: bp?.gamePk || null,
    startTime:p.game_start,

    ballpark:bp
  };
});

fs.mkdirSync('outputs',{recursive:true});
fs.writeFileSync('outputs/merged-board.json',JSON.stringify(merged,null,2));

console.log(`Merged rows: ${merged.length}`);
console.log(`Matched Ballpark rows: ${merged.filter(r=>r.ballpark).length}`);
console.log(`With projection: ${merged.filter(r=>r.projection!==null).length}`);
