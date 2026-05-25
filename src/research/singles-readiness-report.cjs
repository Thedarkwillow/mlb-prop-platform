const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD = "outputs/sportsbook-enriched-board.json";
const FULL_BOARD_GRADED = `outputs/history/${date}-full-board-graded.json`;
const OUT = `outputs/singles-readiness-report-${date}.json`;
const LATEST = "outputs/singles-readiness-report-latest.json";
const OUT_TXT = `outputs/singles-readiness-report-${date}.txt`;
const LATEST_TXT = "outputs/singles-readiness-report-latest.txt";

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

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function bucketLine(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n === 0.5) return "0.5";
  if (n >= 1.5) return "1.5+";
  return String(n);
}

function key(r) {
  return [
    r.player || "",
    r.market || "",
    r.side || "",
    String(r.line ?? "")
  ].join("|").toLowerCase();
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
  const hits = graded.filter(r => String(r.result || "").toUpperCase() === "HIT").length;
  const misses = graded.filter(r => String(r.result || "").toUpperCase() === "MISS").length;
  const pushes = graded.filter(r => String(r.result || "").toUpperCase() === "PUSH").length;
  const denom = hits + misses;
  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : null,
    roi: denom ? Number((((hits - misses) / denom)).toFixed(4)) : null
  };
}

function classifyBucket(summary, sample) {
  const side = String(sample.side || "").toUpperCase();
  const lineBucket = bucketLine(sample.line);
  const synthetic = Boolean(sample.sportsbookSynthetic);
  const source = sample.sportsbookSyntheticSource || "none";
  const matchType = sample.sportsbookMatchType || "none";

  if (lineBucket === "1.5+") {
    return {
      status: "RESEARCH_ONLY",
      reason: "singles_1.5_plus_is_not_safe_with_hits_0.5_proxy"
    };
  }

  if (lineBucket === "0.5" && synthetic && source === "hits_0.5") {
    if (matchType === "EXACT_LINE") {
      return {
        status: "TRACKABLE_SYNTHETIC",
        reason: "singles_0.5_can_use_hits_0.5_as_related_proxy_but_not_core"
      };
    }
    return {
      status: "TRACKABLE_WEAK_SYNTHETIC",
      reason: "singles_0.5_related_to_hits_0.5_but_match_is_not_exact"
    };
  }

  if (lineBucket === "0.5" && !synthetic && sample.sportsbookMatch) {
    if (summary.graded >= 100 && summary.hitRate >= 0.55 && summary.roi >= 0.08) {
      return {
        status: "ACTIONABLE_LEAN_READY",
        reason: "real_price_sample_passed_minimum_lean_threshold"
      };
    }
    return {
      status: "TRACK_ONLY_REAL_PRICE",
      reason: "real_price_available_but_not_enough_grade_proof"
    };
  }

  if (side === "MORE" && summary.graded >= 50 && summary.roi !== null && summary.roi < -0.05) {
    return {
      status: "SUPPRESS",
      reason: "negative_roi_with_50_plus_graded"
    };
  }

  return {
    status: "TRACK_ONLY",
    reason: "insufficient_real_support_or_grade_sample"
  };
}

const board = readJson(BOARD, []);
const graded = readJson(FULL_BOARD_GRADED, []);

const singlesRows = board.filter(r => String(r.market || "").toLowerCase() === "singles");
const gradedSingles = graded.filter(r => String(r.market || "").toLowerCase() === "singles");

const gradedByKey = new Map();
for (const r of gradedSingles) {
  gradedByKey.set(key(r), r);
}

const enriched = singlesRows.map(r => {
  const g = gradedByKey.get(key(r));
  return {
    ...r,
    result: g?.result || null,
    actual: g?.actual ?? null
  };
});

const groups = new Map();
for (const r of enriched) {
  const k = [
    String(r.side || "").toUpperCase(),
    bucketLine(r.line),
    r.sportsbookSynthetic ? "synthetic" : "real_or_unmatched",
    r.sportsbookSyntheticSource || "none",
    r.sportsbookMatchType || "none"
  ].join(" | ");
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const buckets = [...groups.entries()]
  .map(([bucket, rows]) => {
    const summary = summarize(rows);
    const sample = rows[0] || {};
    const classification = classifyBucket(summary, sample);
    return {
      bucket,
      side: String(sample.side || "").toUpperCase(),
      lineBucket: bucketLine(sample.line),
      synthetic: Boolean(sample.sportsbookSynthetic),
      source: sample.sportsbookSyntheticSource || "none",
      matchType: sample.sportsbookMatchType || "none",
      sportsbookMatched: rows.filter(r => r.sportsbookMatch).length,
      avgEdge: (() => {
        const vals = rows.map(r => num(r.sportsbookAdjustedEdge, null)).filter(v => v !== null);
        return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : null;
      })(),
      ...summary,
      status: classification.status,
      reason: classification.reason
    };
  })
  .sort((a, b) =>
    (a.lineBucket === "0.5" ? -1 : 1) - (b.lineBucket === "0.5" ? -1 : 1) ||
    String(a.side).localeCompare(String(b.side)) ||
    (b.graded - a.graded)
  );

const candidates05 = enriched
  .filter(r => bucketLine(r.line) === "0.5")
  .map(r => ({
    player: r.player,
    team: r.team,
    market: r.market,
    side: r.side,
    line: r.line,
    oddsTier: r.oddsTier,
    sportsbookMatch: r.sportsbookMatch,
    synthetic: r.sportsbookSynthetic,
    source: r.sportsbookSyntheticSource,
    matchType: r.sportsbookMatchType,
    books: r.sportsbookBookCount,
    edge: r.sportsbookAdjustedEdge ?? r.sportsbookEdge,
    support: r.marketSupportFlag,
    grade: r.qualityGrade,
    result: r.result,
    actual: r.actual
  }))
  .sort((a, b) => (num(b.edge, -999) - num(a.edge, -999)));

const output = {
  date,
  generatedAt: new Date().toISOString(),
  source: {
    board: BOARD,
    graded: FULL_BOARD_GRADED
  },
  rule: {
    singles05: "TRACKABLE synthetic proxy if source is hits_0.5, but not CORE until grading proves it.",
    singles15Plus: "RESEARCH_ONLY when using hits_0.5 or nearest-line proxy.",
    official: "No singles official plays until real support or validated bucket proof."
  },
  totals: {
    boardSingles: singlesRows.length,
    gradedSingles: gradedSingles.length
  },
  buckets,
  candidates05
};

const lines = [];
lines.push("SINGLES READINESS REPORT");
lines.push("========================");
lines.push(`date: ${date}`);
lines.push(`board singles: ${singlesRows.length}`);
lines.push(`graded singles: ${gradedSingles.length}`);
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push("singles 0.5 = trackable synthetic proxy, not CORE");
lines.push("singles 1.5+ = research only when sourced from hits 0.5 / nearest-line");
lines.push("");
lines.push("BUCKETS");
lines.push("-------");
for (const b of buckets) {
  lines.push(`${b.status} | ${b.bucket} | rows=${b.rows} | graded=${b.graded} | hitRate=${b.hitRate} | roi=${b.roi} | avgEdge=${b.avgEdge} | ${b.reason}`);
}
lines.push("");
lines.push("SINGLES 0.5 SAMPLE");
lines.push("------------------");
for (const r of candidates05.slice(0, 25)) {
  lines.push(`- ${r.player} | ${r.team || "?"} | ${r.side} ${r.line} | ${r.oddsTier || "?"} | edge=${r.edge ?? "n/a"} | books=${r.books ?? "n/a"} | support=${r.support || "n/a"} | grade=${r.grade || "n/a"} | source=${r.source || "none"} | match=${r.matchType || "none"}`);
}

writeJson(OUT, output);
writeJson(LATEST, output);
writeText(OUT_TXT, lines.join("\n"));
writeText(LATEST_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("saved:", OUT);
console.log("saved:", LATEST);
console.log("saved:", OUT_TXT);
console.log("saved:", LATEST_TXT);
