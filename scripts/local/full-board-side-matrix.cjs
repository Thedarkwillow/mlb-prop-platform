const fs = require("fs");
const path = require("path");

function read(file, fallback=null){
  try { return JSON.parse(fs.readFileSync(file,"utf8")); }
  catch { return fallback; }
}
function writeJson(file,data){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
}
function writeText(file,data){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,data);
}
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

const DATE = process.env.npm_config_date || process.env.DATE || new Date().toISOString().slice(0,10);

function flatten(v, out=[]){
  if(!v) return out;
  if(Array.isArray(v)){
    for(const x of v) flatten(x,out);
    return out;
  }
  if(typeof v !== "object") return out;

  const hasProp =
    v.player || v.playerName || v.name || v.market || v.stat || v.side || v.line ||
    v.result || v.outcome || v.actual !== undefined;

  if(hasProp) out.push(v);

  for(const val of Object.values(v)){
    if(val && typeof val === "object") flatten(val,out);
  }

  return out;
}

function normMarket(v){
  const x=s(v).toLowerCase()
    .replace(/\s+/g,"_")
    .replace(/-/g,"_");

  const map = {
    "hits+runs+rbis":"hrr",
    "hits_runs_rbis":"hrr",
    "h+r+r":"hrr",
    "hrr":"hrr",
    "fantasy_score":"hitter_fantasy_score",
    "hitter_fantasy":"hitter_fantasy_score",
    "hitter_fantasy_score":"hitter_fantasy_score",
    "total_bases":"bases",
    "bases":"bases",
    "singles":"singles",
    "hits":"hits",
    "walks":"walks",
    "rbis":"rbis",
    "runs":"runs",
    "home_runs":"home_runs",
    "pitcher_strikeouts":"strikeouts",
    "strikeouts":"strikeouts",
    "pitching_outs":"pitching_outs",
    "outs":"pitching_outs",
    "earned_runs_allowed":"earned_runs_allowed",
    "runs_allowed":"earned_runs_allowed",
    "hits_allowed":"hits_allowed",
    "pitcher_hits_allowed":"hits_allowed",
    "walks_allowed":"walks_allowed",
    "pitcher_walks":"walks_allowed"
  };

  return map[x] || x || "unknown_market";
}

function normSide(v){
  const x=s(v).toUpperCase();
  if(["MORE","OVER","O"].includes(x)) return "MORE";
  if(["LESS","UNDER","U"].includes(x)) return "LESS";
  return x || "UNKNOWN_SIDE";
}

function normResult(v){
  const x=s(v).toUpperCase();
  if(["HIT","WIN","WON","CASH","CASHED","TRUE"].includes(x)) return "HIT";
  if(["MISS","LOSS","LOST","LOSE","FALSE"].includes(x)) return "MISS";
  if(["PUSH","TIE","VOID","REFUND"].includes(x)) return "PUSH";
  if(["PENDING"].includes(x)) return "PENDING";
  return x || "UNKNOWN";
}

function tierBucket(v){
  const x=s(v).toLowerCase();
  if(x.includes("goblin")) return "goblin";
  if(x.includes("demon")) return "demon";
  if(x.includes("standard")) return "standard";
  if(x.includes("discount")) return "goblin";
  return x || "unknown_tier";
}

function confidenceBucket(v){
  const x=s(v).toLowerCase();
  if(!x) return "confidence_unknown";
  if(x.includes("elite")) return "elite";
  if(x.includes("strong")) return "strong";
  if(x.includes("medium")) return "medium";
  if(x.includes("low")) return "low";
  if(x.includes("weak")) return "weak";
  return x;
}

function probBucket(v){
  const x=n(v);
  if(x===null) return "prob_unknown";
  const p = x > 1 ? x/100 : x;
  if(p >= 0.80) return "prob_80_plus";
  if(p >= 0.75) return "prob_75_79";
  if(p >= 0.70) return "prob_70_74";
  if(p >= 0.65) return "prob_65_69";
  if(p >= 0.60) return "prob_60_64";
  if(p >= 0.55) return "prob_55_59";
  return "prob_below_55";
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

  if(market === "bases"){
    if(x <= 0.5) return "bases_0.5";
    if(x <= 1.5) return "bases_1.5";
    return "bases_2.5_plus";
  }

  if(market === "hits" || market === "singles"){
    if(x <= 0.5) return `${market}_0.5`;
    if(x <= 1.5) return `${market}_1.5`;
    return `${market}_2_plus`;
  }

  if(market === "strikeouts"){
    if(x <= 3.5) return "k_3.5_or_less";
    if(x <= 5.5) return "k_4_to_5.5";
    if(x <= 7.5) return "k_6_to_7.5";
    return "k_8_plus";
  }

  if(market === "pitching_outs"){
    if(x <= 14.5) return "outs_14.5_or_less";
    if(x <= 16.5) return "outs_15_to_16.5";
    if(x <= 18.5) return "outs_17_to_18.5";
    return "outs_19_plus";
  }

  if(market === "earned_runs_allowed" || market === "runs"){
    if(x <= 1.5) return `${market}_1.5_or_less`;
    if(x <= 2.5) return `${market}_2.5`;
    if(x <= 3.5) return `${market}_3.5`;
    return `${market}_4_plus`;
  }

  if(market === "hits_allowed"){
    if(x <= 4.5) return "hits_allowed_4.5_or_less";
    if(x <= 5.5) return "hits_allowed_5.5";
    if(x <= 6.5) return "hits_allowed_6.5";
    return "hits_allowed_7_plus";
  }

  if(market === "walks" || market === "walks_allowed"){
    if(x <= 0.5) return `${market}_0.5`;
    if(x <= 1.5) return `${market}_1.5`;
    return `${market}_2_plus`;
  }

  return `line_${x}`;
}

function sourceType(file, row){
  const f=s(file);
  if(f.includes("official")) return "official";
  if(f.includes("blocked")) return "blocked";
  if(f.includes("decision-layer")) return "decision_layer";
  if(f.includes("full-board")) return "full_board";
  if(f.includes("research")) return "research";
  if(f.includes("highprob")) return "highprob";
  if(f.includes("pickfinder")) return "pickfinder";
  if(row.blockReasons || row.blockedReason || row.blocked) return "blocked";
  if(row.official || row.isOfficial) return "official";
  return "unknown_source";
}

function addGroup(map,key,row){
  map[key] ||= {
    key,
    count:0,
    graded:0,
    hit:0,
    miss:0,
    push:0,
    pending:0,
    unknown:0,
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
  else { g.unknown++; }

  if(g.examples.length < 15){
    g.examples.push({
      source:row.source,
      player:row.player,
      team:row.team,
      market:row.market,
      side:row.side,
      line:row.line,
      tier:row.tier,
      confidence:row.confidence,
      probability:row.probability,
      actual:row.actual,
      result:row.result
    });
  }
}

function finish(map){
  for(const g of Object.values(map)){
    g.hitRate = g.graded ? +(g.hit/g.graded).toFixed(4) : null;
    g.roiProxy = g.graded ? +(((g.hit-g.miss)/g.graded)).toFixed(4) : null;

    if(g.graded < 15) g.action = "TRACK_ONLY_SMALL_SAMPLE";
    else if(g.hitRate >= 0.65 && g.roiProxy >= 0.25) g.action = "WATCH_BOOST";
    else if(g.hitRate <= 0.45 && g.roiProxy <= -0.10) g.action = "WATCH_SUPPRESS";
    else g.action = "NEUTRAL";
  }
}

function sorted(obj){
  return Object.fromEntries(
    Object.entries(obj).sort((a,b)=>
      (b[1].graded-a[1].graded) ||
      ((b[1].hitRate ?? -1)-(a[1].hitRate ?? -1))
    )
  );
}

function candidateFiles(){
  const files = [];

  const names = [
    `outputs/history/${DATE}-full-board-graded.json`,
    `outputs/history/${DATE}-decision-layer-grades.json`,
    `outputs/history/${DATE}-blocked-final-candidates-graded.json`,
    `outputs/history/${DATE}-research-lanes-graded.json`,
    `outputs/history/${DATE}-pickfinder-hand-goblin-graded.json`,
    `outputs/playable-final-slips-graded-${DATE}.json`,
    `outputs/full-board-graded-${DATE}.json`,
    `outputs/decision-layer-grades-latest.json`,
    `outputs/blocked-final-candidates.json`
  ];

  for(const f of names){
    if(fs.existsSync(f)) files.push(f);
  }

  if(fs.existsSync("outputs/history")){
    for(const f of fs.readdirSync("outputs/history")){
      if(!f.startsWith(DATE)) continue;
      if(!f.endsWith(".json")) continue;
      if(
        f.includes("graded") ||
        f.includes("decision-layer") ||
        f.includes("full-board") ||
        f.includes("blocked") ||
        f.includes("research")
      ){
        const full=path.join("outputs/history",f);
        if(!files.includes(full)) files.push(full);
      }
    }
  }

  return [...new Set(files)];
}

function normalizeRow(raw, file){
  const market = normMarket(raw.market || raw.stat || raw.projectionMarket || raw.propType);
  const side = normSide(raw.side || raw.pick || raw.recommendation || raw.direction);
  const result = normResult(raw.result || raw.outcome || raw.grade || raw.status);

  const player = s(raw.player || raw.playerName || raw.name || raw.participantName);
  const line = n(raw.line ?? raw.target ?? raw.threshold ?? raw.boardLine);
  const tier = tierBucket(raw.tier || raw.oddsTier || raw.priceTier || raw.specialType);
  const confidence = confidenceBucket(raw.confidence || raw.confidenceTier || raw.bucket);
  const probability = n(raw.probability ?? raw.prob ?? raw.p ?? raw.hitProbability);
  const actual = n(raw.actual ?? raw.actualValue ?? raw.statValue ?? raw.finalValue);

  return {
    source:sourceType(file,raw),
    file,
    player,
    team:s(raw.team || raw.teamAbbr),
    market,
    side,
    line,
    lineBucket:lineBucket(market,line),
    tier,
    confidence,
    probability,
    probBucket:probBucket(probability),
    actual,
    result,
    raw
  };
}

function main(){
  const files = candidateFiles();
  const rows = [];

  for(const file of files){
    const data = read(file);
    if(!data) continue;

    const flat = flatten(data);
    for(const raw of flat){
      const row = normalizeRow(raw,file);

      if(!row.player && row.market === "unknown_market") continue;
      if(row.result !== "HIT" && row.result !== "MISS" && row.result !== "PUSH") continue;
      if(row.side !== "MORE" && row.side !== "LESS") continue;
      if(row.market === "unknown_market") continue;

      rows.push(row);
    }
  }

  const groups = {
    bySource:{},
    bySide:{},
    byMarket:{},
    byMarketSide:{},
    byMarketSideLine:{},
    byMarketSideTier:{},
    byMarketSideConfidence:{},
    byMarketSideProbability:{},
    byTierSide:{},
    byConfidenceSide:{},
    lessOnlyByMarket:{},
    lessOnlyByMarketLine:{},
    lessOnlyByMarketTier:{},
    moreOnlyByMarket:{},
    boostCandidates:{},
    suppressionCandidates:{}
  };

  for(const r of rows){
    addGroup(groups.bySource,r.source,r);
    addGroup(groups.bySide,r.side,r);
    addGroup(groups.byMarket,r.market,r);
    addGroup(groups.byMarketSide,`${r.market} ${r.side}`,r);
    addGroup(groups.byMarketSideLine,`${r.market} ${r.side} ${r.lineBucket}`,r);
    addGroup(groups.byMarketSideTier,`${r.market} ${r.side} ${r.tier}`,r);
    addGroup(groups.byMarketSideConfidence,`${r.market} ${r.side} ${r.confidence}`,r);
    addGroup(groups.byMarketSideProbability,`${r.market} ${r.side} ${r.probBucket}`,r);
    addGroup(groups.byTierSide,`${r.tier} ${r.side}`,r);
    addGroup(groups.byConfidenceSide,`${r.confidence} ${r.side}`,r);

    if(r.side === "LESS"){
      addGroup(groups.lessOnlyByMarket,r.market,r);
      addGroup(groups.lessOnlyByMarketLine,`${r.market} ${r.lineBucket}`,r);
      addGroup(groups.lessOnlyByMarketTier,`${r.market} ${r.tier}`,r);
    }

    if(r.side === "MORE"){
      addGroup(groups.moreOnlyByMarket,r.market,r);
    }
  }

  for(const k of Object.keys(groups)){
    if(k === "boostCandidates" || k === "suppressionCandidates") continue;
    finish(groups[k]);
    groups[k] = sorted(groups[k]);
  }

  for(const [k,g] of Object.entries(groups.byMarketSideLine)){
    if(g.action === "WATCH_BOOST") groups.boostCandidates[k] = g;
    if(g.action === "WATCH_SUPPRESS") groups.suppressionCandidates[k] = g;
  }

  const out = {
    date:DATE,
    generatedAt:new Date().toISOString(),
    sourceFiles:files,
    sourceFileCount:files.length,
    rowCount:rows.length,
    gradedCount:rows.filter(r=>r.result==="HIT"||r.result==="MISS").length,
    rules:{
      actionNote:"Single-day/full-board matrix. Use this to find candidates, not to promote without multi-slate confirmation.",
      boostRule:"graded >= 15 and hitRate >= 65% and roiProxy >= 0.25",
      suppressRule:"graded >= 15 and hitRate <= 45% and roiProxy <= -0.10"
    },
    groups
  };

  writeJson(`outputs/history/${DATE}-full-board-side-matrix.json`,out);
  writeJson("outputs/full-board-side-matrix-latest.json",out);

  const lines=[];
  lines.push(`FULL BOARD SIDE MATRIX ${DATE}`);
  lines.push("============================");
  lines.push(`sourceFileCount=${files.length}`);
  lines.push(`rows=${out.rowCount}`);
  lines.push(`graded=${out.gradedCount}`);
  lines.push("");

  function print(title,obj,limit=50){
    lines.push(title);
    lines.push("-".repeat(title.length));
    let i=0;
    for(const [k,g] of Object.entries(obj)){
      if(i++ >= limit) break;
      lines.push(`${k}: action=${g.action} count=${g.count} graded=${g.graded} hit=${g.hit} miss=${g.miss} push=${g.push} hitRate=${g.hitRate} roiProxy=${g.roiProxy}`);
    }
    lines.push("");
  }

  print("BY SOURCE",groups.bySource);
  print("BY SIDE",groups.bySide);
  print("BY MARKET SIDE",groups.byMarketSide);
  print("LESS ONLY BY MARKET",groups.lessOnlyByMarket);
  print("LESS ONLY BY MARKET LINE",groups.lessOnlyByMarketLine,80);
  print("LESS ONLY BY MARKET TIER",groups.lessOnlyByMarketTier,80);
  print("BY MARKET SIDE LINE",groups.byMarketSideLine,100);
  print("BOOST CANDIDATES",groups.boostCandidates,80);
  print("SUPPRESSION CANDIDATES",groups.suppressionCandidates,80);

  writeText(`outputs/history/${DATE}-full-board-side-matrix.txt`,lines.join("\n")+"\n");
  writeText("outputs/full-board-side-matrix-latest.txt",lines.join("\n")+"\n");

  console.log({
    date:DATE,
    sourceFileCount:files.length,
    rows:out.rowCount,
    graded:out.gradedCount,
    lessRows:rows.filter(r=>r.side==="LESS").length,
    moreRows:rows.filter(r=>r.side==="MORE").length,
    boostCandidates:Object.keys(groups.boostCandidates).length,
    suppressionCandidates:Object.keys(groups.suppressionCandidates).length
  });
}

main();
