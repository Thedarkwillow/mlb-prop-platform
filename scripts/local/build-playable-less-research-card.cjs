const fs = require("fs");
const path = require("path");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

const DATE = process.env.npm_config_date || process.env.DATE || new Date().toISOString().slice(0,10);

function flatten(v,out=[]){
  if(!v) return out;
  if(Array.isArray(v)){ for(const x of v) flatten(x,out); return out; }
  if(typeof v !== "object") return out;

  if(v.player || v.playerName || v.market || v.stat || v.side || v.line) out.push(v);

  for(const val of Object.values(v)){
    if(val && typeof val === "object") flatten(val,out);
  }
  return out;
}

function normMarket(v){
  const x=s(v).toLowerCase().replace(/\s+/g,"_").replace(/-/g,"_");
  const map={
    "hits+runs+rbis":"hrr",
    "hits_runs_rbis":"hrr",
    "hrr":"hrr",
    "total_bases":"bases",
    "bases":"bases",
    "hits":"hits",
    "walks":"walks",
    "rbis":"rbis",
    "runs":"runs",
    "home_runs":"home_runs",
    "fantasy_score":"hitter_fantasy_score",
    "hitter_fantasy_score":"hitter_fantasy_score",
    "pitcher_strikeouts":"strikeouts",
    "strikeouts":"strikeouts",
    "pitching_outs":"pitching_outs",
    "outs":"pitching_outs",
    "hits_allowed":"hits_allowed",
    "pitcher_hits_allowed":"hits_allowed",
    "earned_runs_allowed":"earned_runs_allowed",
    "runs_allowed":"earned_runs_allowed",
    "walks_allowed":"walks_allowed",
    "pitcher_walks":"walks_allowed"
  };
  return map[x] || x || "unknown";
}

function normSide(v){
  const x=s(v).toUpperCase();
  if(["LESS","UNDER","U"].includes(x)) return "LESS";
  if(["MORE","OVER","O"].includes(x)) return "MORE";
  return x || "";
}

function tier(v){
  const x=s(v).toLowerCase();
  if(x.includes("standard")) return "standard";
  if(x.includes("goblin")) return "goblin";
  if(x.includes("demon")) return "demon";
  return x || "unknown";
}

function prob(row){
  const side = normSide(row.recommendedSide || row.side || row.pick || row.recommendation || row.direction);

  const vals=[
    row.recommendedProb,
    side === "LESS" ? row.underProb : null,
    side === "MORE" ? row.overProb : null,
    row.probability,row.prob,row.hitProbability,row.adjustedProbability,row.finalProbability,
    row.pLess,row.lessProbability,row.probLess
  ];

  for(const v of vals){
    const x=n(v);
    if(x!==null) return x>1 ? x/100 : x;
  }
  return null;
}

function projection(row){
  const vals=[
    row.contextAdjustedProjection,row.adjustedProjection,row.projection,row.rawProjection,
    row.mean,row.expected,row.modelProjection
  ];
  for(const v of vals){
    const x=n(v);
    if(x!==null) return x;
  }
  return null;
}

function edge(row){
  const vals=[row.expectedValue,row.edge,row.ev,row.value];
  for(const v of vals){
    const x=n(v);
    if(x!==null) return x;
  }
  return null;
}

function allowedLine(market,line){
  const x=n(line);
  if(x===null) return false;

  if(market==="hrr") return x>=1.5 && x<=3.5;
  if(market==="hits") return x>=0.5 && x<=1.5;
  if(market==="bases") return x>=0.5 && x<=2.5;
  if(market==="walks") return x>=0.5 && x<=1.5;
  if(market==="home_runs") return x===0.5;
  if(market==="rbis") return x>=0.5 && x<=1.5;
  if(market==="runs") return x>=0.5 && x<=1.5;

  if(market==="strikeouts") return x>=3.5 && x<=8.5;
  if(market==="pitching_outs") return x>=14.5 && x<=18.5;
  if(market==="hits_allowed") return x>=4.5 && x<=7.5;
  if(market==="earned_runs_allowed") return x>=1.5 && x<=3.5;
  if(market==="walks_allowed") return x>=1.5 && x<=2.5;

  return false;
}

function marketFamily(m){
  if(["hrr","hits","bases","walks","home_runs","rbis","runs","hitter_fantasy_score"].includes(m)) return "hitter";
  if(["strikeouts","pitching_outs","hits_allowed","earned_runs_allowed","walks_allowed"].includes(m)) return "pitcher";
  return "other";
}

function lessV2Allowed(row){
  const m = normMarket(row.market || row.stat || row.projectionMarket || row.propType);
  const line = n(row.line ?? row.target ?? row.threshold ?? row.boardLine);
  const p = prob(row);
  const proj = projection(row);
  const gap = (line !== null && proj !== null) ? line - proj : null;
  const pfMatch = s(row.pfSignalMatchType || row.pickfinderMatchType || row.pfMatchType);

  // 6/09 grading: ER LESS, HRR LESS, and walks_allowed LESS failed first playable test.
  // Keep them out of the playable LESS card until multi-slate proof improves.
  if(["earned_runs_allowed","hrr","walks_allowed"].includes(m)) return false;

  // Do not let player_only PF matches into the stricter playable LESS card.
  if(pfMatch === "player_only") return false;

  if(m === "strikeouts"){
    return line >= 4.5 && line <= 6.5 && p !== null && p >= 0.70 && gap !== null && gap >= 1.0;
  }

  if(m === "hits_allowed"){
    return line >= 4.5 && line <= 6.5 && p !== null && p >= 0.60 && gap !== null && gap >= 0.5;
  }

  if(m === "pitching_outs"){
    return line >= 16.5 && line <= 17.5 && p !== null && p >= 0.60 && gap !== null && gap >= 0.5;
  }

  return false;
}

function scoreRow(row){
  const p=prob(row);
  const proj=projection(row);
  const line=n(row.line ?? row.target ?? row.threshold ?? row.boardLine);
  const ev=edge(row);
  const m=normMarket(row.market || row.stat || row.projectionMarket || row.propType);
  const t=tier(row.tier || row.oddsTier || row.priceTier || row.specialType);
  const pfMatch=s(row.pfSignalMatchType || row.pickfinderMatchType || row.pfMatchType);
  const pfUsable=!!(row.pfSignalUsableForModel || row.pfSignalDecisionEligible || pfMatch==="exact" || pfMatch==="player_market");
  const lineupConfirmed=!!(row.pfLineupConfirmed || row.lineupConfirmed || row.confirmedLineup || row.isConfirmedLineup);
  const blocked=!!(row.blocked || row.blockReasons || row.blockedReason);
  const doubleheader=!!(row.doubleheaderRisk || row.isDoubleheader || row.doubleHeaderRisk);
  const conf=s(row.confidence || row.confidenceTier).toLowerCase();

  let score=0;
  if(p!==null) score += p*100;
  if(ev!==null) score += Math.max(-5,Math.min(20,ev*10));
  if(proj!==null && line!==null) score += Math.max(0,Math.min(25,(line-proj)*8));
  if(pfUsable) score += 8;
  if(lineupConfirmed) score += 5;
  if(conf.includes("elite")) score += 8;
  if(conf.includes("strong")) score += 5;
  if(t==="standard") score += 5;
  if(t==="goblin" || t==="demon") score -= 20;
  if(blocked) score -= 30;
  if(doubleheader) score -= 40;
  if(m==="hrr") score += 4;
  if(["hits","bases","walks"].includes(m)) score += 2;
  if(["strikeouts","hits_allowed","earned_runs_allowed"].includes(m)) score += 3;
  return score;
}

function blockReasons(row){
  const reasons=[];
  const m=normMarket(row.market || row.stat || row.projectionMarket || row.propType);
  const side=normSide(row.recommendedSide || row.side || row.pick || row.recommendation || row.direction);
  const t=tier(row.tier || row.oddsTier || row.priceTier || row.specialType);
  const p=prob(row);
  const proj=projection(row);
  const line=n(row.line ?? row.target ?? row.threshold ?? row.boardLine);

  if(side!=="LESS") reasons.push("not_less");
  if(t!=="standard") reasons.push("not_standard_first_pass");
  if(!allowedLine(m,line)) reasons.push("line_not_allowed");
  if(p===null || p<0.58) reasons.push("prob_below_58_or_missing");
  if(proj===null || line===null || !(proj<line)) reasons.push("projection_not_below_line");
  if(!lessV2Allowed(row)) reasons.push("less_v2_filter_failed");
  if(row.blocked || row.blockReasons || row.blockedReason) reasons.push("already_blocked");
  if(row.doubleheaderRisk || row.isDoubleheader || row.doubleHeaderRisk) reasons.push("doubleheader_risk");
  if(!s(row.player || row.playerName || row.name || row.participantName)) reasons.push("missing_player");

  return reasons;
}

function main(){
  const board = read("outputs/priced-board.json") || read(`outputs/priced-board-${DATE}.json`) || [];
  const rows = flatten(board);

  const allowedMarkets = new Set([
    "strikeouts","pitching_outs","hits_allowed",
    "hrr","earned_runs_allowed","walks_allowed"
  ]);

  const candidates=[];
  const rejected=[];

  for(const raw of rows){
    const m=normMarket(raw.market || raw.stat || raw.projectionMarket || raw.propType);
    if(!allowedMarkets.has(m)) continue;

    const reasons=blockReasons(raw);
    const line=n(raw.line ?? raw.target ?? raw.threshold ?? raw.boardLine);
    const p=prob(raw);
    const proj=projection(raw);
    const row={
      player:s(raw.player || raw.playerName || raw.name || raw.participantName),
      team:s(raw.team || raw.teamAbbr),
      game:s(raw.game || raw.matchup),
      market:m,
      family:marketFamily(m),
      side:normSide(raw.recommendedSide || raw.side || raw.pick || raw.recommendation || raw.direction),
      line,
      tier:tier(raw.tier || raw.oddsTier || raw.priceTier || raw.specialType),
      probability:p,
      projection:proj,
      gap:(line!==null && proj!==null) ? +(line-proj).toFixed(3) : null,
      ev:edge(raw),
      confidence:s(raw.confidenceBucket || raw.confidence || raw.confidenceTier),
      pfSignalMatchType:s(raw.pfSignalMatchType || raw.pickfinderMatchType || raw.pfMatchType),
      pfSignalUsableForModel:!!raw.pfSignalUsableForModel,
      pfLineupConfirmed:!!(raw.pfLineupConfirmed || raw.lineupConfirmed || raw.confirmedLineup),
      battingOrder:n(raw.pfBattingOrder || raw.battingOrder),
      score:+scoreRow(raw).toFixed(3),
      reasons
    };

    if(reasons.length===0) candidates.push(row);
    else rejected.push(row);
  }

  candidates.sort((a,b)=>b.score-a.score);

  const byMarket={};
  for(const c of candidates){
    byMarket[c.market] ||= [];
    byMarket[c.market].push(c);
  }

  const limited=[];
  const marketCaps={
    hrr:12,hits:8,bases:8,walks:6,home_runs:4,rbis:6,runs:6,
    strikeouts:8,pitching_outs:6,hits_allowed:8,earned_runs_allowed:6,walks_allowed:6
  };

  for(const [m,arr] of Object.entries(byMarket)){
    limited.push(...arr.slice(0,marketCaps[m] || 5));
  }

  limited.sort((a,b)=>b.score-a.score);

  const out={
    date:DATE,
    generatedAt:new Date().toISOString(),
    source:"outputs/priced-board.json",
    rules:{
      status:"research only",
      required:"LESS, standard, allowed line bucket, prob >= .58, projection below line, no block/doubleheader, and strict LESS v2 filter",
      lessV2:"active: allows only strikeouts LESS, hits_allowed LESS, pitching_outs LESS; suppresses ER LESS, HRR LESS, walks_allowed LESS until more proof",
      note:"This avoids blindly trusting inflated full-board LESS rates."
    },
    counts:{
      rawRows:rows.length,
      candidates:candidates.length,
      rejected:rejected.length,
      cardRows:limited.length
    },
    candidates:limited,
    allCandidates:candidates,
    rejectedSample:rejected.slice(0,200)
  };

  writeJson(`outputs/history/${DATE}-playable-less-research-card.json`,out);
  writeJson("outputs/playable-less-research-card-latest.json",out);

  const lines=[];
  lines.push(`PLAYABLE LESS RESEARCH CARD ${DATE}`);
  lines.push("================================");
  lines.push(`rawRows=${rows.length}`);
  lines.push(`candidates=${candidates.length}`);
  lines.push(`cardRows=${limited.length}`);
  lines.push("");
  lines.push("RESEARCH ONLY — NOT OFFICIAL");
  lines.push("");

  for(const [i,c] of limited.entries()){
    lines.push(`${i+1}. ${c.player} | ${c.team} | ${c.market.toUpperCase()} LESS ${c.line} | prob=${c.probability} proj=${c.projection} gap=${c.gap} ev=${c.ev} conf=${c.confidence || "NA"} score=${c.score} pf=${c.pfSignalMatchType || "NA"}`);
  }

  writeText(`outputs/history/${DATE}-playable-less-research-card.txt`,lines.join("\n")+"\n");
  writeText("outputs/playable-less-research-card-latest.txt",lines.join("\n")+"\n");

  console.log(out.counts);
}

main();
