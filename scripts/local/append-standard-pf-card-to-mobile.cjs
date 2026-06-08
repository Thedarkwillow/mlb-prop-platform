const fs = require("fs");

const MOBILE = "outputs/mobile-summary.txt";
const CARD = "outputs/clean-standard-pf-lean-card.json";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function readText(file, fallback = "") {
  try { return fs.readFileSync(file, "utf8"); }
  catch { return fallback; }
}

function writeText(file, data) {
  fs.writeFileSync(file, data);
}

const mobile = readText(MOBILE, "");
const card = readJson(CARD, {});
const rows = Array.isArray(card.rows) ? card.rows : [];

const marker = "STANDARD PICKFINDER RESEARCH LEANS";
let cleaned = mobile;
const idx = cleaned.indexOf(marker);
if (idx >= 0) {
  cleaned = cleaned.slice(0, idx).trimEnd() + "\n";
}

const lines = [];
lines.push("");
lines.push(marker);
lines.push("================================");
lines.push(`Status: ${card.officialStatus || "RESEARCH_ONLY"}`);
lines.push(`Count: ${rows.length}`);
lines.push("Rule: model + EV + exact PickFinder prop match + PF trend agreement + PickFinder lineup confirmation");
lines.push("");

if (!rows.length) {
  lines.push("No clean standard PickFinder research leans.");
} else {
  rows.slice(0, 12).forEach((r, i) => {
    lines.push(`${i + 1}. ${r.player} | ${r.team} | ${r.game || "?"} | ${r.market} ${r.side} ${r.line}`);
    lines.push(`   Prob: ${r.probability ?? "?"} | EV: ${r.ev ?? "?"} | PFavg: ${r.pfAvgHitRate ?? "?"}% | L10: ${r.pfL10 ?? "?"}% | L15: ${r.pfL15 ?? "?"}% | Diff: ${r.pfDifferencePercent ?? "?"}%`);
    lines.push(`   Source: ${r.lineupSource || "?"} | Tags: ${(r.tags || []).join(",")}`);
  });
}

writeText(MOBILE, cleaned.trimEnd() + "\n" + lines.join("\n") + "\n");

console.log({
  mobile: MOBILE,
  card: CARD,
  appendedRows: rows.length
});
