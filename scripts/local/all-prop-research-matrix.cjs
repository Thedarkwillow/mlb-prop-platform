const fs = require("fs");
const path = require("path");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

const DATE = process.env.npm_config_date || process.env.DATE || new Date().toISOString().slice(0,10);

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

function lineBucket(market, line){
  const x=n(line);
  if(x===null) return "line_unknown";

  if(market === "hrr"){
    if(x <= 0.5) return "hrr_0.5";
    if(x <= 1.5) return "hrr_1.5";
    if(x <= 2.5) return "hrr_2.5";
    return "hrr_3.5_plus";
  }

  if(market === "hitter_fantasy_score"){
    if(x <= 2.5) return "hfs_2.5_or_less";
    if(x <= 5.5) return "hfs_3_to_5.5";
    if(x <= 8.5) return "hfs_6_to_8.5";
    return "hfs_9_plus";
  }

  if(market === "bases" || market === "total_bases"){
    if(x <= 0.5) return "bases_0.5";
    if(x <= 1.5) return "bases_1.5";
    return "bases_2.5_plus";
  }

  if(market === "hits" || market === "singles"){
    if(x <= 0.5) return `${market}_0.5`;
    if(x <= 1.5) return `${market}_1.5`;
    return `${market}_2_plus`;
  }

  if(market.includes("strikeout")){
    if(x <= 3.5) return "k_3.5_or_less";
    if(x <= 5.5) return "k_4_to_5.5";
    if(x <= 7.5) return "k_6_to_7.5";
    return "k_8_plus";
  }

  if(market.includes("walk")){
    if(x <= 0.5) return "walk_0.5";
    if(x <= 1.5) return "walk_1.5";
    return "walk_2_plus";
  }

  return `line_${x}`;
}

function addGroup(map, key, row){
  map[key] ||= {
    key,
    count:0,
    graded:0,
    hit:0,
    miss:0,
    push:0,
    pending:0,
    unmatched:0,
    hitRate:null,
    roiProxy:null,
    action:null,
    examples:[]
  };
  const g=map[key];
  g.count++;

  if(row.result==="HIT"){ g.hit++; g.graded++; }
  else if(row.result==="MISS"){ g.miss++; g.graded++; }
  else if(row.result==="PUSH"){ g.push++; }
  else if(row.result==="PENDING"){ g.pending++; }
  else g.unmatched++;

  if(g.examples.length < 12){
    g.examples.push({
      player:row.player,
      team:row.team,
      market:row.market,
      side:row.side,
      tier:row.tier,
      line:row.line,
      actual:row.actual,
      result:row.result,
      pfTrendAvg:row.pfTrendAvg,
      pfBattingOrder:row.pfBattingOrder,
      platoonEdge:row.platoonEdge,
      pfSignalMatchType:row.pfSignalMatchType
    });
  }
}

function finish(map){
  for(const g of Object.values(map)){
    g.hitRate = g.graded ? +(g.hit/g.graded).toFixed(4) : null;
    g.roiProxy = g.graded ? +(((g.hit-g.miss)/g.graded)).toFixed(4) : null;

    if(g.graded < 10) g.action = "TRACK_ONLY_SMALL_SAMPLE";
    else if(g.hitRate >= 0.65 && g.roiProxy >= 0.25) g.action = "WATCH_BOOST";
    else if(g.hitRate <= 0.45 && g.roiProxy <= -0.10) g.action = "WATCH_SUPPRESS";
    else g.action = "NEUTRAL";
  }
  return map;
}

function sortGroups(obj){
  return Object.fromEntries(
    Object.entries(obj).sort((a,b)=>
      (b[1].graded-a[1].graded) ||
      ((b[1].hitRate ?? -1)-(a[1].hitRate ?? -1))
    )
  );
}

function main(){
  const pf = read(`outputs/history/${DATE}-pickfinder-hand-goblin-graded.json`) ||
             read("outputs/pickfinder-hand-goblin-graded-latest.json");

  const research = read(`outputs/history/${DATE}-research-lanes-graded.json`) ||
                   read("outputs/research-lanes-graded-latest.json");

  const rows = [];

  if(pf?.rows && Array.isArray(pf.rows)){
    for(const r of pf.rows){
      rows.push({
        ...r,
        sourceLane:`pf_matchup:${r.lane || "unknown"}`
      });
    }
  }

  if(research?.rows && Array.isArray(research.rows)){
    for(const r of research.rows){
      rows.push({
        ...r,
        sourceLane:`research:${r.lane || r.source || "unknown"}`
      });
    }
  }

  const groups = {
    bySourceLane:{},
    byMarket:{},
    byMarketSide:{},
    byMarketSideTier:{},
    byMarketSideLine:{},
    byTier:{},
    bySide:{},
    byPlatoon:{},
    byOrder:{},
    byTrend:{},
    byPfMatchType:{},
    byCombo:{},
    bySuppressionCandidates:{},
    byBoostCandidates:{}
  };

  for(const r of rows){
    const market = s(r.market) || "unknown_market";
    const side = s(r.side).toUpperCase() || "unknown_side";
    const tier = s(r.tier).toLowerCase() || "unknown_tier";
    const platoon = s(r.platoonEdge) || "unknown_platoon";
    const ob = orderBucket(r.pfBattingOrder);
    const tb = trendBucket(r.pfTrendAvg);
    const lb = lineBucket(market, r.line);
    const pfm = s(r.pfSignalMatchType) || "unknown_pf_match";
    const lane = s(r.sourceLane) || "unknown_lane";

    addGroup(groups.bySourceLane, lane, r);
    addGroup(groups.byMarket, market, r);
    addGroup(groups.byMarketSide, `${market} ${side}`, r);
    addGroup(groups.byMarketSideTier, `${market} ${side} ${tier}`, r);
    addGroup(groups.byMarketSideLine, `${market} ${side} ${lb}`, r);
    addGroup(groups.byTier, tier, r);
    addGroup(groups.bySide, side, r);
    addGroup(groups.byPlatoon, platoon, r);
    addGroup(groups.byOrder, ob, r);
    addGroup(groups.byTrend, tb, r);
    addGroup(groups.byPfMatchType, pfm, r);
    addGroup(groups.byCombo, `${tier} | ${market} ${side} | ${lb} | ${platoon} | ${ob} | ${tb} | ${pfm}`, r);
  }

  for(const k of Object.keys(groups)){
    finish(groups[k]);
    groups[k] = sortGroups(groups[k]);
  }

  for(const [k,g] of Object.entries(groups.byCombo)){
    if(g.action === "WATCH_SUPPRESS") groups.bySuppressionCandidates[k] = g;
    if(g.action === "WATCH_BOOST") groups.byBoostCandidates[k] = g;
  }

  const out = {
    date:DATE,
    generatedAt:new Date().toISOString(),
    rowCount:rows.length,
    gradedCount:rows.filter(r=>r.result==="HIT"||r.result==="MISS").length,
    rules:{
      actionNote:"WATCH_BOOST/WATCH_SUPPRESS require at least 10 graded rows in this single-day matrix. Multi-day promotion still requires separate promotion watch.",
      officialStatus:"research only"
    },
    groups
  };

  writeJson(`outputs/history/${DATE}-all-prop-research-matrix.json`,out);
  writeJson("outputs/all-prop-research-matrix-latest.json",out);

  const lines=[];
  lines.push(`ALL PROP RESEARCH MATRIX ${DATE}`);
  lines.push("============================");
  lines.push(`rows=${out.rowCount}`);
  lines.push(`graded=${out.gradedCount}`);
  lines.push("");

  function print(title, obj, limit=40){
    lines.push(title);
    lines.push("-".repeat(title.length));
    let i=0;
    for(const [k,g] of Object.entries(obj)){
      if(i++ >= limit) break;
      lines.push(`${k}: action=${g.action} count=${g.count} graded=${g.graded} hit=${g.hit} miss=${g.miss} push=${g.push} pending=${g.pending} unmatched=${g.unmatched} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
    }
    lines.push("");
  }

  print("BY SOURCE LANE",groups.bySourceLane);
  print("BY MARKET SIDE",groups.byMarketSide);
  print("BY MARKET SIDE TIER",groups.byMarketSideTier);
  print("BY MARKET SIDE LINE",groups.byMarketSideLine);
  print("BY PLATOON",groups.byPlatoon);
  print("BY ORDER",groups.byOrder);
  print("BY TREND",groups.byTrend);
  print("BOOST CANDIDATES",groups.byBoostCandidates,60);
  print("SUPPRESSION CANDIDATES",groups.bySuppressionCandidates,60);

  writeText(`outputs/history/${DATE}-all-prop-research-matrix.txt`,lines.join("\n")+"\n");
  writeText("outputs/all-prop-research-matrix-latest.txt",lines.join("\n")+"\n");

  console.log({
    date:DATE,
    rows:out.rowCount,
    graded:out.gradedCount,
    boostCandidates:Object.keys(groups.byBoostCandidates).length,
    suppressionCandidates:Object.keys(groups.bySuppressionCandidates).length
  });
}

main();
