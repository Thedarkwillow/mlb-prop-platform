const fs = require("fs");

const SIGNAL_FILE = "outputs/manual/auto-hitter-split-signal.json";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isTrackableSignal(row) {
  const cls = String(row.autoManualSignalClass || "");
  if (!cls || cls === "WEAK_AUTO_SIGNAL") return false;

  const file = String(row.sourceFile || "");

  // Track only lean/watch style sources for now.
  return (
    file.includes("lean-final-slips") ||
    file.includes("blocked-final-candidates")
  );
}

function labelFromSource(row) {
  const file = String(row.sourceFile || "");

  if (file.includes("lean-final-slips")) return "LEAN/WATCH TRACK";
  if (file.includes("blocked-final-candidates")) return "WATCH/BLOCKED TRACK";
  return "TRACK";
}

function fmt(v) {
  if (v === null || v === undefined || v === "") return "n/a";
  return v;
}

const data = readJson(SIGNAL_FILE, { rows: [] });
const rows = Array.isArray(data.rows) ? data.rows.filter(isTrackableSignal) : [];

console.log("");
console.log("AUTO HITTER SIGNAL NOTES");
console.log("========================");
console.log("mode: lean/watch tracking only");
console.log("official promotion: disabled");

if (!rows.length) {
  console.log("none");
  process.exit(0);
}

rows.sort((a, b) => {
  const bs = Number(b.autoManualSignalScore || 0);
  const as = Number(a.autoManualSignalScore || 0);
  return bs - as;
});

for (const r of rows.slice(0, 20)) {
  console.log(
    `- ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | ${labelFromSource(r)} | ${r.autoManualSignalClass} | score=${fmt(r.autoManualSignalScore)} | sample=${fmt(r.historySample)}`
  );

  const reasons = Array.isArray(r.autoManualSignalReasons)
    ? r.autoManualSignalReasons.slice(0, 6)
    : [];

  const warnings = Array.isArray(r.autoManualSignalWarnings)
    ? r.autoManualSignalWarnings
    : [];

  if (reasons.length) console.log(`  reasons: ${reasons.join(", ")}`);
  if (warnings.length) console.log(`  warnings: ${warnings.join(", ")}`);
}

console.log("");
console.log("Rule: auto hitter signal can support lean/watch tracking, but cannot create an official play yet.");
