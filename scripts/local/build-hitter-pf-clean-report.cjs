const fs = require("fs");
const path = require("path");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const BOARD_FILE = process.env.BOARD_FILE || "outputs/priced-board.json";

function read(p,f){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}}
function flat(v,out=[]){
  if (!v) return out;
  if (Array.isArray(v)) { for (const x of v) flat(x,out); return out; }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name) out.push(v);
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
  return m;
}
function side(r){ return String(r.side || r.recommendedSide || r.pick || "").toUpperCase(); }
function line(r){ return Number(r.line ?? r.target ?? r.value ?? r.threshold); }
function result(r){ return String(r.result || r.grade || r.outcome || "").toUpperCase(); }
function hit(r){ return result(r).includes("HIT"); }
function miss(r){ return result(r).includes("MISS"); }
function pct(n){ return Number.isFinite(n) ? `${(n*100).toFixed(1)}%` : "n/a"; }
function key(r){ return [norm(r.player || r.playerName || r.name), market(r), side(r), line(r)].join("|"); }

const hitterMarkets = new Set(["hits","bases","hrr","runs","rbis","walks","singles","doubles","triples","stolen_bases"]);

function historyFiles(){
  const dir = "outputs/history";
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}-full-board-graded\.json$/.test(f))
    .map(f => ({date:f.slice(0,10), file:path.join(dir,f)}))
    .filter(x => x.date < DATE)
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function rate(rows, n){
  const sample = rows.slice(-n);
  if (!sample.length) return NaN;
  return sample.filter(hit).length / sample.length;
}
function weighted(vals){
  const parts = [
    [vals.l5, .25],
    [vals.l10, .35],
    [vals.l15, .25],
    [vals.season, .15],
  ].filter(([v]) => Number.isFinite(v));
  const w = parts.reduce((a,x)=>a+x[1],0);
  return w ? parts.reduce((a,[v,wt])=>a+v*wt,0)/w : NaN;
}

const hist = new Map();
for (const h of historyFiles()) {
  for (const r of flat(read(h.file, []))) {
    if (!(hit(r) || miss(r))) continue;
    const m = market(r);
    if (!hitterMarkets.has(m)) continue;
    const k = key(r);
    if (!hist.has(k)) hist.set(k, []);
    hist.get(k).push({...r, _date:h.date});
  }
}

const board = flat(read(BOARD_FILE, []));
const rows = [];
for (const r of board) {
  const m = market(r);
  if (!hitterMarkets.has(m)) continue;
  if (!side(r) || !Number.isFinite(line(r))) continue;

  const samples = hist.get(key(r)) || [];
  const vals = {
    l5: rate(samples,5),
    l10: rate(samples,10),
    l15: rate(samples,15),
    season: rate(samples,9999),
  };
  vals.pfScore = weighted(vals);

  const sampleSize = samples.length;
  let pfStatus = "PF_NOT_CHECKED";
  if (sampleSize >= 3) {
    pfStatus = (
      vals.pfScore >= .65 ||
      vals.l10 >= .70 ||
      (vals.l5 >= .60 && vals.l15 >= .60)
    ) ? "PF_CONFIRMED" : "PF_WEAK";
  }

  rows.push({
    date: DATE,
    player: r.player || r.playerName || r.name,
    team: r.team || r.teamAbbr || null,
    game: r.game || r.matchup || null,
    market: m,
    side: side(r),
    line: line(r),
    tier: String(r.tier || r.oddsTier || "standard").toLowerCase(),
    modelProb: Number(r.recommendedProb ?? r.prob ?? r.probability ?? r.modelProb ?? NaN),
    sampleSize,
    pfScore: Number.isFinite(vals.pfScore) ? vals.pfScore : null,
    l5: Number.isFinite(vals.l5) ? vals.l5 : null,
    l10: Number.isFinite(vals.l10) ? vals.l10 : null,
    l15: Number.isFinite(vals.l15) ? vals.l15 : null,
    season: Number.isFinite(vals.season) ? vals.season : null,
    pfStatus,
    source: "local_historical_pf_style"
  });
}

rows.sort((a,b)=>
  (b.pfScore ?? -1) - (a.pfScore ?? -1) ||
  b.sampleSize - a.sampleSize
);

const summary = {
  date: DATE,
  boardFile: BOARD_FILE,
  rows: rows.length,
  confirmed: rows.filter(r=>r.pfStatus==="PF_CONFIRMED").length,
  weak: rows.filter(r=>r.pfStatus==="PF_WEAK").length,
  notChecked: rows.filter(r=>r.pfStatus==="PF_NOT_CHECKED").length,
  note: "Local PF-style hitter trend report built from prior full-board graded history, not exact PickFinder website history."
};

fs.mkdirSync("outputs", {recursive:true});
fs.writeFileSync(`outputs/hitter-pf-clean-report-${DATE}.json`, JSON.stringify({summary, rows}, null, 2));
fs.writeFileSync("outputs/hitter-pf-clean-report-latest.json", JSON.stringify({summary, rows}, null, 2));

const lines = [];
lines.push("HITTER PF-STYLE CLEAN REPORT");
lines.push("============================");
lines.push(`date=${DATE}`);
lines.push(`rows=${summary.rows} confirmed=${summary.confirmed} weak=${summary.weak} notChecked=${summary.notChecked}`);
lines.push("Top confirmed:");
for (const r of rows.filter(r=>r.pfStatus==="PF_CONFIRMED").slice(0,40)) {
  lines.push(`${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | pfScore=${pct(r.pfScore)} | L5=${pct(r.l5)} | L10=${pct(r.l10)} | L15=${pct(r.l15)} | sample=${r.sampleSize}`);
}
fs.writeFileSync(`outputs/hitter-pf-clean-report-${DATE}.txt`, lines.join("\n"));
fs.writeFileSync("outputs/hitter-pf-clean-report-latest.txt", lines.join("\n"));

console.log(summary);
console.log(`saved: outputs/hitter-pf-clean-report-${DATE}.json`);
console.log(`saved: outputs/hitter-pf-clean-report-latest.json`);
