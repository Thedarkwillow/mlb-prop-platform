const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const PRODUCTION = "outputs/production-candidates.json";
const OUT = `outputs/side-bias-override-watch-${date}.json`;
const LATEST = "outputs/side-bias-override-watch-latest.json";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function hasReason(row, text) {
  return Array.isArray(row.reasons) && row.reasons.some(r => String(r).includes(text));
}

const report = readJson(PRODUCTION, {});
const rows = Array.isArray(report.all) ? report.all : [];

const watch = rows
  .filter(r => {
    const prob = num(r.prob, 0);
    const edge = num(r.edge, 0);
    const books = num(r.books, 0);
    const grade = String(r.grade || "").toUpperCase();
    const support = String(r.support || "").toUpperCase();
    const sideBias = String(r.sideBias?.tier || "").toUpperCase();

    return (
      r.class === "BLOCKED" &&
      hasReason(r, "negative_side_bias") &&
      prob >= 0.58 &&
      edge >= 0.05 &&
      books >= 2 &&
      support === "OK" &&
      ["GREEN", "NEUTRAL"].includes(grade) &&
      ["NEGATIVE", "STRONG_NEGATIVE"].includes(sideBias)
    );
  })
  .sort((a, b) =>
    (num(b.prob, 0) - num(a.prob, 0)) ||
    (num(b.edge, 0) - num(a.edge, 0))
  );

const output = {
  date,
  generatedAt: new Date().toISOString(),
  source: PRODUCTION,
  purpose: "Track individually strong props blocked only by negative market-side bias. Report-only; not bettable yet.",
  criteria: {
    class: "BLOCKED",
    requiredReason: "negative_side_bias",
    minProb: 0.58,
    minEdge: 0.05,
    minBooks: 2,
    support: "OK",
    allowedGrades: ["GREEN", "NEUTRAL"],
    sideBias: ["NEGATIVE", "STRONG_NEGATIVE"]
  },
  count: watch.length,
  watch
};

writeJson(OUT, output);
writeJson(LATEST, output);

console.log("SIDE-BIAS OVERRIDE WATCH");
console.log("------------------------");
console.log("date:", date);
console.log("count:", watch.length);

console.table(watch.map(r => ({
  player: r.player,
  team: r.team,
  market: r.market,
  side: r.side,
  line: r.line,
  prob: r.prob,
  edge: r.edge,
  books: r.books,
  support: r.support,
  grade: r.grade,
  sideBias: r.sideBias?.tier,
  sideRoi: r.sideBias?.roi,
  reasons: r.reasons.join(", ")
})));

console.log("saved:", OUT);
console.log("saved:", LATEST);
