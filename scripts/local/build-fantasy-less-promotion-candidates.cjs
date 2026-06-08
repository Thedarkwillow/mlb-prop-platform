const fs = require("fs");
const path = require("path");
const { canonicalPropRow } = require("../../src/shared/canonical-prop-row.cjs");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const GATE = "outputs/fantasy-less-promotion-gate.json";
const SOURCES = [
  `outputs/history/${DATE}-fantasy-less-watchlist.json`,
  "outputs/fantasy-less-watchlist.json",
  `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.json`
];

const OUT = "outputs/fantasy-less-promotion-candidates.json";
const TXT = "outputs/fantasy-less-promotion-candidates.txt";
const HIST_OUT = `outputs/history/${DATE}-fantasy-less-promotion-candidates.json`;
const HIST_TXT = `outputs/history/${DATE}-fantasy-less-promotion-candidates.txt`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function normMarket(v) {
  return s(v)
    .toLowerCase()
    .replace(/hitter fantasy score/g, "hitter_fantasy_score")
    .replace(/pitcher fantasy score/g, "pitcher_fantasy_score")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}

function team(r) {
  return s(r.team || r.teamAbbr || r.playerTeam || r.homeTeam || r.awayTeam);
}

function game(r) {
  return s(r.game || r.matchup || r.gameLabel || r.event || r.contest || r.canonical?.game);
}

function market(r) {
  return normMarket(r.market || r.statType || r.projectionType || r.stat || r.canonical?.market);
}

function side(r) {
  return s(r.side || r.pick || r.direction || r.selection || r.canonical?.side || "LESS").toUpperCase();
}

function line(r) {
  return n(r.line ?? r.statValue ?? r.value ?? r.projectionLine ?? r.canonical?.line);
}

function probability(r) {
  return n(r.probability ?? r.prob ?? r.underProb ?? r.canonical?.probability);
}

function actual(r) {
  return n(r.actual ?? r.actualValue ?? r.finalScore ?? r.score ?? r.fantasyScore);
}

function result(r) {
  return s(r.result || r.outcome || r.grade).toLowerCase();
}

function lineBucket(x) {
  if (x === null) return "unknown";
  if (x >= 4.5 && x <= 5.5) return "4.5_5.5";
  if (x >= 6.5 && x <= 8.5) return "6.5_8.5";
  if (x >= 9.5 && x <= 12.5) return "9.5_12.5";
  if (x >= 13.5 && x <= 20.5) return "13.5_20.5";
  if (x >= 21.5) return "21.5_plus";
  return "other";
}

function flat(v, out = [], pathName = "root") {
  if (!v) return out;

  if (Array.isArray(v)) {
    v.forEach((x, i) => flat(x, out, `${pathName}[${i}]`));
    return out;
  }

  if (typeof v !== "object") return out;

  if (
    player(v) ||
    market(v) ||
    v.result !== undefined ||
    v.actual !== undefined ||
    v.actualValue !== undefined
  ) {
    out.push({ row: v, path: pathName });
  }

  for (const [k, val] of Object.entries(v)) {
    if (k === "canonical") continue;
    if (val && typeof val === "object") flat(val, out, `${pathName}.${k}`);
  }

  return out;
}

function gateDecision(gateData, targetBucket) {
  const entries = flat(gateData);
  for (const e of entries) {
    const r = e.row || {};
    const b = s(r.bucket || r.lineBucket || r.key);
    const d = s(r.decision || r.status).toUpperCase();
    if (b === targetBucket && d === "PROMOTION_REVIEW") {
      return {
        decision: "PROMOTION_REVIEW",
        source: e.path,
        reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : ["gate_bucket_passed"],
        raw: r
      };
    }
  }

  const txt = JSON.stringify(gateData || {});
  if (
    txt.includes("hitter_fantasy_score|9.5_12.5") &&
    txt.includes("PROMOTION_REVIEW")
  ) {
    return {
      decision: "PROMOTION_REVIEW",
      source: "text_search",
      reasons: ["gate_bucket_passed"],
      raw: null
    };
  }

  return {
    decision: "RESEARCH_ONLY",
    source: "not_found",
    reasons: ["fantasy_less_bucket_not_promoted"],
    raw: null
  };
}

function firstExistingSource() {
  for (const file of SOURCES) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const gate = readJson(GATE, {});
const targetBucket = "hitter_fantasy_score|9.5_12.5";
const gateStatus = gateDecision(gate, targetBucket);
const sourceFile = firstExistingSource();
const sourceData = sourceFile ? readJson(sourceFile, []) : [];
const rows = flat(sourceData);

const eligible = [];
const blocked = [];

for (const item of rows) {
  const r = item.row;
  const m = market(r);
  const sd = side(r);
  const ln = line(r);
  const lb = lineBucket(ln);
  const p = player(r);

  if (!p || m !== "hitter_fantasy_score") continue;

  const reasons = [];

  if (sd !== "LESS") reasons.push(`side_not_less:${sd || "missing"}`);
  if (lb !== "9.5_12.5") reasons.push(`line_bucket_not_promoted:${lb}`);
  if (gateStatus.decision !== "PROMOTION_REVIEW") {
    reasons.push(`gate_not_promoted:${gateStatus.decision}`);
    for (const x of gateStatus.reasons || []) reasons.push(`gate_reason:${x}`);
  }

  const canonical = canonicalPropRow(r, {
    source: sourceFile || "fantasy_less_promotion_candidates",
    modelVersion: "canonical_v1"
  });

  canonical.market = "hitter_fantasy_score";
  canonical.side = "LESS";
  canonical.line = ln;
  canonical.player = p;
  canonical.team = team(r) || canonical.team || "";
  canonical.game = game(r) || canonical.game || "UNKNOWN_GAME";
  canonical.probability = probability(r);
  canonical.finalScore = actual(r);
  canonical.sampleStatus = reasons.length ? "FANTASY_LESS_RESEARCH_SAMPLE" : "FANTASY_LESS_PROMOTION_SAMPLE";
  canonical.lineupStatus = canonical.lineupStatus || "LINEUP_CONTEXT_PARTIAL";
  canonical.riskStatus = reasons.length ? "FANTASY_LESS_RESEARCH_ONLY" : "FANTASY_LESS_PROMOTION_REVIEW";
  canonical.reasonCodes = Array.from(new Set([
    ...(Array.isArray(canonical.reasonCodes) ? canonical.reasonCodes : []),
    `fantasy_less_bucket:${lb}`,
    `gate:${gateStatus.decision}`,
    ...(reasons.length ? reasons : ["eligible:hitter_fantasy_less_9_5_12_5"])
  ]));

  const outRow = {
    lane: "fantasy_less_hitter_9_5_12_5",
    date: DATE,
    player: p,
    team: canonical.team,
    game: canonical.game,
    market: "hitter_fantasy_score",
    side: "LESS",
    line: ln,
    probability: probability(r),
    actual: actual(r),
    result: result(r),
    lineBucket: lb,
    sourcePath: item.path,
    sourceFile,
    gateDecision: gateStatus.decision,
    blockedReasons: reasons,
    canonical,
    original: r
  };

  if (reasons.length) blocked.push(outRow);
  else eligible.push(outRow);
}

eligible.sort((a, b) => {
  const ap = Number(a.probability || 0);
  const bp = Number(b.probability || 0);
  if (bp !== ap) return bp - ap;
  return String(a.player).localeCompare(String(b.player));
});

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  gateFile: GATE,
  sourceFile,
  targetBucket,
  gateDecision: gateStatus.decision,
  gateReasons: gateStatus.reasons,
  rowsScanned: rows.length,
  eligible: eligible.length,
  blocked: blocked.length,
  eligibleRows: eligible,
  blockedSample: blocked.slice(0, 75)
};

const lines = [];
lines.push("FANTASY LESS PROMOTION CANDIDATES");
lines.push("=================================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`gateDecision=${report.gateDecision}`);
lines.push(`gateReasons=${report.gateReasons.join(", ")}`);
lines.push(`sourceFile=${sourceFile || "missing"}`);
lines.push(`targetBucket=${targetBucket}`);
lines.push(`eligible=${eligible.length}`);
lines.push(`blocked=${blocked.length}`);
lines.push("");
lines.push("ELIGIBLE SAMPLE");
lines.push("---------------");
if (!eligible.length) {
  lines.push("none");
} else {
  for (const r of eligible.slice(0, 40)) {
    lines.push(`${r.player} | ${r.team} | ${r.game} | ${r.market} ${r.side} ${r.line} | prob=${r.probability ?? "?"} | actual=${r.actual ?? "?"} | result=${r.result || "ungraded"}`);
  }
}
lines.push("");
lines.push("TOP BLOCKED");
lines.push("-----------");
for (const r of blocked.slice(0, 40)) {
  lines.push(`${r.player} | ${r.market} ${r.side} ${r.line} | bucket=${r.lineBucket} | ${r.blockedReasons.join(", ")}`);
}

writeJson(OUT, report);
writeText(TXT, lines.join("\n") + "\n");
writeJson(HIST_OUT, report);
writeText(HIST_TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: report.generatedAt,
  date: DATE,
  gateDecision: report.gateDecision,
  sourceFile,
  rowsScanned: rows.length,
  eligible: eligible.length,
  blocked: blocked.length,
  out: OUT
});
