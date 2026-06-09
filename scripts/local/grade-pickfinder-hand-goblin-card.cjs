const fs = require("fs");
const path = require("path");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function norm(v){
  return s(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim()
    .replace(/\s+/g," ");
}

const DATE = process.env.npm_config_date || process.env.DATE || new Date().toISOString().slice(0,10);

function scoreBatting(b){
  const hits=n(b.hits)||0;
  const doubles=n(b.doubles)||0;
  const triples=n(b.triples)||0;
  const homeRuns=n(b.homeRuns)||0;
  const singles=Math.max(0,hits-doubles-triples-homeRuns);
  const runs=n(b.runs)||0;
  const rbis=n(b.rbi)||0;
  const walks=n(b.baseOnBalls)||0;
  const hbp=n(b.hitByPitch)||0;
  const stolenBases=n(b.stolenBases)||0;
  const strikeouts=n(b.strikeOuts)||0;

  return {
    hits,
    singles,
    doubles,
    triples,
    home_runs:homeRuns,
    runs,
    rbis,
    walks,
    hbp,
    stolen_bases:stolenBases,
    hitter_strikeouts:strikeouts,
    bases:singles + doubles*2 + triples*3 + homeRuns*4,
    total_bases:singles + doubles*2 + triples*3 + homeRuns*4,
    hrr:hits + runs + rbis,
    hitter_fantasy_score:
      singles*3 +
      doubles*5 +
      triples*8 +
      homeRuns*10 +
      runs*2 +
      rbis*2 +
      walks*2 +
      hbp*2 +
      stolenBases*5
  };
}

async function getJson(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.json();
}

function sideOf(row){
  const x=s(row.side).toUpperCase();
  if(x==="MORE" || x==="OVER") return "MORE";
  if(x==="LESS" || x==="UNDER") return "LESS";
  return "";
}

function grade(row, actual){
  const line=n(row.line);
  const side=sideOf(row);
  if(actual===null || actual===undefined || line===null || !side) return "UNMATCHED";
  if(side==="MORE") return actual>line ? "HIT" : actual<line ? "MISS" : "PUSH";
  if(side==="LESS") return actual<line ? "HIT" : actual>line ? "MISS" : "PUSH";
  return "UNMATCHED";
}

function trendBucket(v){
  const x=n(v);
  if(x===null) return "trend_unknown";
  if(x>=80) return "trend_80_plus";
  if(x>=70) return "trend_70_79";
  if(x>=60) return "trend_60_69";
  if(x>=55) return "trend_55_59";
  return "trend_below_55";
}

function orderBucket(v){
  const x=n(v);
  if(x===null) return "order_unknown";
  if(x<=2) return "order_1_2";
  if(x<=5) return "order_3_5";
  if(x<=9) return "order_6_9";
  return "order_other";
}

function addGroup(groups, key, row){
  groups[key] ||= {count:0,hit:0,miss:0,push:0,unmatched:0,graded:0,hitRate:null};
  const g=groups[key];
  g.count++;
  if(row.result==="HIT"){ g.hit++; g.graded++; }
  else if(row.result==="MISS"){ g.miss++; g.graded++; }
  else if(row.result==="PUSH"){ g.push++; }
  else g.unmatched++;
}

function finish(groups){
  for(const g of Object.values(groups)){
    g.hitRate = g.graded ? +(g.hit/g.graded).toFixed(4) : null;
  }
  return groups;
}

async function main(){
  const card =
    read(`outputs/history/${DATE}-pickfinder-hand-goblin-card.json`) ||
    read("outputs/pickfinder-hand-goblin-card.json");

  if(!card) throw new Error(`Missing PickFinder hand/goblin card for ${DATE}`);

  const rows=[];
  for(const [lane,obj] of Object.entries(card.lanes||{})){
    const arr=Array.isArray(obj) ? obj : [];
    for(const r of arr){
      rows.push({...r,lane});
    }
  }

  const schedule=await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}`);
  const games=(schedule.dates||[]).flatMap(d=>d.games||[]);
  const playerStats=new Map();

  for(const g of games){
    const box=await getJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
    for(const side of ["home","away"]){
      const team=box.teams?.[side]?.team?.abbreviation || "";
      const players=box.teams?.[side]?.players || {};
      for(const p of Object.values(players)){
        const name=p.person?.fullName || "";
        if(!name) continue;
        playerStats.set(norm(name),{
          player:name,
          gamePk:g.gamePk,
          team,
          batting:p.stats?.batting || {},
          score:scoreBatting(p.stats?.batting || {})
        });
      }
    }
  }

  const graded=rows.map(r=>{
    const st=playerStats.get(norm(r.player));
    const m=s(r.market);
    const actual=st ? st.score[m] : null;
    const result=grade(r,actual);
    return {
      ...r,
      actual,
      result,
      gamePk:st?.gamePk || null,
      mlbTeam:st?.team || "",
      scoring:st?.score || null,
      trendBucket:trendBucket(r.pfTrendAvg),
      orderBucket:orderBucket(r.pfBattingOrder)
    };
  });

  const groups={
    byLane:{},
    byMarket:{},
    byTier:{},
    byPlatoonEdge:{},
    byTrendBucket:{},
    byOrderBucket:{},
    byPfMatchType:{},
    byMarketPlatoon:{},
    byMarketTrend:{},
    byGoblinPlatoon:{}
  };

  for(const r of graded){
    addGroup(groups.byLane, r.lane || "unknown", r);
    addGroup(groups.byMarket, r.market || "unknown", r);
    addGroup(groups.byTier, r.tier || "unknown", r);
    addGroup(groups.byPlatoonEdge, r.platoonEdge || "unknown", r);
    addGroup(groups.byTrendBucket, r.trendBucket, r);
    addGroup(groups.byOrderBucket, r.orderBucket, r);
    addGroup(groups.byPfMatchType, r.pfSignalMatchType || "unknown", r);
    addGroup(groups.byMarketPlatoon, `${r.market||"unknown"}__${r.platoonEdge||"unknown"}`, r);
    addGroup(groups.byMarketTrend, `${r.market||"unknown"}__${r.trendBucket}`, r);
    if(String(r.tier||"").includes("goblin")){
      addGroup(groups.byGoblinPlatoon, `${r.market||"unknown"}__${r.platoonEdge||"unknown"}`, r);
    }
  }

  for(const k of Object.keys(groups)) finish(groups[k]);

  const out={
    date:DATE,
    gradedAt:new Date().toISOString(),
    sourceCard:card.generatedAt || null,
    rowCount:graded.length,
    groups,
    rows:graded
  };

  writeJson(`outputs/history/${DATE}-pickfinder-hand-goblin-graded.json`,out);
  writeJson("outputs/pickfinder-hand-goblin-graded-latest.json",out);

  const lines=[];
  lines.push(`PICKFINDER HAND + GOBLIN GRADED ${DATE}`);
  lines.push("======================================");
  lines.push(`rows=${graded.length}`);
  lines.push("");

  function printGroup(title,obj){
    lines.push(title);
    lines.push("-".repeat(title.length));
    const entries=Object.entries(obj)
      .sort((a,b)=>(b[1].graded-a[1].graded)||(b[1].hitRate??-1)-(a[1].hitRate??-1));
    for(const [k,v] of entries){
      lines.push(`${k}: count=${v.count} graded=${v.graded} hit=${v.hit} miss=${v.miss} push=${v.push} unmatched=${v.unmatched} hitRate=${v.hitRate}`);
    }
    lines.push("");
  }

  printGroup("BY LANE",groups.byLane);
  printGroup("BY MARKET",groups.byMarket);
  printGroup("BY TIER",groups.byTier);
  printGroup("BY PLATOON EDGE",groups.byPlatoonEdge);
  printGroup("BY TREND BUCKET",groups.byTrendBucket);
  printGroup("BY ORDER BUCKET",groups.byOrderBucket);
  printGroup("BY PF MATCH TYPE",groups.byPfMatchType);
  printGroup("BY GOBLIN MARKET + PLATOON",groups.byGoblinPlatoon);

  lines.push("GOBLIN MORE ROWS");
  lines.push("----------------");
  for(const r of graded.filter(x=>String(x.tier||"").includes("goblin")).slice(0,80)){
    lines.push(`${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | actual=${r.actual} | ${r.result} | hand=${r.matchupHand||""} | platoon=${r.platoonEdge||""} | trend=${r.pfTrendAvg} | order=${r.pfBattingOrder} | pf=${r.pfSignalMatchType}`);
  }

  writeText(`outputs/history/${DATE}-pickfinder-hand-goblin-graded.txt`,lines.join("\n")+"\n");
  writeText("outputs/pickfinder-hand-goblin-graded-latest.txt",lines.join("\n")+"\n");

  console.log({
    date:DATE,
    rows:graded.length,
    byLane:groups.byLane,
    byPlatoonEdge:groups.byPlatoonEdge,
    byTrendBucket:groups.byTrendBucket
  });
}

main().catch(e=>{console.error(e);process.exit(1);});
