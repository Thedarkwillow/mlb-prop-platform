const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  pricedBoard: "outputs/priced-board.json",
  out: `outputs/fantasy-side-coverage-${date}.json`,
  latest: "outputs/fantasy-side-coverage-latest.json",
  txt: `outputs/fantasy-side-coverage-${date}.txt`,
  latestTxt: "outputs/fantasy-side-coverage-latest.txt"
};

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

function norm(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function upper(v) {
  return norm(v).toUpperCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function isFantasy(row) {
  const raw = lower(row.market ?? row.stat ?? row.type ?? row.statType ?? "");
  return raw.includes("fantasy");
}

function marketOf(row) {
  const raw = lower(row.market ?? row.stat ?? row.type ?? row.statType ?? "");
  if (raw.includes("pitcher") && raw.includes("fantasy")) return "pitcher_fantasy_score";
  if (raw.includes("hitter") && raw.includes("fantasy")) return "hitter_fantasy_score";
  if (raw.includes("fantasy")) return "fantasy_score";
  return raw || "unknown";
}

function sideOf(row) {
  const raw = upper(
    row.side ??
    row.recommendedSide ??
    row.direction ??
    row.pick ??
    row.projectionSide ??
    row.recommendation ??
    ""
  );

  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  if (raw === "MORE" || raw === "LESS") return raw;
  return "SIDE_UNKNOWN";
}

function tierOf(row) {
  return lower(row.oddsTier ?? row.specialTier ?? row.tier ?? "standard") || "standard";
}

function hasUsableProjection(row) {
  const projection = num(row.projection ?? row.projectedValue ?? row.meanProjection, null);
  const prob = num(row.recommendedProb ?? row.prob ?? row.pickProb, null);
  const ev = num(row.expectedValue ?? row.edge ?? row.ev, null);

  return (
    projection !== null &&
    projection !== 0 &&
    (prob !== null || ev !== null)
  );
}

function group(rows, keyFn) {
  const m = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(row);
  }

  return [...m.entries()]
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      pctOfFantasy: rows.length
    }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function summarize(rows) {
  const total = rows.length;
  const usable = rows.filter(r => sideOf(r) !== "SIDE_UNKNOWN").length;
  const unknown = rows.filter(r => sideOf(r) === "SIDE_UNKNOWN").length;
  const unknownWithProjection = rows.filter(r => sideOf(r) === "SIDE_UNKNOWN" && hasUsableProjection(r)).length;
  const unknownNoProjection = rows.filter(r => sideOf(r) === "SIDE_UNKNOWN" && !hasUsableProjection(r)).length;

  return {
    total,
    usableRecommended: usable,
    sideUnknown: unknown,
    sideUnknownWithUsableProjection: unknownWithProjection,
    sideUnknownNoUsableProjection: unknownNoProjection,
    usableRate: total ? Number((usable / total).toFixed(4)) : null,
    unknownRate: total ? Number((unknown / total).toFixed(4)) : null
  };
}

const pricedBoard = readJson(FILES.pricedBoard, []);
const fantasyRows = (Array.isArray(pricedBoard) ? pricedBoard : [])
  .filter(isFantasy);

const summary = summarize(fantasyRows);

const bySide = group(fantasyRows, r => sideOf(r)).map(x => ({
  ...x,
  pctOfFantasy: summary.total ? Number((x.count / summary.total).toFixed(4)) : null
}));

const byTier = group(fantasyRows, r => tierOf(r)).map(x => ({
  ...x,
  pctOfFantasy: summary.total ? Number((x.count / summary.total).toFixed(4)) : null
}));

const bySideTier = group(fantasyRows, r => `${sideOf(r)} | ${tierOf(r)}`).map(x => ({
  ...x,
  pctOfFantasy: summary.total ? Number((x.count / summary.total).toFixed(4)) : null
}));

const byMarketSideTier = group(fantasyRows, r => `${marketOf(r)} | ${sideOf(r)} | ${tierOf(r)}`).map(x => ({
  ...x,
  pctOfFantasy: summary.total ? Number((x.count / summary.total).toFixed(4)) : null
}));

const unknownExamples = fantasyRows
  .filter(r => sideOf(r) === "SIDE_UNKNOWN")
  .slice(0, 25)
  .map(r => ({
    player: r.player ?? null,
    team: r.team ?? r.playerTeam ?? null,
    market: marketOf(r),
    stat: r.stat ?? null,
    line: r.line ?? null,
    oddsTier: tierOf(r),
    projection: r.projection ?? null,
    recommendedProb: r.recommendedProb ?? null,
    expectedValue: r.expectedValue ?? null,
    reason: hasUsableProjection(r)
      ? "side_unknown_but_projection_available"
      : "side_unknown_no_usable_projection"
  }));

const report = {
  date,
  generatedAt: new Date().toISOString(),
  source: FILES.pricedBoard,
  policy: {
    sideUnknownHandling: "Do not infer side unless a real model recommendation or usable non-zero projection exists.",
    playable: false,
    note: "SIDE_UNKNOWN fantasy rows remain track-unusable until upstream projection/recommendation exists."
  },
  summary,
  bySide,
  byTier,
  bySideTier,
  byMarketSideTier,
  unknownExamples
};

writeJson(FILES.out, report);
writeJson(FILES.latest, report);

const lines = [];
lines.push("FANTASY SIDE COVERAGE REPORT");
lines.push("============================");
lines.push(`date: ${date}`);
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push("");
lines.push("SUMMARY");
lines.push("-------");
lines.push(`total fantasy rows: ${summary.total}`);
lines.push(`usable recommended: ${summary.usableRecommended} (${pct(summary.usableRate)})`);
lines.push(`SIDE_UNKNOWN: ${summary.sideUnknown} (${pct(summary.unknownRate)})`);
lines.push(`SIDE_UNKNOWN with usable projection: ${summary.sideUnknownWithUsableProjection}`);
lines.push(`SIDE_UNKNOWN no usable projection: ${summary.sideUnknownNoUsableProjection}`);
lines.push("");
lines.push("BY SIDE");
lines.push("-------");
for (const r of bySide) {
  lines.push(`${r.key}: ${r.count} (${pct(r.pctOfFantasy)})`);
}
lines.push("");
lines.push("BY TIER");
lines.push("-------");
for (const r of byTier) {
  lines.push(`${r.key}: ${r.count} (${pct(r.pctOfFantasy)})`);
}
lines.push("");
lines.push("BY SIDE + TIER");
lines.push("--------------");
for (const r of bySideTier) {
  lines.push(`${r.key}: ${r.count} (${pct(r.pctOfFantasy)})`);
}
lines.push("");
lines.push("BY MARKET + SIDE + TIER");
lines.push("-----------------------");
for (const r of byMarketSideTier.slice(0, 50)) {
  lines.push(`${r.key}: ${r.count} (${pct(r.pctOfFantasy)})`);
}
lines.push("");
lines.push("SIDE_UNKNOWN EXAMPLES");
lines.push("---------------------");
for (const r of unknownExamples) {
  lines.push(`- ${r.player} | ${r.team || "?"} | ${r.market} ${r.line} | ${r.oddsTier} | projection=${r.projection ?? "n/a"} | prob=${r.recommendedProb ?? "n/a"} | ev=${r.expectedValue ?? "n/a"} | ${r.reason}`);
}

writeText(FILES.txt, lines.join("\n"));
writeText(FILES.latestTxt, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("saved:", FILES.out);
console.log("saved:", FILES.latest);
console.log("saved:", FILES.txt);
console.log("saved:", FILES.latestTxt);
