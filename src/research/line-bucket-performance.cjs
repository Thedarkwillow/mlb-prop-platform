const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function lineBucket(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 0.5) return "<=0.5";
  if (n <= 1.5) return "<=1.5";
  if (n <= 2.5) return "<=2.5";
  if (n <= 3.5) return "<=3.5";
  if (n <= 4.5) return "<=4.5";
  if (n <= 5.5) return "<=5.5";
  if (n <= 6.5) return "<=6.5";
  return "7+";
}

function payoutForSlip(size, result) {
  if (result !== "HIT") return -1;
  if (size === 2) return 3 - 1;
  if (size === 3) return 5 - 1;
  if (size === 4) return 10 - 1;
  if (size === 5) return 20 - 1;
  if (size === 6) return 37.5 - 1;
  return 0;
}

const files = fs.readdirSync("outputs")
  .filter(f => /^playable-final-slips-graded-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort();

const buckets = {};

for (const file of files) {
  const report = readJson(`outputs/${file}`, null);
  if (!report?.slips) continue;

  for (const slip of report.slips) {
    const slipResult = slip.graded?.result || slip.result;
    const slipPayout = payoutForSlip(Number(slip.size), slipResult);

    for (const leg of slip.legs || []) {
      const market = norm(leg.market);
      const side = String(leg.side || "").toUpperCase();
      const bucket = lineBucket(leg.line);
      const key = `${market}|${side}|${bucket}`;

      if (!buckets[key]) {
        buckets[key] = {
          market,
          side,
          lineBucket: bucket,
          legs: 0,
          hits: 0,
          misses: 0,
          pushes: 0,
          unknown: 0,
          slipSamples: 0,
          slipProfit: 0,
          examples: []
        };
      }

      const b = buckets[key];
      b.legs++;

      const result = leg.result || leg.gradeResult || leg.outcome || "UNKNOWN";
      if (result === "HIT") b.hits++;
      else if (result === "MISS") b.misses++;
      else if (result === "PUSH") b.pushes++;
      else b.unknown++;

      if (Number.isFinite(slipPayout)) {
        b.slipSamples++;
        b.slipProfit += slipPayout;
      }

      if (b.examples.length < 5) {
        b.examples.push({
          date: report.date,
          player: leg.player,
          market: leg.market,
          side: leg.side,
          line: leg.line,
          result
        });
      }
    }
  }
}

const rows = Object.values(buckets).map(b => {
  const decided = b.hits + b.misses;
  const hitRate = decided ? b.hits / decided : null;
  const roi = b.slipSamples ? b.slipProfit / b.slipSamples : null;

  let action = "TRACK";
  if (decided >= 10 && hitRate < 0.52) action = "SUPPRESS";
  else if (decided >= 10 && hitRate >= 0.60) action = "BOOST";
  else if (decided >= 5 && hitRate < 0.45) action = "WATCH_SUPPRESS";
  else if (decided >= 5 && hitRate >= 0.65) action = "WATCH_BOOST";

  return {
    ...b,
    decided,
    hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
    roi: roi == null ? null : Number(roi.toFixed(4)),
    action
  };
}).sort((a, b) =>
  a.market.localeCompare(b.market) ||
  a.side.localeCompare(b.side) ||
  a.lineBucket.localeCompare(b.lineBucket)
);

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/line-bucket-performance.json", JSON.stringify(rows, null, 2));
fs.writeFileSync("outputs/line-bucket-performance.json", JSON.stringify(rows, null, 2));

console.log("LINE BUCKET PERFORMANCE");
console.log("=======================");
console.table(rows.map(r => ({
  market: r.market,
  side: r.side,
  lineBucket: r.lineBucket,
  decided: r.decided,
  hitRate: r.hitRate,
  roi: r.roi,
  action: r.action
})));
console.log("Wrote data/learning/line-bucket-performance.json");
console.log("Wrote outputs/line-bucket-performance.json");
