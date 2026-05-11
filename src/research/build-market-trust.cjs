const fs = require("fs");

const SOURCES = [
  "outputs/all-markets-graded.json",
  "outputs/fantasy-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/history/2026-05-04-all-markets-graded.json",
  "outputs/history/2026-05-04-hrr-graded.json",
  "outputs/history/2026-05-09-fantasy-grades.json",
  "outputs/history/2026-05-10-fantasy-grades.json"
];

function read(path) {
  if (!fs.existsSync(path)) return [];
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  return Array.isArray(data) ? data : data.rows || data.props || data.graded || [];
}

function normMarket(x) {
  const raw = String(x.market || x.stat || x.prop || "")
    .toLowerCase()
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");

  if (raw === "hitter fantasy score") return "hitter_fantasy_score";
  if (raw === "pitcher fantasy score") return "pitcher_fantasy_score";
  if (raw === "total bases") return "bases";
  if (raw === "pitcher strikeouts") return "strikeouts";
  if (raw === "earned runs allowed") return "earned_runs_allowed";
  if (raw === "hits allowed") return "hits_allowed";
  if (raw === "home runs") return "home_runs";
  if (raw === "rbis") return "rbis";
  if (raw === "runs") return "runs";
  if (raw === "hits+runs+rbis") return "hrr";

  return raw.replace(/\s+/g, "_");
}

function normSide(x) {
  return String(x.side || x.pickSide || x.recommendedSide || "").toUpperCase().trim();
}

function isWin(x) {
  const v = String(x.result || x.grade || x.outcome || x.status || "").toUpperCase();
  return ["WIN", "HIT", "W", "CASH"].includes(v);
}

function isLoss(x) {
  const v = String(x.result || x.grade || x.outcome || x.status || "").toUpperCase();
  return ["LOSS", "MISS", "L", "LOSE"].includes(v);
}

const buckets = new Map();

for (const path of SOURCES) {
  for (const row of read(path)) {
    const market = normMarket(row);
    const side = normSide(row);
    if (!market || !side) continue;

    const key = `${market}_${side}`;
    if (!buckets.has(key)) {
      buckets.set(key, { market, side, graded: 0, wins: 0, losses: 0 });
    }

    const b = buckets.get(key);
    if (isWin(row)) {
      b.graded++;
      b.wins++;
    } else if (isLoss(row)) {
      b.graded++;
      b.losses++;
    }
  }
}

const trust = [...buckets.values()]
  .map(b => {
    const hitRate = b.graded ? b.wins / b.graded : null;
    let trust = "UNKNOWN";
    let action = "ALLOW";

    if (b.graded >= 8 && hitRate < 0.45) {
      trust = "BAD";
      action = "SUPPRESS";
    } else if (b.graded >= 8 && hitRate < 0.50) {
      trust = "WEAK";
      action = "DOWNGRADE";
    } else if (b.graded >= 8 && hitRate >= 0.58) {
      trust = "STRONG";
      action = "ALLOW";
    } else if (b.graded >= 4) {
      trust = "WATCH";
      action = "ALLOW";
    }

    return {
      ...b,
      hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
      trust,
      action
    };
  })
  .sort((a, b) => b.graded - a.graded || String(a.market).localeCompare(String(b.market)));

fs.writeFileSync("outputs/market-trust.json", JSON.stringify(trust, null, 2) + "\n");

console.log("MARKET TRUST REPORT");
console.log("===================");
console.table(trust);
