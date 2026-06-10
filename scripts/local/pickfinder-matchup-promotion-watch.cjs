const fs = require("fs");
const path = require("path");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

const DATE = process.env.npm_config_date || process.env.DATE || new Date().toISOString().slice(0,10);

function dateFromFile(file){
  const m = file.match(/(\d{4}-\d{2}-\d{2})-pickfinder-hand-goblin-graded\.json$/);
  return m ? m[1] : "";
}

function orderBucket(v){
  const x=n(v);
  if(x===null) return "order_unknown";
  if(x<=2) return "order_1_2";
  if(x<=5) return "order_3_5";
  if(x<=9) return "order_6_9";
  return "order_other";
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

function isHitResult(r){
  return r.result === "HIT" || r.result === "MISS";
}

function addAgg(map, key, row, date){
  map[key] ||= {
    key,
    dates:{},
    count:0,
    graded:0,
    hit:0,
    miss:0,
    push:0,
    pending:0,
    unmatched:0,
    hitRate:null,
    roiProxy:null,
    examples:[]
  };

  const g=map[key];
  g.count++;
  g.dates[date] ||= {count:0,graded:0,hit:0,miss:0,pending:0,unmatched:0};
  g.dates[date].count++;

  if(row.result==="HIT"){
    g.hit++; g.graded++;
    g.dates[date].hit++; g.dates[date].graded++;
  } else if(row.result==="MISS"){
    g.miss++; g.graded++;
    g.dates[date].miss++; g.dates[date].graded++;
  } else if(row.result==="PUSH"){
    g.push++;
  } else if(row.result==="PENDING"){
    g.pending++;
    g.dates[date].pending++;
  } else {
    g.unmatched++;
    g.dates[date].unmatched++;
  }

  if(g.examples.length < 20){
    g.examples.push({
      date,
      player:row.player,
      team:row.team,
      market:row.market,
      side:row.side,
      line:row.line,
      tier:row.tier,
      result:row.result,
      actual:row.actual,
      platoonEdge:row.platoonEdge,
      matchupHand:row.matchupHand,
      pfTrendAvg:row.pfTrendAvg,
      pfBattingOrder:row.pfBattingOrder,
      pfSignalMatchType:row.pfSignalMatchType
    });
  }
}

function finishAgg(g){
  g.slateCount = Object.values(g.dates).filter(d => d.graded > 0).length;
  g.hitRate = g.graded ? +(g.hit/g.graded).toFixed(4) : null;
  g.roiProxy = g.graded ? +(((g.hit - g.miss) / g.graded)).toFixed(4) : null;
  return g;
}

function actionFor(g, kind){
  if(!g.graded) return "TRACK_ONLY_NO_GRADED_ROWS";
  if(g.slateCount < 3) return "TRACK_ONLY_NEEDS_3_SLATES";
  if(g.graded < 25) return "TRACK_ONLY_NEEDS_25_GRADED_ROWS";

  if(kind === "bad"){
    if(g.hitRate !== null && g.hitRate <= 0.45 && g.graded >= 15) return "SUPPRESS_BUCKET";
    return "WATCH_SUPPRESS";
  }

  if(kind === "promotion"){
    if(g.hitRate >= 0.68 && g.roiProxy >= 0.30) return "PROMOTION_CANDIDATE";
    if(g.hitRate >= 0.60) return "WATCH_BOOST";
    return "TRACK_ONLY";
  }

  if(g.hitRate <= 0.45 && g.graded >= 15) return "WATCH_SUPPRESS";
  if(g.hitRate >= 0.60 && g.graded >= 15) return "WATCH_BOOST";
  return "TRACK_ONLY";
}

function main(){
  const files = fs.existsSync("outputs/history")
    ? fs.readdirSync("outputs/history")
        .filter(f => /^\d{4}-\d{2}-\d{2}-pickfinder-hand-goblin-graded\.json$/.test(f))
        .map(f => path.join("outputs/history",f))
        .sort()
    : [];

  const rows = [];
  for(const file of files){
    const date = dateFromFile(file);
    const data = read(file);
    if(!data || !Array.isArray(data.rows)) continue;
    for(const r of data.rows){
      rows.push({...r, gradeDate:date});
    }
  }

  const buckets = {};
  const target = {};
  const bad = {};
  const market = {};
  const platoon = {};
  const order = {};
  const trend = {};

  for(const r of rows){
    const date = r.gradeDate || DATE;
    const tier = s(r.tier).toLowerCase();
    const m = s(r.market);
    const side = s(r.side).toUpperCase();
    const platoonEdge = s(r.platoonEdge) || "unknown";
    const ob = orderBucket(r.pfBattingOrder);
    const tb = trendBucket(r.pfTrendAvg);
    const matchType = s(r.pfSignalMatchType) || "unknown";

    addAgg(market, `${m} ${side}`, r, date);
    addAgg(platoon, platoonEdge, r, date);
    addAgg(order, ob, r, date);
    addAgg(trend, tb, r, date);
    addAgg(buckets, `${tier}__${m}__${side}__${platoonEdge}__${ob}__${tb}__${matchType}`, r, date);

    const isGoblin = tier.includes("goblin");
    const isTarget =
      isGoblin &&
      m === "hrr" &&
      side === "MORE" &&
      platoonEdge === "advantage" &&
      ob === "order_3_5";

    if(isTarget){
      addAgg(target, "GOBLIN_HRR_MORE_PLATOON_ADV_ORDER_3_5", r, date);
      addAgg(target, `GOBLIN_HRR_MORE_PLATOON_ADV_ORDER_3_5__${tb}`, r, date);
      addAgg(target, `GOBLIN_HRR_MORE_PLATOON_ADV_ORDER_3_5__${matchType}`, r, date);
    }

    const isBad =
      isGoblin &&
      (m === "bases" || m === "singles");

    if(isBad){
      addAgg(bad, `GOBLIN_${m.toUpperCase()}_${side}`, r, date);
      addAgg(bad, `GOBLIN_${m.toUpperCase()}_${side}__${platoonEdge}`, r, date);
    }
  }

  for(const obj of [buckets,target,bad,market,platoon,order,trend]){
    for(const g of Object.values(obj)) finishAgg(g);
  }

  const targetActions = {};
  for(const [k,g] of Object.entries(target)) targetActions[k] = actionFor(g,"promotion");

  const badActions = {};
  for(const [k,g] of Object.entries(bad)) badActions[k] = actionFor(g,"bad");

  const out = {
    date:DATE,
    generatedAt:new Date().toISOString(),
    sourceFiles:files,
    sourceFileCount:files.length,
    rowCount:rows.length,
    rules:{
      promotionTarget:"goblin HRR MORE + platoon advantage + batting order 3-5",
      promotionRequirement:"minimum 3 graded slates and 25 graded rows before official promotion",
      currentStatus:"research/watch only",
      badBucketWatch:"goblin bases/singles are watched for suppression"
    },
    target,
    targetActions,
    bad,
    badActions,
    summaries:{
      market,
      platoon,
      order,
      trend
    }
  };

  writeJson(`outputs/history/${DATE}-pickfinder-matchup-promotion-watch.json`,out);
  writeJson("outputs/pickfinder-matchup-promotion-watch-latest.json",out);

  const lines=[];
  lines.push(`PICKFINDER MATCHUP PROMOTION WATCH ${DATE}`);
  lines.push("=========================================");
  lines.push(`sourceFileCount=${files.length}`);
  lines.push(`rowCount=${rows.length}`);
  lines.push("");
  lines.push("PROMOTION TARGET");
  lines.push("----------------");
  lines.push("Goblin HRR MORE + platoon advantage + batting order 3-5");
  lines.push("Requires: 3+ graded slates and 25+ graded rows before official promotion.");
  lines.push("");

  for(const [k,g] of Object.entries(target)){
    lines.push(`${k}: action=${targetActions[k]} slates=${g.slateCount} graded=${g.graded} hit=${g.hit} miss=${g.miss} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
  }

  lines.push("");
  lines.push("BAD BUCKET WATCH");
  lines.push("----------------");
  for(const [k,g] of Object.entries(bad)){
    lines.push(`${k}: action=${badActions[k]} slates=${g.slateCount} graded=${g.graded} hit=${g.hit} miss=${g.miss} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
  }

  lines.push("");
  lines.push("MARKET SUMMARY");
  lines.push("--------------");
  for(const [k,g] of Object.entries(market).sort((a,b)=>b[1].graded-a[1].graded)){
    lines.push(`${k}: slates=${g.slateCount} graded=${g.graded} hit=${g.hit} miss=${g.miss} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
  }

  lines.push("");
  lines.push("PLATOON SUMMARY");
  lines.push("---------------");
  for(const [k,g] of Object.entries(platoon).sort((a,b)=>b[1].graded-a[1].graded)){
    lines.push(`${k}: slates=${g.slateCount} graded=${g.graded} hit=${g.hit} miss=${g.miss} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
  }

  lines.push("");
  lines.push("ORDER SUMMARY");
  lines.push("-------------");
  for(const [k,g] of Object.entries(order).sort((a,b)=>b[1].graded-a[1].graded)){
    lines.push(`${k}: slates=${g.slateCount} graded=${g.graded} hit=${g.hit} miss=${g.miss} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
  }

  writeText(`outputs/history/${DATE}-pickfinder-matchup-promotion-watch.txt`,lines.join("\n")+"\n");
  writeText("outputs/pickfinder-matchup-promotion-watch-latest.txt",lines.join("\n")+"\n");

  console.log({
    date:DATE,
    sourceFileCount:files.length,
    rowCount:rows.length,
    targetActions,
    badActions
  });
}

main();
