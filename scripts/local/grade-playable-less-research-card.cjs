const fs = require("fs");
const path = require("path");
const https = require("https");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

const DATE = process.env.npm_config_date || process.env.DATE || new Date().toISOString().slice(0,10);

function getJson(url){
  return new Promise((resolve,reject)=>{
    https.get(url,res=>{
      let body="";
      res.on("data",d=>body+=d);
      res.on("end",()=>{
        try{ resolve(JSON.parse(body)); }
        catch(e){ reject(e); }
      });
    }).on("error",reject);
  });
}

function mlbDate(d){
  return d;
}

async function loadSchedule(date){
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${mlbDate(date)}&hydrate=team,linescore`;
  const data = await getJson(url);
  const games = [];
  for(const day of data.dates || []){
    for(const g of day.games || []) games.push(g);
  }
  return games;
}

async function loadBoxscore(gamePk){
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  return await getJson(url);
}

function normName(x){
  return s(x).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9 ]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

function sideResult(side,line,actual){
  const l=n(line), a=n(actual);
  if(l===null || a===null) return "UNMATCHED";
  if(side === "LESS"){
    if(a < l) return "HIT";
    if(a > l) return "MISS";
    return "PUSH";
  }
  if(side === "MORE"){
    if(a > l) return "HIT";
    if(a < l) return "MISS";
    return "PUSH";
  }
  return "UNMATCHED";
}

function hitterStats(ps){
  const b = ps?.stats?.batting || {};
  const singles = n(b.hits) - n(b.doubles) - n(b.triples) - n(b.homeRuns);
  const hits = n(b.hits) ?? 0;
  const doubles = n(b.doubles) ?? 0;
  const triples = n(b.triples) ?? 0;
  const hr = n(b.homeRuns) ?? 0;
  const runs = n(b.runs) ?? 0;
  const rbi = n(b.rbi) ?? 0;
  const walks = n(b.baseOnBalls) ?? 0;
  const hbp = n(b.hitByPitch) ?? 0;
  const sb = n(b.stolenBases) ?? 0;
  const bases = singles*1 + doubles*2 + triples*3 + hr*4;
  const hrr = hits + runs + rbi;
  const hfs = singles*3 + doubles*5 + triples*8 + hr*10 + runs*2 + rbi*2 + walks*2 + hbp*2 + sb*5;
  return {
    hits,
    singles,
    bases,
    hrr,
    runs,
    rbis:rbi,
    walks,
    home_runs:hr,
    hitter_fantasy_score:hfs
  };
}

function pitcherStats(ps){
  const p = ps?.stats?.pitching || {};
  const outs = n(p.outs) ?? 0;
  return {
    strikeouts:n(p.strikeOuts) ?? 0,
    pitching_outs:outs,
    hits_allowed:n(p.hits) ?? 0,
    earned_runs_allowed:n(p.earnedRuns) ?? 0,
    walks_allowed:n(p.baseOnBalls) ?? 0
  };
}

function probBucket(v){
  const x=n(v);
  if(x===null) return "prob_unknown";
  if(x>=0.85) return "prob_85_plus";
  if(x>=0.80) return "prob_80_84";
  if(x>=0.75) return "prob_75_79";
  if(x>=0.70) return "prob_70_74";
  if(x>=0.65) return "prob_65_69";
  if(x>=0.60) return "prob_60_64";
  return "prob_below_60";
}

function gapBucket(v){
  const x=n(v);
  if(x===null) return "gap_unknown";
  if(x>=2.0) return "gap_2_plus";
  if(x>=1.5) return "gap_1.5_1.99";
  if(x>=1.0) return "gap_1_1.49";
  if(x>=0.5) return "gap_0.5_0.99";
  return "gap_below_0.5";
}

function addAgg(map,key,row){
  map[key] ||= {
    key,
    count:0,
    graded:0,
    hit:0,
    miss:0,
    push:0,
    unmatched:0,
    hitRate:null,
    roiProxy:null,
    examples:[]
  };

  const g = map[key];
  g.count++;

  if(row.result === "HIT"){ g.hit++; g.graded++; }
  else if(row.result === "MISS"){ g.miss++; g.graded++; }
  else if(row.result === "PUSH"){ g.push++; }
  else g.unmatched++;

  if(g.examples.length < 12){
    g.examples.push({
      player:row.player,
      team:row.team,
      market:row.market,
      side:row.side,
      line:row.line,
      actual:row.actual,
      result:row.result,
      probability:row.probability,
      projection:row.projection,
      gap:row.gap,
      pfSignalMatchType:row.pfSignalMatchType
    });
  }
}

function finishAgg(obj){
  for(const g of Object.values(obj)){
    g.hitRate = g.graded ? +(g.hit/g.graded).toFixed(4) : null;
    g.roiProxy = g.graded ? +(((g.hit-g.miss)/g.graded)).toFixed(4) : null;
    if(g.graded < 5) g.action = "TRACK_ONLY_SMALL_SAMPLE";
    else if(g.hitRate >= 0.65 && g.roiProxy >= 0.25) g.action = "WATCH_BOOST";
    else if(g.hitRate <= 0.45 && g.roiProxy <= -0.10) g.action = "WATCH_SUPPRESS";
    else g.action = "NEUTRAL";
  }
  return Object.fromEntries(Object.entries(obj).sort((a,b)=>b[1].graded-a[1].graded || (b[1].hitRate??0)-(a[1].hitRate??0)));
}

async function main(){
  const card =
    read(`outputs/history/${DATE}-playable-less-research-card.json`) ||
    read("outputs/playable-less-research-card-latest.json");

  const rows = card?.candidates || [];
  const games = await loadSchedule(DATE);

  const playerIndex = {};
  const gameStatus = {};
  let finalGames = 0;

  for(const g of games){
    const gamePk = g.gamePk;
    const status = s(g.status?.abstractGameState || g.status?.detailedState);
    const isFinal = /final|completed/i.test(status);
    gameStatus[gamePk] = status;

    if(!isFinal) continue;
    finalGames++;

    const box = await loadBoxscore(gamePk);
    for(const side of ["home","away"]){
      const team = box.teams?.[side];
      const players = team?.players || {};
      for(const ps of Object.values(players)){
        const fullName = ps?.person?.fullName;
        if(!fullName) continue;
        const key = normName(fullName);
        playerIndex[key] ||= [];
        playerIndex[key].push({
          gamePk,
          team:team.team?.abbreviation || team.team?.triCode || "",
          name:fullName,
          hitter:hitterStats(ps),
          pitcher:pitcherStats(ps)
        });
      }
    }
  }

  const graded = [];

  for(const r of rows){
    const key = normName(r.player);
    const matches = playerIndex[key] || [];

    let actual = null;
    let matched = null;

    for(const m of matches){
      const family = r.family || "";
      if(family === "pitcher" && Object.prototype.hasOwnProperty.call(m.pitcher,r.market)){
        actual = m.pitcher[r.market];
        matched = m;
        break;
      }
      if(family === "hitter" && Object.prototype.hasOwnProperty.call(m.hitter,r.market)){
        actual = m.hitter[r.market];
        matched = m;
        break;
      }
      if(Object.prototype.hasOwnProperty.call(m.pitcher,r.market)){
        actual = m.pitcher[r.market];
        matched = m;
        break;
      }
      if(Object.prototype.hasOwnProperty.call(m.hitter,r.market)){
        actual = m.hitter[r.market];
        matched = m;
        break;
      }
    }

    const result = matched ? sideResult(r.side, r.line, actual) : "UNMATCHED";

    graded.push({
      ...r,
      actual,
      result,
      matchedName:matched?.name || null,
      matchedGamePk:matched?.gamePk || null
    });
  }

  const groups = {
    byMarket:{},
    byMarketLine:{},
    byPfMatch:{},
    byConfidence:{},
    byProb:{},
    byGap:{},
    byFamily:{}
  };

  for(const r of graded){
    addAgg(groups.byMarket,r.market,r);
    addAgg(groups.byMarketLine,`${r.market} ${r.line}`,r);
    addAgg(groups.byPfMatch,r.pfSignalMatchType || "unknown_pf",r);
    addAgg(groups.byConfidence,r.confidence || "unknown_conf",r);
    addAgg(groups.byProb,probBucket(r.probability),r);
    addAgg(groups.byGap,gapBucket(r.gap),r);
    addAgg(groups.byFamily,r.family || "unknown_family",r);
  }

  for(const k of Object.keys(groups)){
    groups[k] = finishAgg(groups[k]);
  }

  const summary = finishAgg({ playableLess: { key:"playableLess", count:0, graded:0, hit:0, miss:0, push:0, unmatched:0, hitRate:null, roiProxy:null, examples:[] } });
  const overall = { key:"playableLess", count:0, graded:0, hit:0, miss:0, push:0, unmatched:0, examples:[] };
  for(const r of graded) addAgg({ tmp: overall }, "tmp", r);
  finishAgg({ tmp: overall });

  const out = {
    date:DATE,
    generatedAt:new Date().toISOString(),
    finalGames,
    rowCount:graded.length,
    overall,
    rows:graded,
    groups
  };

  writeJson(`outputs/history/${DATE}-playable-less-research-card-graded.json`,out);
  writeJson("outputs/playable-less-research-card-graded-latest.json",out);

  const lines = [];
  lines.push(`PLAYABLE LESS RESEARCH CARD GRADED ${DATE}`);
  lines.push("=======================================");
  lines.push(`finalGames=${finalGames}`);
  lines.push(`rows=${graded.length}`);
  lines.push(`overall: graded=${overall.graded} hit=${overall.hit} miss=${overall.miss} push=${overall.push} unmatched=${overall.unmatched} hitRate=${overall.hitRate} roiProxy=${overall.roiProxy}`);
  lines.push("");

  function print(title,obj){
    lines.push(title);
    lines.push("-".repeat(title.length));
    for(const [k,g] of Object.entries(obj)){
      lines.push(`${k}: action=${g.action} graded=${g.graded} hit=${g.hit} miss=${g.miss} push=${g.push} unmatched=${g.unmatched} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
    }
    lines.push("");
  }

  print("BY MARKET",groups.byMarket);
  print("BY MARKET LINE",groups.byMarketLine);
  print("BY PF MATCH",groups.byPfMatch);
  print("BY CONFIDENCE",groups.byConfidence);
  print("BY PROB",groups.byProb);
  print("BY GAP",groups.byGap);
  print("BY FAMILY",groups.byFamily);

  lines.push("ROWS");
  lines.push("----");
  for(const [i,r] of graded.entries()){
    lines.push(`${i+1}. ${r.player} | ${r.team} | ${r.market.toUpperCase()} ${r.side} ${r.line} | actual=${r.actual} | result=${r.result} | prob=${r.probability} proj=${r.projection} gap=${r.gap} pf=${r.pfSignalMatchType || "NA"}`);
  }

  writeText(`outputs/history/${DATE}-playable-less-research-card-graded.txt`,lines.join("\n")+"\n");
  writeText("outputs/playable-less-research-card-graded-latest.txt",lines.join("\n")+"\n");

  console.log({
    date:DATE,
    finalGames,
    rows:graded.length,
    graded:overall.graded,
    hit:overall.hit,
    miss:overall.miss,
    push:overall.push,
    unmatched:overall.unmatched,
    hitRate:overall.hitRate
  });
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});
