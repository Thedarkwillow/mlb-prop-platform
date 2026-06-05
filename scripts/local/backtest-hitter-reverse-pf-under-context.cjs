const fs = require("fs");
const path = require("path");

const START = process.argv[2] || "2026-06-02";
const END = process.argv[3] || "2026-06-04";
const HIST_DIR = "outputs/history";
const RUN_DIR = "outputs/history/runs";

function read(p,f){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}}
function flat(v,out=[]){
  if (!v) return out;
  if (Array.isArray(v)) { for (const x of v) flat(x,out); return out; }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x,out);
  return out;
}
function norm(v){
  return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/jr\.?|sr\.?|ii|iii|iv/g,"")
    .replace(/[^a-z0-9]+/g,"");
}
function market(r){
  let m = String(r.market || r.stat || r.type || "").toLowerCase().replace(/\s+/g,"_");
  if (m === "total_bases") m = "bases";
  if (m === "hits+runs+rbis" || m === "hits_runs_rbis") m = "hrr";
  if (m === "runs_batted_in") m = "rbis";
  return m;
}
function side(r){ return String(r.side || r.recommendedSide || r.pick || "").toUpperCase(); }
function tier(r){ return String(r.tier || r.oddsTier || "standard").toLowerCase(); }
function line(r){ return Number(r.line ?? r.target ?? r.value ?? r.threshold); }
function result(r){ return String(r.result || r.grade || r.outcome || "").toUpperCase(); }
function hit(r){ return result(r).includes("HIT"); }
function miss(r){ return result(r).includes("MISS"); }
function num(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }
function pct(a,b){ return b ? `${(a/b*100).toFixed(1)}%` : "n/a"; }
function roi(h,m){ const t=h+m; return t ? `${(((h-m)/t)*100).toFixed(1)}%` : "n/a"; }
function key(player,m,s,l){ return [norm(player),m,s,Number(l)].join("|"); }
function rowKey(r, forcedSide=null){
  return key(r.player || r.playerName || r.name, market(r), forcedSide || side(r), line(r));
}

const allowedMarkets = new Set(["hits","bases","walks","rbis","singles","doubles"]);

function isEligibleLessGrade(r){
  const m = market(r), l = line(r);
  if (!allowedMarkets.has(m)) return false;
  if (side(r) !== "LESS") return false;
  if (tier(r) !== "standard") return false;
  if (!Number.isFinite(l)) return false;
  if (m === "hits" && l < 1.5) return false;
  if (m === "bases" && l < 1.5) return false;
  return hit(r) || miss(r);
}

function latestPricedBoardForDate(date){
  const dir = path.join(RUN_DIR, date);
  if (!fs.existsSync(dir)) return null;
  const runs = fs.readdirSync(dir)
    .map(run => path.join(dir, run, "priced-board.json"))
    .filter(fs.existsSync)
    .sort();
  return runs[runs.length - 1] || null;
}

function rate(rows, count){
  const sample = rows.slice(-count);
  if (!sample.length) return null;
  return sample.filter(hit).length / sample.length;
}
function weighted(parts){
  const good = parts.filter(([v]) => Number.isFinite(v));
  const w = good.reduce((a,x)=>a+x[1],0);
  return w ? good.reduce((a,[v,wt])=>a+v*wt,0)/w : null;
}

function trendScore(samples){
  const vals = {
    l5: rate(samples,5),
    l10: rate(samples,10),
    l15: rate(samples,15),
    season: rate(samples,9999)
  };
  return {
    ...vals,
    score: weighted([[vals.l5,.25],[vals.l10,.35],[vals.l15,.25],[vals.season,.15]])
  };
}

function handScore(r, m){
  const a = r?.handednessContext?.active || {};
  const xba = num(a.xba);
  const xslg = num(a.xslg);
  const xwoba = num(a.xwoba);
  const kRate = num(a.kRate);
  const bbRate = num(a.bbRate);

  let s = 0.5;
  const flags = [];

  if (m === "hits" || m === "bases" || m === "singles" || m === "doubles") {
    if (xba != null && xba <= 0.220) { s += 0.12; flags.push("low_xba_vs_hand"); }
    if (xslg != null && xslg <= 0.360) { s += 0.10; flags.push("low_xslg_vs_hand"); }
    if (xwoba != null && xwoba <= 0.300) { s += 0.08; flags.push("low_xwoba_vs_hand"); }
    if (kRate != null && kRate >= 28) { s += 0.06; flags.push("high_k_rate_vs_hand"); }
  }

  if (m === "walks") {
    if (bbRate != null && bbRate <= 7) { s += 0.16; flags.push("low_bb_rate_vs_hand"); }
    if (xwoba != null && xwoba <= 0.300) { s += 0.04; flags.push("low_xwoba_vs_hand"); }
  }

  if (m === "rbis") {
    if (xwoba != null && xwoba <= 0.310) { s += 0.10; flags.push("low_xwoba_vs_hand"); }
    if (xslg != null && xslg <= 0.380) { s += 0.08; flags.push("low_xslg_vs_hand"); }
  }

  return { score: Math.max(0, Math.min(1, s)), flags };
}

function recentProfileScore(r, m){
  const last15Avg = num(r.hitterLast15Avg);
  const seasonAvg = num(r.hitterSeasonAvg);
  const last15WalkRate = num(r.hitterLast15WalkRate);
  let s = 0.5;
  const flags = [];

  if (["hits","bases","singles","doubles"].includes(m)) {
    if (last15Avg != null && last15Avg <= 0.220) { s += 0.12; flags.push("cold_last15_avg"); }
    if (seasonAvg != null && seasonAvg <= 0.230) { s += 0.08; flags.push("low_season_avg"); }
  }

  if (m === "walks") {
    if (last15WalkRate != null && last15WalkRate <= 0.07) { s += 0.14; flags.push("low_last15_walk_rate"); }
  }

  return { score: Math.max(0, Math.min(1, s)), flags };
}

function arsenalScore(r){
  let s = 0.5;
  const flags = [];
  const tier = String(r.pitchTypeMatchupTier || "").toLowerCase();
  const score = num(r.pitchTypeMatchupScore);
  const flagText = JSON.stringify(r.pitchTypeMatchupFlags || []).toLowerCase();

  if (tier.includes("negative") || tier.includes("bad") || tier.includes("pitcher")) {
    s += 0.12; flags.push("pitch_type_tier_under");
  }
  if (score != null && score < 0) {
    s += Math.min(0.14, Math.abs(score) * 0.10);
    flags.push("negative_pitch_type_score");
  }
  if (flagText.includes("missing_pitcher_arsenal") || r.pitchTypeNeutralFallback) {
    s -= 0.08; flags.push("pitch_type_fallback");
  }
  if (tier.includes("positive") || tier.includes("hitter")) {
    s -= 0.10; flags.push("pitch_type_conflict");
  }

  return { score: Math.max(0, Math.min(1, s)), flags };
}

function ballparkLineScore(r, m, l){
  const bp = r.ballpark || {};
  let proj = null;
  if (m === "hits") proj = num(bp.hits);
  if (m === "bases") proj = num(bp.bases);
  if (m === "walks") proj = num(bp.walks);
  if (m === "rbis") proj = num(bp.rBIs ?? bp.rbis ?? bp.RBIs);
  if (m === "singles") proj = num(bp.singles);
  if (m === "doubles") proj = num(bp.doubles);

  let s = 0.5;
  const flags = [];
  if (proj != null) {
    if (proj <= l - 0.25) { s += 0.16; flags.push("ballpark_projection_below_line"); }
    else if (proj <= l) { s += 0.08; flags.push("ballpark_projection_slightly_below_line"); }
    else { s -= 0.08; flags.push("ballpark_projection_above_line"); }
  } else {
    flags.push("ballpark_projection_missing");
  }
  return { score: Math.max(0, Math.min(1, s)), flags, projection: proj };
}

function modelScore(r){
  const p = num(r.recommendedProb ?? r.prob ?? r.probability ?? r.modelProb ?? r.lessProb);
  if (p == null) return { score: 0.5, flags:["model_prob_missing"], prob:null };
  let s = 0.5;
  const flags = [];
  if (p >= 0.65) { s += 0.20; flags.push("model_prob_65_plus"); }
  else if (p >= 0.60) { s += 0.14; flags.push("model_prob_60_plus"); }
  else if (p >= 0.57) { s += 0.08; flags.push("model_prob_57_plus"); }
  else { s -= 0.10; flags.push("model_prob_low"); }
  return { score: Math.max(0, Math.min(1, s)), flags, prob:p };
}

function supportOk(r){
  const b = num(r.books ?? r.bookCount ?? r.directBookCount ?? r.supportBooks);
  const g = String(r.grade || r.bookSupportGrade || r.directBookGrade || r.syntheticGrade || "").toUpperCase();
  const sup = String(r.support || r.bookSupport || r.directBookSupport || r.supportType || "").toUpperCase();
  const ok = (!sup || !/UNPRICED|UNKNOWN|LOW_BOOK|NO_BOOK|PHASE8/.test(sup)) &&
    (b == null || b >= 2) &&
    (!g || g === "GREEN" || g === "NEUTRAL");
  return { ok, books:b, grade:g || null, support:sup || null };
}

function summarize(rows){
  const hits = rows.filter(r => r.result === "HIT").length;
  const misses = rows.filter(r => r.result === "MISS").length;
  return { rows: rows.length, graded: hits+misses, hits, misses, hitRate: pct(hits,hits+misses), roiProxy: roi(hits,misses) };
}
function group(rows, fn){
  const map = {};
  for (const r of rows) (map[fn(r)] ||= []).push(r);
  return Object.entries(map).map(([bucket,rs]) => ({bucket, ...summarize(rs)}))
    .sort((a,b)=>b.graded-a.graded);
}

const gradeFiles = fs.existsSync(HIST_DIR)
  ? fs.readdirSync(HIST_DIR).filter(f => /^\d{4}-\d{2}-\d{2}-full-board-graded\.json$/.test(f)).map(f => f.slice(0,10)).sort()
  : [];

const hist = new Map();
const rows = [];

for (const date of gradeFiles) {
  const gradeRows = flat(read(path.join(HIST_DIR, `${date}-full-board-graded.json`), [])).filter(isEligibleLessGrade);
  const boardFile = latestPricedBoardForDate(date);
  const boardRows = boardFile ? flat(read(boardFile, [])) : [];
  const ctxMap = new Map();

  for (const r of boardRows) {
    const m = market(r), l = line(r);
    if (!allowedMarkets.has(m) || !Number.isFinite(l)) continue;
    // Force LESS key so we can join current context to graded LESS row.
    ctxMap.set(key(r.player || r.playerName || r.name, m, "LESS", l), r);
  }

  for (const gr of gradeRows) {
    const k = rowKey(gr);
    const samples = hist.get(k) || [];
    const ctx = ctxMap.get(k);
    if (date >= START && date <= END) {
      const m = market(gr), l = line(gr);
      const trend = trendScore(samples);
      const hand = ctx ? handScore(ctx,m) : {score:0.5, flags:["context_missing"]};
      const recent = ctx ? recentProfileScore(ctx,m) : {score:0.5, flags:["context_missing"]};
      const arsenal = ctx ? arsenalScore(ctx) : {score:0.5, flags:["context_missing"]};
      const bp = ctx ? ballparkLineScore(ctx,m,l) : {score:0.5, flags:["context_missing"], projection:null};
      const mod = ctx ? modelScore(ctx) : {score:0.5, flags:["context_missing","model_prob_missing"], prob:null};
      const sup = ctx ? supportOk(ctx) : {ok:false, books:null, grade:null, support:null};

      const componentScore = weighted([
        [trend.score, .30],
        [hand.score, .18],
        [recent.score, .14],
        [arsenal.score, .12],
        [bp.score, .14],
        [mod.score, .12],
      ]);

      const flags = [
        ...hand.flags, ...recent.flags, ...arsenal.flags, ...bp.flags, ...mod.flags,
        ...(sup.ok ? [] : ["support_not_clean"])
      ];

      let status = "REVERSE_CONTEXT_NOT_CHECKED";
      if (samples.length >= 5 && componentScore != null) {
        if (
          componentScore >= 0.64 &&
          (trend.score ?? 0) >= 0.58 &&
          mod.prob != null &&
          mod.prob >= 0.57 &&
          sup.ok &&
          ctx
        ) status = "REVERSE_CONTEXT_CONFIRMED_UNDER";
        else if (
          componentScore >= 0.58 &&
          (trend.score ?? 0) >= 0.55 &&
          ctx
        ) status = "REVERSE_CONTEXT_WATCH_UNDER";
        else status = "REVERSE_CONTEXT_WEAK_UNDER";
      }

      rows.push({
        date,
        player: gr.player || gr.playerName || gr.name,
        team: gr.team || gr.teamAbbr || null,
        market: m,
        side: "LESS",
        line: l,
        result: hit(gr) ? "HIT" : "MISS",
        actual: gr.actual ?? null,
        sampleSize: samples.length,
        score: componentScore,
        trendScore: trend.score,
        handScore: hand.score,
        recentScore: recent.score,
        arsenalScore: arsenal.score,
        ballparkLineScore: bp.score,
        modelScore: mod.score,
        modelProb: mod.prob,
        ballparkProjection: bp.projection,
        books: sup.books,
        grade: sup.grade,
        support: sup.support,
        hasContext: !!ctx,
        status,
        flags
      });
    }

    if (!hist.has(k)) hist.set(k, []);
    hist.get(k).push(gr);
  }
}

const report = {
  start: START,
  end: END,
  policy: "Reverse PF Under Context Backtest v3. Backtest-only. Joins latest run priced-board context to full-board graded LESS rows.",
  summary: {
    all: summarize(rows),
    confirmed: summarize(rows.filter(r => r.status === "REVERSE_CONTEXT_CONFIRMED_UNDER")),
    watch: summarize(rows.filter(r => r.status === "REVERSE_CONTEXT_WATCH_UNDER")),
    weak: summarize(rows.filter(r => r.status === "REVERSE_CONTEXT_WEAK_UNDER")),
    notChecked: summarize(rows.filter(r => r.status === "REVERSE_CONTEXT_NOT_CHECKED")),
  },
  byStatus: group(rows, r => r.status),
  byMarketStatus: group(rows, r => `${r.market}|${r.status}`),
  confirmedByMarket: group(rows.filter(r => r.status === "REVERSE_CONTEXT_CONFIRMED_UNDER"), r => r.market),
  rows
};

const outJson = `outputs/reverse-pf-under-context-backtest-${START}-to-${END}.json`;
const outTxt = `outputs/reverse-pf-under-context-backtest-${START}-to-${END}.txt`;
fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

const lines = [];
lines.push("REVERSE PF UNDER CONTEXT BACKTEST V3");
lines.push("====================================");
lines.push(`range=${START} to ${END}`);
lines.push(report.policy);
lines.push("");
for (const [k,v] of Object.entries(report.summary)) {
  lines.push(`${k}: graded=${v.graded} hits=${v.hits} misses=${v.misses} hitRate=${v.hitRate} roiProxy=${v.roiProxy}`);
}
lines.push("");
lines.push("BY STATUS");
for (const r of report.byStatus) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("CONFIRMED BY MARKET");
for (const r of report.confirmedByMarket) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
fs.writeFileSync(outTxt, lines.join("\n"));

console.log(report.summary);
console.log("BY STATUS");
console.table(report.byStatus);
console.log("CONFIRMED BY MARKET");
console.table(report.confirmedByMarket);
console.log(`saved: ${outJson}`);
console.log(`saved: ${outTxt}`);
