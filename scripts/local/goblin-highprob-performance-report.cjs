const fs = require("fs");

const HIST = "data/learning/goblin-highprob-history.json";
const OUT_JSON = "outputs/goblin-highprob-performance-report.json";
const OUT_TXT = "outputs/goblin-highprob-performance-report.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

const hist = readJson(HIST, { days: [] });
const legs = (hist.days || []).flatMap(d => d.legs || []);

function stat(list) {
  const graded = list.filter(x => x.result === "HIT" || x.result === "MISS");
  const hit = graded.filter(x => x.result === "HIT").length;
  const miss = graded.filter(x => x.result === "MISS").length;
  return {
    total: list.length,
    graded: graded.length,
    hit,
    miss,
    unmatched: list.filter(x => x.result === "UNMATCHED").length,
    hitRate: graded.length ? hit / graded.length : null,
    roiProxy: graded.length ? (hit - miss) / graded.length : null
  };
}

function groupBy(fn) {
  const m = {};
  for (const l of legs) {
    const k = fn(l);
    m[k] ||= [];
    m[k].push(l);
  }
  return Object.fromEntries(Object.entries(m).map(([k,v]) => [k, stat(v)]));
}

const byMarket = groupBy(l => `${l.market}|${l.side}`);
const byLine = groupBy(l => `${l.market}|${l.side}|${l.line}`);
const byPlayer = groupBy(l => `${l.player}|${l.market}|${l.side}|${l.line}`);
const bySize = groupBy(l => `${l.slipSize}`);

const summary = {
  generatedAt: new Date().toISOString(),
  days: (hist.days || []).length,
  legs: legs.length,
  overall: stat(legs),
  byMarket,
  byLine,
  bySize
};

fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, byPlayer }, null, 2) + "\n");

const lines = [];
lines.push("GOBLIN HIGH-PROB HIT/MISS PERFORMANCE");
lines.push("=====================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");

function print(title, obj, min = 1) {
  lines.push(title);
  lines.push("-".repeat(title.length));
  for (const [k,v] of Object.entries(obj)
    .filter(([,v]) => v.graded >= min)
    .sort((a,b) => {
      const ar = a[1].roiProxy ?? -999;
      const br = b[1].roiProxy ?? -999;
      return br - ar || b[1].graded - a[1].graded;
    })
    .slice(0,40)) {
    lines.push(`${k}: graded=${v.graded} hit=${v.hit} miss=${v.miss} unmatched=${v.unmatched} hitRate=${v.hitRate == null ? "n/a" : (v.hitRate*100).toFixed(1)+"%"} roi=${v.roiProxy == null ? "n/a" : (v.roiProxy*100).toFixed(1)+"%"}`);
  }
  lines.push("");
}

print("BEST MARKETS", byMarket, 1);
print("BEST LINE BUCKETS", byLine, 1);

lines.push("WORST MARKETS");
lines.push("-------------");
for (const [k,v] of Object.entries(byMarket)
  .filter(([,v]) => v.graded >= 1)
  .sort((a,b) => (a[1].roiProxy ?? 999) - (b[1].roiProxy ?? 999))
  .slice(0,40)) {
  lines.push(`${k}: graded=${v.graded} hit=${v.hit} miss=${v.miss} unmatched=${v.unmatched} hitRate=${v.hitRate == null ? "n/a" : (v.hitRate*100).toFixed(1)+"%"} roi=${v.roiProxy == null ? "n/a" : (v.roiProxy*100).toFixed(1)+"%"}`);
}

fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT_JSON);
console.log("saved:", OUT_TXT);
