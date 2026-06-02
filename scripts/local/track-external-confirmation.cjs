const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const OUT_DIR = "outputs/external-confirmation";
const OUT_JSON = `${OUT_DIR}/external-confirmation-tracking-${DATE}.json`;
const OUT_LATEST_JSON = `${OUT_DIR}/external-confirmation-tracking-latest.json`;
const OUT_TXT = `${OUT_DIR}/external-confirmation-tracking-${DATE}.txt`;
const OUT_LATEST_TXT = `${OUT_DIR}/external-confirmation-tracking-latest.txt`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hits": "hits",
    "hits allowed": "hits_allowed",
    "hits_allowed": "hits_allowed",
    "runs": "runs",
    "runs allowed": "runs_allowed",
    "runs_allowed": "runs_allowed",
    "walks": "walks",
    "walks allowed": "walks_allowed",
    "walks_allowed": "walks_allowed",
    "strikeouts": "strikeouts",
    "pitcher strikeouts": "strikeouts",
    "total bases": "bases",
    "bases": "bases",
    "hrr": "hrr",
    "hits runs rbis": "hrr",
    "pitching outs": "pitching_outs",
    "pitching_outs": "pitching_outs"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function playerOf(r) {
  return r.player || r.playerName || r.name || r.fullName || "";
}

function lineOf(r) {
  const n = Number(r.line ?? r.ppLine ?? r.value);
  return Number.isFinite(n) ? n : null;
}

function keyOf(r) {
  return [
    norm(playerOf(r)),
    marketNorm(r.market || r.stat || ""),
    sideNorm(r.side || r.pick || r.direction || ""),
    lineOf(r)
  ].join("|");
}

function loadExternalRows() {
  const file =
    fs.existsSync(`outputs/external-confirmation/external-mlb-form-confirmation-${DATE}.json`)
      ? `outputs/external-confirmation/external-mlb-form-confirmation-${DATE}.json`
      : "outputs/external-confirmation/external-mlb-form-confirmation-latest.json";

  const data = readJson(file, {});
  return {
    file,
    rows: Array.isArray(data.rows) ? data.rows : []
  };
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (playerOf(v) || v.market || v.stat || v.result || v.gradeResult) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function loadGradeRows() {
  const files = [
    `outputs/history/${DATE}-decision-layer-grades.json`,
    `outputs/history/${DATE}-full-board-graded.json`,
    `outputs/history/${DATE}-all-markets-graded.json`,
    `outputs/playable-final-slips-graded-${DATE}.json`,
    "outputs/decision-layer-grades-latest.json",
    "outputs/all-markets-graded.json",
    "outputs/graded-props.json"
  ];

  const loaded = [];
  for (const f of files) {
    const data = readJson(f, null);
    if (!data) continue;
    const rows = flatten(data).filter(r => playerOf(r));
    if (rows.length) loaded.push({ file: f, rows });
  }

  return loaded;
}

function resultOf(r) {
  const raw = String(r.result || r.gradeResult || r.outcome || r.status || "").toUpperCase();
  if (["HIT", "WIN", "WON", "CORRECT"].includes(raw)) return "HIT";
  if (["MISS", "LOSS", "LOST", "INCORRECT"].includes(raw)) return "MISS";
  if (["PUSH", "TIE"].includes(raw)) return "PUSH";
  if (["REFUND", "DNP", "VOID"].includes(raw)) return "REFUND";
  return "";
}

function findGrade(row, gradeRows) {
  const k = keyOf(row);
  for (const source of gradeRows) {
    const exact = source.rows.find(g => keyOf(g) === k && resultOf(g));
    if (exact) return { source: source.file, row: exact, result: resultOf(exact) };
  }

  const loose = [
    norm(row.player),
    marketNorm(row.market),
    sideNorm(row.side)
  ].join("|");

  for (const source of gradeRows) {
    const hit = source.rows.find(g =>
      [
        norm(playerOf(g)),
        marketNorm(g.market || g.stat || ""),
        sideNorm(g.side || g.pick || g.direction || "")
      ].join("|") === loose && resultOf(g)
    );
    if (hit) return { source: source.file, row: hit, result: resultOf(hit), loose: true };
  }

  return null;
}

function addBucket(map, bucket, result) {
  if (!map[bucket]) {
    map[bucket] = { total: 0, graded: 0, hits: 0, misses: 0, pushes: 0, refunds: 0, pending: 0, hitRate: null, roiProxy: null };
  }

  const b = map[bucket];
  b.total++;

  if (result === "HIT") {
    b.graded++;
    b.hits++;
  } else if (result === "MISS") {
    b.graded++;
    b.misses++;
  } else if (result === "PUSH") {
    b.pushes++;
  } else if (result === "REFUND") {
    b.refunds++;
  } else {
    b.pending++;
  }
}

function finalizeBuckets(map) {
  for (const b of Object.values(map)) {
    b.hitRate = b.graded ? Number(((b.hits / b.graded) * 100).toFixed(1)) : null;
    b.roiProxy = b.graded ? Number((((b.hits - b.misses) / b.graded) * 100).toFixed(1)) : null;
  }
}

function tableLines(title, map) {
  const lines = [title, "-".repeat(title.length)];
  const entries = Object.entries(map).sort((a, b) => {
    const av = a[1].graded || 0;
    const bv = b[1].graded || 0;
    return bv - av || String(a[0]).localeCompare(String(b[0]));
  });

  if (!entries.length) {
    lines.push("none");
    lines.push("");
    return lines;
  }

  for (const [k, b] of entries) {
    lines.push(`${k}: total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} refunds=${b.refunds} pending=${b.pending} hitRate=${b.hitRate ?? "n/a"}% roiProxy=${b.roiProxy ?? "n/a"}%`);
  }

  lines.push("");
  return lines;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const external = loadExternalRows();
  const gradeSources = loadGradeRows();
  const gradeRows = gradeSources.flatMap(x => x.rows);

  const tracked = external.rows.map(r => {
    const grade = findGrade(r, gradeSources);
    return {
      date: DATE,
      decision: r.decision,
      player: r.player,
      team: r.team,
      market: r.market,
      side: r.side,
      line: r.line,
      externalGrade: r.externalGrade,
      externalScore: r.externalScore,
      externalHandSignalUsed: r.externalHandSignalUsed || "none",
      externalL10HitRate: r.externalL10?.hitRate ?? null,
      externalSeasonHitRate: r.externalSeason?.hitRate ?? null,
      externalHomeAwayHitRate: r.externalHomeAway?.hitRate ?? null,
      externalPitcherHandHitRate: r.externalPitcherHand?.hitRate ?? null,
      externalGeneralHandProfile: r.externalGeneralHandProfile || null,
      result: grade?.result || "PENDING",
      gradeSource: grade?.source || null,
      looseGradeMatch: !!grade?.loose
    };
  });

  const byExternalGrade = {};
  const byDecisionGrade = {};
  const byMarketSideGrade = {};
  const byHandSignal = {};

  for (const r of tracked) {
    const result = r.result;
    addBucket(byExternalGrade, r.externalGrade || "UNKNOWN", result);
    addBucket(byDecisionGrade, `${r.decision}|${r.externalGrade || "UNKNOWN"}`, result);
    addBucket(byMarketSideGrade, `${r.market}|${r.side}|${r.externalGrade || "UNKNOWN"}`, result);
    addBucket(byHandSignal, r.externalHandSignalUsed || "none", result);
  }

  finalizeBuckets(byExternalGrade);
  finalizeBuckets(byDecisionGrade);
  finalizeBuckets(byMarketSideGrade);
  finalizeBuckets(byHandSignal);

  const output = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    mode: "tracking_only_no_pick_impact",
    externalSourceFile: external.file,
    gradeSourceFiles: gradeSources.map(x => ({ file: x.file, rows: x.rows.length })),
    counts: {
      externalRows: external.rows.length,
      gradeRows: gradeRows.length,
      trackedRows: tracked.length,
      gradedRows: tracked.filter(x => x.result === "HIT" || x.result === "MISS").length,
      pendingRows: tracked.filter(x => x.result === "PENDING").length
    },
    byExternalGrade,
    byDecisionGrade,
    byMarketSideGrade,
    byHandSignal,
    rows: tracked
  };

  const lines = [
    "EXTERNAL CONFIRMATION TRACKING",
    "==============================",
    `date: ${DATE}`,
    "mode: tracking only, no pick impact",
    `externalRows: ${output.counts.externalRows}`,
    `gradedRows: ${output.counts.gradedRows}`,
    `pendingRows: ${output.counts.pendingRows}`,
    "",
    ...tableLines("BY EXTERNAL GRADE", byExternalGrade),
    ...tableLines("BY DECISION + EXTERNAL GRADE", byDecisionGrade),
    ...tableLines("BY MARKET + SIDE + EXTERNAL GRADE", byMarketSideGrade),
    ...tableLines("BY HAND SIGNAL", byHandSignal),
    "NOTES",
    "-----",
    "- This does not affect official, lean, watch, or blocked decisions.",
    "- Use only after enough graded sample accumulates.",
    ""
  ];

  write(OUT_JSON, JSON.stringify(output, null, 2) + "\n");
  write(OUT_LATEST_JSON, JSON.stringify(output, null, 2) + "\n");
  write(OUT_TXT, lines.join("\n"));
  write(OUT_LATEST_TXT, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_LATEST_JSON}`);
  console.log(`saved: ${OUT_TXT}`);
  console.log(`saved: ${OUT_LATEST_TXT}`);
}

main();
