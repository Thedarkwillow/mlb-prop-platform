const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function readJson(p, fallback = []) {
  try {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function pickInputFile(date) {
  const candidates = [
    `outputs/final-slips-${date}.json`,
    `outputs/playable-final-slips-${date}.json`,
    `outputs/slips-${date}.json`,
    "outputs/final-slips.json",
    "outputs/playable-final-slips.json",
    "outputs/slips.json"
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(`No grading input found for ${date}`);
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sideOf(r) {
  return String(r.side || r.recommendedSide || r.pick || "").toUpperCase().includes("LESS")
    ? "LESS"
    : "MORE";
}

function marketOf(r) {
  return norm(r.market || r.stat || r.pick || r.prop || "");
}

function playerOf(r) {
  return String(r.player || r.name || r.playerName || "").trim();
}

function flattenRows(input) {
  if (Array.isArray(input)) return input.flatMap(x => Array.isArray(x.legs) ? x.legs : [x]);
  if (Array.isArray(input.slips)) return input.slips.flatMap(s => s.legs || []);
  if (Array.isArray(input.legs)) return input.legs;
  if (Array.isArray(input.rows)) return input.rows;
  return [];
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || r.status || "").toUpperCase();
  if (["WIN", "WON", "HIT", "CASH", "GREEN"].includes(raw)) return "WIN";
  if (["LOSS", "LOST", "MISS", "RED"].includes(raw)) return "LOSS";
  return null;
}

function gradeRows(rows) {
  return rows.map(r => ({
    ...r,
    gradingDate: DATE,
    player: playerOf(r),
    market: marketOf(r),
    side: sideOf(r),
    result: resultOf(r),
  }));
}

function summarize(rows) {
  const graded = rows.filter(r => r.result === "WIN" || r.result === "LOSS");

  function groupBy(keyFn) {
    const out = {};
    for (const r of graded) {
      const k = keyFn(r);
      if (!out[k]) out[k] = { wins: 0, losses: 0, graded: 0, hitRate: null };
      if (r.result === "WIN") out[k].wins++;
      if (r.result === "LOSS") out[k].losses++;
      out[k].graded++;
    }
    for (const k of Object.keys(out)) {
      out[k].hitRate = out[k].graded ? Number((out[k].wins / out[k].graded).toFixed(4)) : null;
    }
    return out;
  }

  return {
    date: DATE,
    rawRows: rows.length,
    gradedRows: graded.length,
    unmatchedRows: rows.length - graded.length,
    overall: {
      wins: graded.filter(r => r.result === "WIN").length,
      losses: graded.filter(r => r.result === "LOSS").length,
      graded: graded.length,
      hitRate: graded.length
        ? Number((graded.filter(r => r.result === "WIN").length / graded.length).toFixed(4))
        : null
    },
    byMarket: groupBy(r => r.market),
    bySide: groupBy(r => r.side),
    byMarketSide: groupBy(r => `${r.market}_${r.side}`),
    byConfidence: groupBy(r => String(r.confidenceBucket || r.confidence || "unknown").toLowerCase()),
    byTeam: groupBy(r => String(r.team || "unknown").toUpperCase())
  };
}

function printSummary(summary, inputFile) {
  console.log(`Using input: ${path.resolve(inputFile)}`);
  console.log(`Grading date: ${summary.date}`);
  console.log("");
  console.log("ALL MARKET GRADING SUMMARY");
  console.log("--------------------------");
  console.log(`Raw rows: ${summary.rawRows}`);
  console.log(`Graded rows: ${summary.gradedRows}`);
  console.log(`Unmatched/excluded rows: ${summary.unmatchedRows}`);
  console.log("");
  console.log("Overall");
  console.log("-------");
  console.log(`ALL: ${summary.overall.wins}-${summary.overall.losses}-0 | graded=${summary.overall.graded} | hitRate=${(summary.overall.hitRate * 100).toFixed(1)}%`);
  console.log("");
  console.log("By Market + Side");
  console.log("----------------");
  for (const [k, v] of Object.entries(summary.byMarketSide)) {
    console.log(`${k}: ${v.wins}-${v.losses}-0 | graded=${v.graded} | hitRate=${(v.hitRate * 100).toFixed(1)}%`);
  }
}

const inputFile = pickInputFile(DATE);
const input = readJson(inputFile, []);
const rows = gradeRows(flattenRows(input));
const summary = summarize(rows);

writeJson("outputs/all-markets-graded.json", rows);
writeJson(`outputs/history/${DATE}-all-markets-graded.json`, rows);
writeJson("outputs/all-markets-summary.json", summary);
fs.writeFileSync(
  "outputs/all-markets-summary.txt",
  JSON.stringify(summary, null, 2) + "\n"
);

printSummary(summary, inputFile);

console.log("");
console.log("Wrote:");
console.log("outputs/all-markets-graded.json");
console.log(`outputs/history/${DATE}-all-markets-graded.json`);
console.log("outputs/all-markets-summary.json");
console.log("outputs/all-markets-summary.txt");
