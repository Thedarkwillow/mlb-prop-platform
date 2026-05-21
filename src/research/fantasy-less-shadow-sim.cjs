const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function pct(n) {
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : null;
}

const report = readJson("outputs/fantasy-side-tracking.json", null);
if (!report || !Array.isArray(report.rows)) {
  throw new Error("Missing outputs/fantasy-side-tracking.json. Run npm run fantasy:sides first.");
}

const rows = report.rows.filter(r =>
  r.side === "LESS" &&
  r.syntheticInverse === true &&
  (r.result === "HIT" || r.result === "MISS" || r.result === "PUSH")
);

const byType = new Map();

for (const r of rows) {
  const key = r.type || "Fantasy Score";
  if (!byType.has(key)) byType.set(key, { type: key, plays: 0, hits: 0, misses: 0, pushes: 0 });
  const b = byType.get(key);
  b.plays++;
  if (r.result === "HIT") b.hits++;
  else if (r.result === "MISS") b.misses++;
  else if (r.result === "PUSH") b.pushes++;
}

const summary = [...byType.values()].map(x => {
  const graded = x.hits + x.misses;
  const hitRate = graded ? x.hits / graded : null;
  return {
    ...x,
    graded,
    hitRate,
    hitRatePct: pct(hitRate),
    shadowPlayable:
      graded >= 200 && hitRate >= 0.55 ? true :
      graded >= 50 && hitRate >= 0.58 ? "WATCH" :
      false
  };
});

const totalHits = rows.filter(r => r.result === "HIT").length;
const totalMisses = rows.filter(r => r.result === "MISS").length;
const totalPushes = rows.filter(r => r.result === "PUSH").length;
const totalGraded = totalHits + totalMisses;
const totalHitRate = totalGraded ? totalHits / totalGraded : null;

const out = {
  generatedAt: new Date().toISOString(),
  mode: "SHADOW_ONLY_DO_NOT_BET",
  policy: {
    fantasyLiveEnabled: false,
    reason: "Fantasy LESS is inferred from MORE grades. Track only until direct LESS sample exists."
  },
  total: {
    plays: rows.length,
    graded: totalGraded,
    hits: totalHits,
    misses: totalMisses,
    pushes: totalPushes,
    hitRate: totalHitRate,
    hitRatePct: pct(totalHitRate)
  },
  summary,
  rows
};

fs.writeFileSync("outputs/fantasy-less-shadow-sim.json", JSON.stringify(out, null, 2) + "\n");

console.log("FANTASY LESS SHADOW SIM");
console.log("=======================");
console.log(JSON.stringify(out.total, null, 2));
console.table(summary);
console.log("Policy:", out.policy);
console.log("Wrote outputs/fantasy-less-shadow-sim.json");
