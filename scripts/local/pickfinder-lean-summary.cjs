const fs = require("fs");

const AUDIT = "outputs/filter-loss-lean-audit.json";
const OUT_TXT = "outputs/pickfinder-lean-summary.txt";
const OUT_JSON = "outputs/pickfinder-lean-summary.json";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(v) {
  return v == null || v === "" ? "?" : String(v);
}

const audit = readJson(AUDIT, null);

const lines = [];
lines.push("");
lines.push("PICKFINDER / LEAN LANE SUMMARY");
lines.push("--------------------------------");

if (!audit || !Array.isArray(audit.rows)) {
  lines.push("No filter-loss lean audit found.");
  lines.push("Run: npm run pickfinder:support && npm run audit:filter-loss");
  console.log(lines.join("\n"));
  process.exit(0);
}

const rows = audit.rows || [];
const summary = audit.summary || {};

lines.push(`Rows checked: ${summary.rows ?? rows.length}`);
lines.push(`LEAN=${summary.leanCandidates ?? 0} | WATCHLIST=${summary.watchlistCandidates ?? 0} | KEEP_BLOCKED=${summary.keepBlocked ?? 0} | PF matched=${summary.pfMatched ?? 0}`);
lines.push("");

function section(title, lane, limit = 12) {
  lines.push(title);
  lines.push("-".repeat(title.length));

  const laneRows = rows
    .filter(r => r.lane === lane)
    .sort((a, b) =>
      Number(b.probability || 0) - Number(a.probability || 0) ||
      Number(b.books || 0) - Number(a.books || 0) ||
      Number(b.pickfinderAppsCount || 0) - Number(a.pickfinderAppsCount || 0)
    )
    .slice(0, limit);

  if (!laneRows.length) {
    lines.push("none");
    lines.push("");
    return;
  }

  laneRows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.player} | ${r.team || "?"} | ${r.market} ${r.side} ${r.line}`);
    lines.push(`   prob=${fmtPct(r.probability)} | books=${fmt(r.books)} | PF=${r.pickfinderSupportClass || "PF_NO_MATCH"} | PF apps=${r.pickfinderAppsCount || 0} | PF stat=${r.pickfinderStat || "n/a"}`);
    lines.push(`   current=${r.current || "-"} | reasons=${(r.reasons || []).join(",") || "-"}`);
  });

  lines.push("");
}

section("LEAN CANDIDATES — NOT OFFICIAL", "LEAN_CANDIDATE");
section("WATCHLIST CANDIDATES", "WATCHLIST_CANDIDATE");
section("STILL BLOCKED", "KEEP_BLOCKED");

const payload = {
  generatedAt: new Date().toISOString(),
  source: AUDIT,
  summary,
  lean: rows.filter(r => r.lane === "LEAN_CANDIDATE"),
  watchlist: rows.filter(r => r.lane === "WATCHLIST_CANDIDATE"),
  blocked: rows.filter(r => r.lane === "KEEP_BLOCKED")
};

fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
