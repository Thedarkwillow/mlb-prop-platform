const fs = require("fs");
const cp = require("child_process");
const DATE = process.argv[2] || process.env.SLATE_DATE || process.env.npm_config_date ||
  cp.execSync("node scripts/local/board-slate-date.cjs").toString().trim();

const FILES = [
  `outputs/full-prop-confirmation-${DATE}.json`,
  "outputs/full-prop-confirmation-latest.json",
  `data/pickfinder/pickfinder-style-backfill-${DATE}.json`,
  `data/pickfinder/pickfinder-style-current-${DATE}.json`
];

const OUT = `outputs/hitter-pf-model-disagrees-${DATE}.json`;
const OUT_LATEST = "outputs/hitter-pf-model-disagrees-latest.json";

function read(p, f = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return f; }
}
function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.market || v.side || v.line || v.pfStatus || v.pickfinderStatus) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}
function norm(v) {
  return String(v ?? "").toLowerCase().trim();
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function prob(row) {
  for (const v of [row.modelProb,row.prob,row.probability,row.recommendedProb,row.pickProb,row.adjustedProb]) {
    const n = num(v);
    if (n !== null && n > 0 && n <= 1) return n;
  }
  return null;
}
function pfScore(row) {
  for (const v of [row.pfScore,row.pickfinderScore,row.confirmationScore,row.l10Rate,row.recentHitRate,row.seasonHitRate]) {
    const n = num(v);
    if (n !== null && n >= 0 && n <= 1) return n;
  }
  const l10 = num(row.l10?.rate);
  const season = num(row.season?.rate);
  if (l10 !== null && season !== null) return l10 * 0.6 + season * 0.4;
  if (l10 !== null) return l10;
  if (season !== null) return season;
  return null;
}
function isPitcherMarket(m) {
  return [
    "strikeouts",
    "hits_allowed",
    "earned_runs_allowed",
    "walks_allowed",
    "pitching_outs",
    "pitcher_fantasy_score",
    "pitches_thrown"
  ].includes(norm(m));
}
function key(r) {
  return [
    norm(r.player || r.playerName || r.name),
    norm(r.market || r.statType || r.stat),
    String(r.side || "").toUpperCase(),
    String(r.line ?? "")
  ].join("|");
}

let sourceFile = null;
let rows = [];
for (const f of FILES) {
  const data = read(f, null);
  const flat = flatten(data);
  if (flat.length) {
    sourceFile = f;
    rows = flat;
    break;
  }
}

const seen = new Set();
const hitterRows = [];
for (const r of rows) {
  const market = norm(r.market || r.statType || r.stat);
  if (!market || isPitcherMarket(market)) continue;
  const status = r.pfStatus || r.pickfinderStatus || r.bucket || r.status || "";
  const pfs = pfScore(r);
  const mp = prob(r);
  const confirmed = /PF_CONFIRMED|CONFIRMED|ACTIONABLE|WATCH/i.test(String(status)) || pfs !== null;
  if (!confirmed) continue;
  const k = key(r);
  if (seen.has(k)) continue;
  seen.add(k);
  let bucket = "HITTER_PF_UNBUCKETED";
  if (mp === null) bucket = "HITTER_PF_MODEL_PROB_MISSING";
  else if (pfs !== null && pfs >= 0.65 && mp < 0.55) bucket = "HITTER_MODEL_DISAGREES";
  else if (pfs !== null && pfs >= 0.65 && mp >= 0.65) bucket = "HITTER_PF_ACTIONABLE_WATCH";
  else if (pfs !== null && pfs >= 0.65 && mp >= 0.60) bucket = "HITTER_PF_REVIEW_WATCH";
  else bucket = "HITTER_PF_WITH_MODEL_PROB";

  hitterRows.push({
    player: r.player || r.playerName || r.name || null,
    team: r.team || null,
    market,
    side: r.side || r.pick || null,
    line: r.line ?? null,
    modelProb: mp,
    pfScore: pfs,
    bucket,
    sourceStatus: status || null
  });
}

const out = {
  date: DATE,
  sourceFile,
  hitterPfRows: hitterRows.length,
  bucketCounts: hitterRows.reduce((m, r) => {
    m[r.bucket] = (m[r.bucket] || 0) + 1;
    return m;
  }, {}),
  modelDisagrees: hitterRows.filter(r => r.bucket === "HITTER_MODEL_DISAGREES"),
  actionableWatch: hitterRows.filter(r => r.bucket === "HITTER_PF_ACTIONABLE_WATCH"),
  reviewWatch: hitterRows.filter(r => r.bucket === "HITTER_PF_REVIEW_WATCH"),
  missingModelProb: hitterRows.filter(r => r.bucket === "HITTER_PF_MODEL_PROB_MISSING")
};

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
fs.writeFileSync(OUT_LATEST, JSON.stringify(out, null, 2) + "\n");

console.log("HITTER PF MODEL DISAGREE AUDIT");
console.log("==============================");
console.log(JSON.stringify({
  date: out.date,
  sourceFile: out.sourceFile,
  hitterPfRows: out.hitterPfRows,
  bucketCounts: out.bucketCounts
}, null, 2));
console.log("MODEL DISAGREES");
for (const r of out.modelDisagrees.slice(0, 40)) {
  console.log(`${r.player} | ${r.market} ${r.side} ${r.line} | modelProb=${r.modelProb} | pfScore=${r.pfScore}`);
}
console.log(`saved: ${OUT}`);
