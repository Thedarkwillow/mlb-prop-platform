const fs = require("fs");

function readJson(p, fallback) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sideOf(r) {
  return String(r.side || r.recommendedSide || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function marketOf(r) {
  return norm(r.market || r.stat || r.statKey);
}

function gradeOf(r) {
  const q = String(r.qualityGrade || "").toUpperCase();
  const cb = String(r.confidenceBucket || "").toUpperCase();
  const support = String(r.marketSupportFlag || "").toUpperCase();

  const books = Number(r.sportsbookBookCount || r.books || 0);
  if (support === "LOW_BOOK_SUPPORT" && books < 3) return "NEUTRAL";
  if (["ELITE", "STRONG"].includes(cb) && !["PASS"].includes(cb)) return "GREEN";
  if (["PLAYABLE", "LEAN"].includes(cb)) return "NEUTRAL";
  if (q === "UNKNOWN" && ["ELITE", "STRONG"].includes(cb)) return "GREEN";
  return "PASS";
}

function isPlayable(r) {
  const status = String(r.pricingStatus || r.status || "").toUpperCase();
  const grade = gradeOf(r);
  const hasSide = String(r.side || r.recommendedSide || "").trim();
  const hasMarket = marketOf(r);
  return (
    status === "PRICED" &&
    hasSide &&
    hasMarket &&
    !["FADE", "SUPPRESSED", "RED", "PASS"].includes(grade)
  );
}

const board = readJson("outputs/sportsbook-enriched-board.json", []);
const rows = Array.isArray(board) ? board : Array.isArray(board.rows) ? board.rows : [];

const playable = rows.filter(isPlayable);
const green = playable.filter(r => gradeOf(r) === "GREEN");
const neutral = playable.filter(r => gradeOf(r) === "NEUTRAL");

const byMarketSide = {};
const byMarket = {};
const byTeam = {};

for (const r of playable) {
  const ms = `${marketOf(r)}_${sideOf(r)}`;
  const m = marketOf(r);
  const t = String(r.team || r.playerTeam || "").toUpperCase();

  byMarketSide[ms] = (byMarketSide[ms] || 0) + 1;
  byMarket[m] = (byMarket[m] || 0) + 1;
  if (t) byTeam[t] = (byTeam[t] || 0) + 1;
}

function topShare(obj) {
  const vals = Object.values(obj);
  if (!vals.length || !playable.length) return 0;
  return Math.max(...vals) / playable.length;
}

const marketSideShare = topShare(byMarketSide);
const marketShare = topShare(byMarket);
const teamShare = topShare(byTeam);
const greenRate = playable.length ? green.length / playable.length : 0;
const neutralRate = playable.length ? neutral.length / playable.length : 0;

let riskLevel = "NORMAL";
let maxSlipSize = 6;
let scoreMultiplier = 1;
let maxSameMarket = 3;
let maxSameSidePct = 0.85;
const reasons = [];

if (playable.length < 40) {
  riskLevel = "THIN_BOARD";
  maxSlipSize = Math.min(maxSlipSize, 4);
  scoreMultiplier *= 0.9;
  reasons.push("thin playable board");
}

if (greenRate < 0.45) {
  riskLevel = "WEAK_BOARD";
  maxSlipSize = Math.min(maxSlipSize, 3);
  scoreMultiplier *= 0.75;
  reasons.push("low green rate");
}

if (neutralRate > 0.35) {
  riskLevel = "NEUTRAL_HEAVY";
  maxSlipSize = Math.min(maxSlipSize, 4);
  scoreMultiplier *= 0.85;
  reasons.push("neutral-heavy board");
}

if (marketSideShare > 0.45 || marketShare > 0.55) {
  riskLevel = "CONCENTRATED";
  maxSlipSize = Math.min(maxSlipSize, 4);
  maxSameMarket = 2;
  maxSameSidePct = 0.7;
  scoreMultiplier *= 0.85;
  reasons.push("market concentration");
}

if (teamShare > 0.18) {
  riskLevel = "TEAM_CONCENTRATED";
  maxSlipSize = Math.min(maxSlipSize, 4);
  scoreMultiplier *= 0.9;
  reasons.push("team concentration");
}

const out = {
  createdAt: new Date().toISOString(),
  playableRows: playable.length,
  greenRows: green.length,
  neutralRows: neutral.length,
  greenRate: +greenRate.toFixed(4),
  neutralRate: +neutralRate.toFixed(4),
  marketSideShare: +marketSideShare.toFixed(4),
  marketShare: +marketShare.toFixed(4),
  teamShare: +teamShare.toFixed(4),
  riskLevel,
  reasons,
  governor: {
    maxSlipSize,
    scoreMultiplier: +scoreMultiplier.toFixed(4),
    maxSameMarket,
    maxSameSidePct
  },
  byMarketSide,
  byMarket,
  byTeam
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/phase6-exposure-governor.json", JSON.stringify(out, null, 2));

console.log("PHASE 6 EXPOSURE GOVERNOR BUILT");
console.table([{
  playable: out.playableRows,
  greenRate: out.greenRate,
  neutralRate: out.neutralRate,
  marketSideShare: out.marketSideShare,
  teamShare: out.teamShare,
  riskLevel: out.riskLevel,
  maxSlipSize: out.governor.maxSlipSize,
  scoreMultiplier: out.governor.scoreMultiplier,
  maxSameMarket: out.governor.maxSameMarket,
  maxSameSidePct: out.governor.maxSameSidePct,
  reasons: out.reasons.join(", ")
}]);
