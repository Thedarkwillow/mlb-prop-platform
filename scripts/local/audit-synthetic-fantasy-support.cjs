const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = [
  "outputs/production-candidates.json",
  "outputs/high-probability-boards-latest.json",
  `outputs/high-probability-boards-${DATE}.json`,
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`
];

const OUT_JSON = `outputs/synthetic-fantasy-support-quality-${DATE}.json`;
const OUT_TXT = `outputs/synthetic-fantasy-support-quality-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/synthetic-fantasy-support-quality-latest.json";
const OUT_LATEST_TXT = "outputs/synthetic-fantasy-support-quality-latest.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function playerOf(row) {
  return String(row?.player || row?.playerName || row?.name || row?.displayName || "");
}

function marketOf(row) {
  return String(row?.market || row?.statType || row?.stat_type || row?.prop || "").toLowerCase();
}

function sideOf(row) {
  return String(row?.side || row?.pick || row?.direction || "").toUpperCase();
}

function lineOf(row) {
  return row?.line ?? row?.target ?? row?.projectionLine ?? row?.propLine ?? row?.value;
}

function tierOf(row) {
  return String(row?.tier || row?.oddsTier || row?.payoutTier || "standard").toLowerCase();
}

function classOf(row) {
  return String(row?.class || row?.candidateClass || row?.bucket || row?.status || "").toUpperCase();
}

function isFantasy(row) {
  return marketOf(row).includes("fantasy");
}

function syntheticGradeOf(row) {
  return String(
    row?.syntheticFantasySupport?.syntheticGrade ||
    row?.grade ||
    row?.support ||
    ""
  ).toUpperCase();
}

function syntheticBooksOf(row) {
  return Number(
    row?.syntheticFantasySupport?.syntheticBooks ??
    row?.books ??
    0
  ) || 0;
}

function componentMarketsOf(row) {
  const a = row?.syntheticFantasySupport?.componentMarkets;
  return Array.isArray(a) ? a : [];
}


function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rowKey(r) {
  return [
    r.file,
    norm(r.player),
    norm(r.market),
    norm(r.side),
    String(r.line ?? "").trim(),
    norm(r.tier)
  ].join("|");
}

function supportRank(r) {
  if (r.syntheticGrade === "SYNTHETIC_GREEN") return 5;
  if (r.syntheticGrade === "SYNTHETIC_NEUTRAL") return 4;
  if (r.syntheticBooks > 0) return 3;
  if (Array.isArray(r.componentMarkets) && r.componentMarkets.length > 0) return 2;
  if (r.syntheticGrade === "SYNTHETIC_UNKNOWN") return 1;
  return 0;
}

function dedupeRows(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = rowKey(r);
    const old = best.get(key);
    if (!old || supportRank(r) > supportRank(old)) {
      best.set(key, r);
    }
  }
  return Array.from(best.values());
}

function flattenRows(payload) {
  const out = [];
  const seen = new Set();

  function walk(v, path = "$") {
    if (!v || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);

    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }

    if (playerOf(v) && marketOf(v) && sideOf(v) && lineOf(v) !== undefined) {
      out.push({ row: v, path });
    }

    for (const [k, val] of Object.entries(v)) {
      walk(val, `${path}.${k}`);
    }
  }

  walk(payload);
  return out;
}

const rows = [];

for (const file of FILES) {
  const payload = readJson(file, null);
  if (!payload) continue;

  for (const { row, path } of flattenRows(payload)) {
    if (!isFantasy(row)) continue;

    const syntheticGrade = syntheticGradeOf(row);
    const syntheticBooks = syntheticBooksOf(row);
    const componentMarkets = componentMarketsOf(row);

    let status = "OK_RESEARCH_ONLY";
    const reasons = [];

    if (syntheticGrade === "SYNTHETIC_UNKNOWN" || syntheticBooks <= 0 || componentMarkets.length === 0) {
      status = "FANTASY_NO_COMPONENT_SUPPORT";
      reasons.push("no_component_market_support");
    }

    if (!row?.fantasyResearchOnly && classOf(row) !== "RESEARCH") {
      reasons.push("fantasy_not_explicit_research_only");
    }

    rows.push({
      file,
      path,
      status,
      player: playerOf(row),
      market: marketOf(row),
      side: sideOf(row),
      line: lineOf(row),
      tier: tierOf(row),
      class: classOf(row),
      syntheticGrade,
      syntheticBooks,
      componentMarkets,
      reasons
    });
  }
}

const dedupedRows = dedupeRows(rows);

const byStatus = dedupedRows.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

const noComponentRows = dedupedRows.filter(r => r.status === "FANTASY_NO_COMPONENT_SUPPORT");

const audit = {
  date: DATE,
  rawFantasyRows: rows.length,
  totalFantasyRows: dedupedRows.length,
  deduped: true,
  noComponentRows: noComponentRows.length,
  byStatus,
  rows: dedupedRows,
  noComponentRowsList: noComponentRows,
  policy: {
    fantasyNormalBookSupport: false,
    syntheticSupportAllowed: true,
    officialPromotionAllowed: false,
    actionableLeanAllowed: false,
    noComponentSupportAction: "keep_research_only_and_exclude_from_actionable_boards"
  }
};

const lines = [];
lines.push("SYNTHETIC FANTASY SUPPORT QUALITY");
lines.push("=================================");
lines.push(`date: ${DATE}`);
lines.push(`rawFantasyRows: ${rows.length}`);
lines.push(`totalFantasyRows: ${dedupedRows.length}`);
lines.push("deduped: true");
lines.push(`noComponentRows: ${noComponentRows.length}`);
lines.push("");
lines.push("BY STATUS");
lines.push("---------");
for (const [k, v] of Object.entries(byStatus)) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("NO COMPONENT SUPPORT");
lines.push("--------------------");
if (!noComponentRows.length) {
  lines.push("none");
} else {
  noComponentRows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | ${r.syntheticGrade} | syntheticBooks=${r.syntheticBooks} | class=${r.class}`);
    lines.push(`   file=${r.file}`);
    lines.push(`   reasons=${r.reasons.join(",")}`);
  });
}
lines.push("");
lines.push("POLICY");
lines.push("------");
lines.push("Fantasy is research-only. SYNTHETIC_UNKNOWN means no component support and should not be treated as solved.");

writeJson(OUT_JSON, audit);
writeJson(OUT_LATEST_JSON, audit);
writeText(OUT_TXT, lines.join("\n"));
writeText(OUT_LATEST_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
