const fs = require("fs");
const path = require("path");

const OUT_JSON = "outputs/goblin-hrr-performance-report.json";
const OUT_TXT = "outputs/goblin-hrr-performance-report.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.market || v.stat || v.result || v.outcome) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function market(v) {
  const t = String(v || "").toLowerCase();
  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  return t.replace(/[^a-z0-9]+/g, "_");
}

function side(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return s;
}

function tier(r) {
  const blob = JSON.stringify([
    r.oddsTier, r.tier, r.specialTier, r.pickType, r.raw?.oddsTier, r.raw?.tier
  ]).toLowerCase();
  if (blob.includes("goblin")) return "goblin";
  if (blob.includes("demon")) return "demon";
  if (blob.includes("standard")) return "standard";
  return "";
}

function result(r) {
  const raw = String(r.result || r.outcome || r.gradeResult || r.status || "").toUpperCase();
  if (["HIT","WIN","WON"].includes(raw)) return "HIT";
  if (["MISS","LOSS","LOST"].includes(raw)) return "MISS";
  if (["PUSH","TIE"].includes(raw)) return "PUSH";
  if (["REFUND","DNP","VOID"].includes(raw)) return "REFUND";
  if (r.hit === true) return "HIT";
  if (r.hit === false) return "MISS";
  return raw || "UNKNOWN";
}

const files = [];
for (const dir of ["outputs/history"]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json") && /graded|history|decision|full-board|high/i.test(f)) {
      files.push(path.join(dir, f));
    }
  }
}
for (const f of [
  "data/results/graded-leg-history.json",
  "data/results/full-board-history.json",
  "data/results/prizepicks-board-history.json"
]) {
  if (fs.existsSync(f)) files.push(f);
}

const rows = [];
for (const f of files) {
  const data = readJson(f, null);
  for (const r of flatten(data)) {
    if (market(r.market || r.stat || r.projectionType) !== "hrr") continue;
    if (tier(r) !== "goblin") continue;
    rows.push({ ...r, sourceFile: f, _result: result(r), _side: side(r.side || r.recommendedSide) });
  }
}

function bucket(list) {
  const graded = list.filter(r => ["HIT","MISS"].includes(r._result));
  const hit = graded.filter(r => r._result === "HIT").length;
  const miss = graded.filter(r => r._result === "MISS").length;
  return {
    total: list.length,
    graded: graded.length,
    hit,
    miss,
    unmatched: list.filter(r => r._result === "UNMATCHED" || r._result === "UNKNOWN").length,
    hitRate: graded.length ? hit / graded.length : null,
    roiProxy: graded.length ? (hit - miss) / graded.length : null
  };
}

const bySide = {};
for (const s of ["MORE","LESS",""]) bySide[s || "UNKNOWN"] = bucket(rows.filter(r => r._side === s));

const byLine = {};
for (const r of rows) {
  const k = `${r._side || "UNKNOWN"} ${r.line ?? "?"}`;
  byLine[k] ||= [];
  byLine[k].push(r);
}
const byLineSummary = Object.fromEntries(Object.entries(byLine).map(([k,v]) => [k, bucket(v)]));

const summary = {
  generatedAt: new Date().toISOString(),
  filesChecked: files.length,
  rows: rows.length,
  overall: bucket(rows),
  bySide,
  byLine: byLineSummary
};

fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows: rows.slice(0, 5000) }, null, 2) + "\n");

const lines = [];
lines.push("GOBLIN HRR PERFORMANCE REPORT");
lines.push("=============================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");
lines.push("Top HRR line buckets:");
for (const [k,v] of Object.entries(byLineSummary).sort((a,b) => (b[1].graded||0)-(a[1].graded||0)).slice(0,30)) {
  lines.push(`${k}: graded=${v.graded} hitRate=${v.hitRate == null ? "n/a" : (v.hitRate*100).toFixed(1)+"%"} roi=${v.roiProxy == null ? "n/a" : (v.roiProxy*100).toFixed(1)+"%"}`);
}
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT_JSON);
console.log("saved:", OUT_TXT);
