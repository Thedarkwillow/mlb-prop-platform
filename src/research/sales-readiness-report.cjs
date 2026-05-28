const fs = require("fs");
const path = require("path");

const START_DATE =
  process.argv[2] ||
  process.env.npm_config_start ||
  "2026-05-01";

const END_DATE =
  process.argv[3] ||
  process.env.npm_config_end ||
  new Date().toISOString().slice(0, 10);

const OUT = `outputs/sales-readiness-report-${END_DATE}.json`;
const OUT_TXT = `outputs/sales-readiness-report-${END_DATE}.txt`;
const LATEST = "outputs/sales-readiness-report-latest.json";
const LATEST_TXT = "outputs/sales-readiness-report-latest.txt";

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
  return String(v ?? "").trim().toLowerCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function dateRange(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  while (d <= e) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}


function flattenPlayableRows(data) {
  const out = [];

  function walk(v, context = {}) {
    if (!v) return;

    if (Array.isArray(v)) {
      for (const item of v) walk(item, context);
      return;
    }

    if (typeof v !== "object") return;

    const nextContext = {
      ...context,
      slip: v.slip || v.name || v.slipName || context.slip,
      slipSize: v.size || v.slipSize || context.slipSize,
      slipResult: v.result || v.status || context.slipResult
    };

    const hasLegShape =
      v.player &&
      (v.market || v.statType || v.stat_type || v.type) &&
      (v.result || v.outcome || v.actual !== undefined);

    if (hasLegShape) {
      out.push({
        ...v,
        ...nextContext
      });
    }

    for (const key of ["legs", "rows", "entries", "slips", "plays", "picks"]) {
      if (v[key]) walk(v[key], nextContext);
    }
  }

  walk(data);
  return out;
}

function getRows(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.rows)) return v.rows;
  if (Array.isArray(v?.all)) return v.all;
  return [];
}

function resultOf(row) {
  const r = String(row.result ?? row.outcome ?? "").toUpperCase();
  if (["HIT", "WIN", "WON"].includes(r)) return "HIT";
  if (["MISS", "LOSS", "LOST"].includes(r)) return "MISS";
  if (["PUSH", "VOID", "REFUND"].includes(r)) return "PUSH";
  if (row.graded === false) return "UNMATCHED";
  return r || "UNMATCHED";
}

function summarize(rows) {
  const gradedRows = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(resultOf(r)));
  const hits = gradedRows.filter(r => resultOf(r) === "HIT").length;
  const misses = gradedRows.filter(r => resultOf(r) === "MISS").length;
  const pushes = gradedRows.filter(r => resultOf(r) === "PUSH").length;
  const unmatched = rows.length - gradedRows.length;
  const denom = hits + misses;

  return {
    rows: rows.length,
    graded: gradedRows.length,
    hits,
    misses,
    pushes,
    unmatched,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : null,
    roiFlat: denom ? Number(((hits - misses) / denom).toFixed(4)) : null
  };
}

function marketOf(row) {
  return norm(row.market || row.statType || row.stat_type || row.type || row.matchedMarket || "unknown");
}

function sideOf(row) {
  return String(row.side || row.pickSide || row.matchedSide || "UNKNOWN").toUpperCase();
}

function lineOf(row) {
  return num(row.line ?? row.ppLine ?? row.matchedLine, null);
}

function lineBucket(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n <= 0.5) return "<=0.5";
  if (n <= 1.5) return "1.0-1.5";
  if (n <= 3.5) return "2.0-3.5";
  if (n <= 5.5) return "4.0-5.5";
  if (n <= 8.5) return "6.0-8.5";
  if (n <= 12.5) return "9.0-12.5";
  return "13+";
}

function groupSummary(rows, keyFn) {
  const m = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }
  return [...m.entries()]
    .map(([key, rows]) => ({ key, ...summarize(rows) }))
    .sort((a, b) => b.graded - a.graded || (b.roiFlat ?? -99) - (a.roiFlat ?? -99));
}

function normalizeDecisionRows(file, date) {
  const data = readJson(file, null);
  if (!data) return [];

  const rows = getRows(data).length ? getRows(data) : getRows(data.details);
  return rows.map(r => ({
    ...r,
    date,
    layer: r.layer || "UNKNOWN",
    result: resultOf(r),
    player: r.player,
    market: marketOf(r),
    side: sideOf(r),
    line: lineOf(r),
    sourceFile: file
  }));
}

function collectOfficialSlips(date) {
  const file = `outputs/history/${date}-decision-layer-grades.json`;
  const rows = normalizeDecisionRows(file, date);
  return rows.filter(r => norm(r.layer).includes("official") || norm(r.layer).includes("core"));
}

function collectDecisionLayers(date) {
  const file = `outputs/history/${date}-decision-layer-grades.json`;
  return normalizeDecisionRows(file, date);
}

function collectPlayableSlips(date) {
  const files = [
    `outputs/playable-final-slips-graded-${date}.json`,
    `outputs/history/${date}-playable-final-slips-graded.json`,
    date === END_DATE ? "outputs/playable-final-slips.json" : null
  ].filter(Boolean);

  for (const f of files) {
    const data = readJson(f, null);
    if (!data) continue;

    const rows = flattenPlayableRows(data);
    if (!rows.length) continue;

    const normalized = rows.map(r => ({
      ...r,
      date,
      layer: "OFFICIAL_PLAYABLE_SLIP",
      result: resultOf(r),
      market: marketOf(r),
      side: sideOf(r),
      line: lineOf(r),
      sourceFile: f
    }));

    return onlyCompletePlayableLegs(normalized);
  }

  return [];
}


function onlyCompletePlayableLegs(rows) {
  const groups = new Map();

  for (const row of rows) {
    const slip = row.slip || row.name || row.slipName || "UNKNOWN_SLIP";
    const key = `${row.date || ""}|${row.sourceFile || ""}|${slip}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const kept = [];

  for (const legs of groups.values()) {
    const first = legs[0] || {};
    const expectedSize = num(first.slipSize ?? first.size, null);

    /*
      If we know the intended slip size, require the graded leg count
      to meet that size. This removes incomplete duplicate slips like
      a 3-MAN FLEX that only had the same 2 legs as the official 2-man.
    */
    if (expectedSize !== null && legs.length < expectedSize) continue;

    kept.push(...legs);
  }

  return kept;
}

function collectCLV(date) {
  const candidates = [
    `outputs/clv-report-${date}.json`,
    `outputs/history/${date}-clv-report.json`,
    "outputs/clv-report.json",
    "outputs/clv-report-latest.json"
  ];

  for (const f of candidates) {
    const data = readJson(f, null);
    if (!data) continue;
    const rows = getRows(data);
    if (!rows.length && !data.summary) continue;
    return { file: f, summary: data.summary || null, rows };
  }

  return null;
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function classifyDay(date, rows, playableRows, clv) {
  const officialRows = rows.filter(r =>
    ["OFFICIAL_PLAY", "OFFICIAL", "CORE"].includes(String(r.layer || "").toUpperCase()) ||
    String(r.layer || "").toUpperCase().includes("OFFICIAL")
  );

  const actionableRows = rows.filter(r => String(r.layer || "").toUpperCase() === "ACTIONABLE_LEAN");
  const watchRows = rows.filter(r =>
    ["WATCHLIST", "HIGH_PROBABILITY_WATCH", "SIDE_BIAS_OVERRIDE_WATCH"].includes(String(r.layer || "").toUpperCase())
  );

  const hasDecisionFile = fileExists(`outputs/history/${date}-decision-layer-grades.json`);
  const pendingOfficialRows = playableRows.filter(r =>
    !["HIT", "MISS", "PUSH"].includes(resultOf(r)) &&
    (
      String(r.status || "").toUpperCase() === "PLAYABLE" ||
      String(r.layer || "").toUpperCase().includes("OFFICIAL")
    )
  );

  let status = "MISSING_DATA_DAY";
  const gradedPlayableRows = playableRows.filter(r => ["HIT", "MISS", "PUSH"].includes(resultOf(r)));

  if (officialRows.length || gradedPlayableRows.length) status = "OFFICIAL_GRADED_DAY";
  else if (pendingOfficialRows.length) status = "OFFICIAL_PENDING_DAY";
  else if (actionableRows.length) status = "LEAN_ONLY_DAY";
  else if (watchRows.length) status = "WATCH_ONLY_DAY";
  else if (hasDecisionFile) status = "TRUE_NO_PLAY_DAY";
  else status = "MISSING_DATA_DAY";

  return {
    date,
    status,
    officialRows: officialRows.length,
    pendingOfficialRows: pendingOfficialRows.length,
    actionableRows: actionableRows.length,
    watchRows: watchRows.length,
    totalDecisionRows: rows.length,
    clvAvailable: Boolean(clv)
  };
}

const dates = dateRange(START_DATE, END_DATE);

const allDecisionRows = [];
const allPlayableRows = [];
const daySummaries = [];
const clvByDate = [];

for (const date of dates) {
  const decisionRows = collectDecisionLayers(date);
  const playableRows = collectPlayableSlips(date);
  const clv = collectCLV(date);

  allDecisionRows.push(...decisionRows);
  allPlayableRows.push(...playableRows);

  if (clv) clvByDate.push({ date, ...clv });
  daySummaries.push(classifyDay(date, decisionRows, playableRows, clv));
}

const officialDecisionRows = allDecisionRows.filter(r =>
  ["OFFICIAL_PLAY", "OFFICIAL", "CORE"].includes(String(r.layer || "").toUpperCase()) ||
  String(r.layer || "").toUpperCase().includes("OFFICIAL")
);

const officialRows = [
  ...officialDecisionRows,
  ...allPlayableRows.map(r => ({ ...r, layer: "OFFICIAL_PLAYABLE_SLIP" }))
];

const actionableLeanRows = allDecisionRows.filter(r => String(r.layer || "").toUpperCase() === "ACTIONABLE_LEAN");

const watchShadowRows = allDecisionRows.filter(r =>
  ["WATCHLIST", "HIGH_PROBABILITY_WATCH", "SIDE_BIAS_OVERRIDE_WATCH", "SHADOW_PROMOTED_LEAN"].includes(String(r.layer || "").toUpperCase())
);

const trueNoPlayDays = daySummaries.filter(d => d.status === "TRUE_NO_PLAY_DAY").length;
const missingDataDays = daySummaries.filter(d => d.status === "MISSING_DATA_DAY").length;
const officialGradedDays = daySummaries.filter(d => d.status === "OFFICIAL_GRADED_DAY").length;
const officialPendingDays = daySummaries.filter(d => d.status === "OFFICIAL_PENDING_DAY").length;
const officialPlayDays = officialGradedDays + officialPendingDays;
const leanOnlyDays = daySummaries.filter(d => d.status === "LEAN_ONLY_DAY").length;
const watchOnlyDays = daySummaries.filter(d => d.status === "WATCH_ONLY_DAY").length;

const allTrackedRows = [
  ...officialRows.map(r => ({ ...r, productBucket: "OFFICIAL" })),
  ...actionableLeanRows.map(r => ({ ...r, productBucket: "ACTIONABLE_LEAN" })),
  ...watchShadowRows.map(r => ({ ...r, productBucket: "WATCH_SHADOW" }))
];

const output = {
  generatedAt: new Date().toISOString(),
  startDate: START_DATE,
  endDate: END_DATE,
  policy: {
    productPositioning: "filtered +EV execution, not daily locks",
    officialUnit: 1,
    leanUnit: "0.25-0.5",
    watchlistUnit: 0,
    noPlayDaysCountAsDiscipline: true
  },
  discipline: {
    daysTracked: dates.length,
    officialPlayDays,
    officialGradedDays,
    officialPendingDays,
    leanOnlyDays,
    watchOnlyDays,
    trueNoPlayDays,
    missingDataDays,
    officialPlayDayRate: dates.length ? Number((officialPlayDays / dates.length).toFixed(4)) : null,
    trueNoPlayDayRate: dates.length ? Number((trueNoPlayDays / dates.length).toFixed(4)) : null,
    clvDaysAvailable: clvByDate.length
  },
  summaries: {
    official: summarize(officialRows),
    actionableLeans: summarize(actionableLeanRows),
    watchShadow: summarize(watchShadowRows),
    playableSlipRows: summarize(allPlayableRows),
    allTrackedRows: summarize(allTrackedRows)
  },
  breakdowns: {
    byProductBucket: groupSummary(allTrackedRows, r => r.productBucket),
    byLayer: groupSummary(allDecisionRows, r => String(r.layer || "UNKNOWN").toUpperCase()),
    byMarket: groupSummary(allTrackedRows, r => marketOf(r)),
    byMarketSide: groupSummary(allTrackedRows, r => `${marketOf(r)}_${sideOf(r)}`),
    byLineBucket: groupSummary(allTrackedRows, r => `${marketOf(r)}_${sideOf(r)}_${lineBucket(lineOf(r))}`)
  },
  clv: {
    availableDates: clvByDate.map(d => d.date),
    note: "CLV by play type is not fully wired unless CLV rows include product layer identifiers."
  },
  daySummaries,
  rows: allTrackedRows
};

const lines = [];
lines.push("SALES READINESS REPORT");
lines.push("======================");
lines.push(`range: ${START_DATE} to ${END_DATE}`);
lines.push(`generatedAt: ${output.generatedAt}`);
lines.push("");
lines.push("POSITIONING");
lines.push("-----------");
lines.push("Sell filtered +EV execution, not daily locks.");
lines.push("Official plays are rare and strict. No-play days are discipline.");
lines.push("");
lines.push("DISCIPLINE");
lines.push("----------");
lines.push(`days tracked: ${output.discipline.daysTracked}`);
lines.push(`official play days: ${officialPlayDays}`);
lines.push(`official graded days: ${officialGradedDays}`);
lines.push(`official pending days: ${officialPendingDays}`);
lines.push(`lean-only days: ${leanOnlyDays}`);
lines.push(`watch-only days: ${watchOnlyDays}`);
lines.push(`true no-play days: ${trueNoPlayDays}`);
lines.push(`missing data days: ${missingDataDays}`);
lines.push(`official play day rate: ${pct(output.discipline.officialPlayDayRate)}`);
lines.push(`true no-play day rate: ${pct(output.discipline.trueNoPlayDayRate)}`);
lines.push(`CLV days available: ${output.discipline.clvDaysAvailable}`);
lines.push("");
lines.push("PRODUCT BUCKET RESULTS");
lines.push("----------------------");
for (const [name, summary] of Object.entries(output.summaries)) {
  lines.push(`${name}: rows=${summary.rows} graded=${summary.graded} hits=${summary.hits} misses=${summary.misses} pushes=${summary.pushes} hitRate=${pct(summary.hitRate)} roi=${pct(summary.roiFlat)}`);
}
lines.push("");
lines.push("MARKET BREAKDOWN TOP 20");
lines.push("-----------------------");
for (const b of output.breakdowns.byMarket.slice(0, 20)) {
  lines.push(`${b.key}: graded=${b.graded} hits=${b.hits} misses=${b.misses} hitRate=${pct(b.hitRate)} roi=${pct(b.roiFlat)}`);
}
lines.push("");
lines.push("MARKET/SIDE BREAKDOWN TOP 20");
lines.push("----------------------------");
for (const b of output.breakdowns.byMarketSide.slice(0, 20)) {
  lines.push(`${b.key}: graded=${b.graded} hits=${b.hits} misses=${b.misses} hitRate=${pct(b.hitRate)} roi=${pct(b.roiFlat)}`);
}
lines.push("");
lines.push("DAY SUMMARIES");
lines.push("-------------");
for (const d of daySummaries) {
  lines.push(`${d.date}: ${d.status} | official=${d.officialRows} pendingOfficial=${d.pendingOfficialRows || 0} leans=${d.actionableRows} watch=${d.watchRows} clv=${d.clvAvailable ? "yes" : "no"}`);
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
