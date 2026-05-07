// src/reports/hrr-performance.js

import fs from "fs";
import path from "path";
import {
  canonicalGameKey,
  isValidHrrRow
} from "../utils/canonical-game-key.js";

const CANDIDATE_FILES = [
  "data/graded-props.json",
  "data/results/graded-props.json",
  "data/hrr-tracker.json",
  "outputs/graded-props.json",
  "outputs/hrr-tracker.json",
  "graded-props.json",
  "hrr-tracker.json"
];

function findInputFile() {
  for (const f of CANDIDATE_FILES) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) return p;
  }

  const all = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/hrr|graded|result/i.test(name) && /\.json$/i.test(name)) all.push(p);
    }
  }

  walk(process.cwd());
  if (!all.length) return null;

  all.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return all[0];
}

function getResult(row) {
  const r = String(row.result || row.outcome || row.grade || "").toUpperCase();

  if (["WIN", "HIT", "WON", "CASH"].includes(r)) return "HIT";
  if (["LOSS", "MISS", "LOST"].includes(r)) return "MISS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";

  const actual = Number(row.actual ?? row.actualValue ?? row.final ?? row.resultValue);
  const line = Number(row.line);
  const direction = String(row.direction || row.side || "").toUpperCase();

  if (!Number.isFinite(actual) || !Number.isFinite(line)) return "UNGRADED";
  if (actual === line) return "PUSH";

  if (direction === "MORE" || direction === "OVER") return actual > line ? "HIT" : "MISS";
  if (direction === "LESS" || direction === "UNDER") return actual < line ? "HIT" : "MISS";

  return "UNGRADED";
}

function bucketProb(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 0.80) return "80%+";
  if (n >= 0.70) return "70-79%";
  if (n >= 0.60) return "60-69%";
  if (n >= 0.55) return "55-59%";
  return "<55%";
}

function addStat(map, key, result) {
  if (!map[key]) map[key] = { total: 0, hits: 0, misses: 0, pushes: 0, ungraded: 0 };
  map[key].total++;

  if (result === "HIT") map[key].hits++;
  else if (result === "MISS") map[key].misses++;
  else if (result === "PUSH") map[key].pushes++;
  else map[key].ungraded++;
}

function rate(s) {
  const denom = s.hits + s.misses;
  if (!denom) return "0.0%";
  return `${((s.hits / denom) * 100).toFixed(1)}%`;
}

function printGroup(title, group) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));

  for (const [k, s] of Object.entries(group)) {
    console.log(`${k}: ${s.hits}-${s.misses}-${s.pushes} | graded=${s.hits + s.misses} | hitRate=${rate(s)} | ungraded=${s.ungraded}`);
  }
}

function main() {
  const inputFile = findInputFile();

  if (!inputFile) {
    console.error("No HRR/graded JSON file found.");
    process.exit(1);
  }

  console.log(`Using input: ${inputFile}`);

  const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const rows = Array.isArray(raw)
    ? raw
    : raw.rows || raw.props || raw.data || raw.results || raw.legs || [];

  const hrrRaw = rows.filter(r => String(r.market || r.stat || "").toUpperCase() === "HRR");
  const valid = hrrRaw.filter(isValidHrrRow);
  const invalid = hrrRaw.filter(r => !isValidHrrRow(r));

  const overall = {};
  const byDirection = {};
  const byLine = {};
  const byConf = {};
  const byProb = {};
  const byGame = {};
  const byTeam = {};

  for (const row of valid) {
    const result = getResult(row);
    const key = canonicalGameKey(row);
    const direction = String(row.direction || row.side || "").toUpperCase();
    const line = String(row.line);
    const conf = String(row.confidence || row.conf || row.confidenceBucket || "unknown").toLowerCase();
    const prob = Number(row.prob ?? row.probability ?? row.recommendedProb);
    const team = String(row.team || "unknown").toUpperCase();

    addStat(overall, "HRR overall", result);
    addStat(byDirection, direction, result);
    addStat(byLine, line, result);
    addStat(byConf, conf, result);
    addStat(byProb, bucketProb(prob), result);
    addStat(byGame, key, result);
    addStat(byTeam, team, result);
  }

  console.log("\nHRR FILTER SUMMARY");
  console.log("------------------");
  console.log(`Raw HRR rows: ${hrrRaw.length}`);
  console.log(`Valid HRR rows: ${valid.length}`);
  console.log(`Invalid HRR rows excluded: ${invalid.length}`);

  printGroup("Overall", overall);
  printGroup("By Direction", byDirection);
  printGroup("By Line", byLine);
  printGroup("By Confidence", byConf);
  printGroup("By Probability Bucket", byProb);
  printGroup("By Game", byGame);
  printGroup("By Team", byTeam);

  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync("outputs/hrr-invalid-rows.json", JSON.stringify(invalid, null, 2));
  fs.writeFileSync("outputs/hrr-valid-rows.json", JSON.stringify(valid.map(r => ({ ...r, canonicalGameKey: canonicalGameKey(r) })), null, 2));

  console.log("\nWrote:");
  console.log("outputs/hrr-valid-rows.json");
  console.log("outputs/hrr-invalid-rows.json");
}

main();
