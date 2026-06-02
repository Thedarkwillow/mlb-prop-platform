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

const OUT = `outputs/bases-more-half-controlled-audit-${DATE}.json`;
const OUT_LATEST = "outputs/bases-more-half-controlled-audit-latest.json";
const TXT = `outputs/bases-more-half-controlled-audit-${DATE}.txt`;
const TXT_LATEST = "outputs/bases-more-half-controlled-audit-latest.txt";

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function write(file, data) {
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

function norm(v) {
  return String(v ?? "").toLowerCase().trim();
}

function arr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.rows)) return v.rows;
  if (Array.isArray(v.candidates)) return v.candidates;
  if (Array.isArray(v.leans)) return v.leans;
  if (Array.isArray(v.blocked)) return v.blocked;
  return [];
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.market || v.side || v.line || v.reason || v.reasons) out.push(v);
  for (const val of Object.values(v)) flatten(val, out);
  return out;
}

function getProb(r) {
  return num(r.prob ?? r.recommendedProb ?? r.calibratedDistributionProb ?? r.contextAdjustedDistributionProb, null);
}

function getEdge(r) {
  return num(r.edge ?? r.expectedValue ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge, null);
}

function getBooks(r) {
  return num(r.books ?? r.sportsbookBookCount, 0);
}

function getGrade(r) {
  return String(r.grade ?? r.qualityGrade ?? r.savantReportGrade ?? "UNKNOWN").toUpperCase();
}

function getTier(r) {
  return String(r.oddsTier ?? r.tier ?? "standard").toLowerCase();
}

function reasonsOf(r) {
  return [
    r.reason,
    r.disabledReason,
    ...(Array.isArray(r.reasons) ? r.reasons : []),
    ...(Array.isArray(r.rejectReasons) ? r.rejectReasons : []),
    ...(Array.isArray(r.flags) ? r.flags : [])
  ].filter(Boolean).map(String);
}

function key(r) {
  return [
    String(r.player || "").toLowerCase(),
    String(r.team || r.resolvedTeam || "").toLowerCase(),
    norm(r.market || r.stat),
    String(r.side || "").toUpperCase(),
    String(r.line)
  ].join("|");
}

const sources = [
  ["slipsPriced", "outputs/slips-priced.json"],
  ["enriched", "outputs/slips-distribution-enriched.json"],
  ["blocked", "outputs/blocked-final-candidates.json"],
  ["leanWatch", "outputs/lean-watchlist-candidates.json"],
  ["leanFinal", "outputs/lean-final-slips.json"],
  ["production", "outputs/production-candidates.json"]
];

const seen = new Map();

for (const [source, file] of sources) {
  const data = read(file, null);
  const rows = flatten(data);
  for (const r of rows) {
    if (!r || !r.player) continue;
    const market = norm(r.market || r.stat);
    const side = String(r.side || r.recommendedSide || "").toUpperCase();
    const line = num(r.line, null);
    if (market !== "bases") continue;
    if (side !== "MORE") continue;
    if (line !== 0.5) continue;

    const k = key(r);
    const prev = seen.get(k) || {};
    const merged = {
      ...prev,
      ...r,
      sourceSeen: [...new Set([...(prev.sourceSeen || []), source])],
      reasonsMerged: [...new Set([...(prev.reasonsMerged || []), ...reasonsOf(r)])]
    };
    seen.set(k, merged);
  }
}

const rows = [...seen.values()].map(r => {
  const prob = getProb(r);
  const edge = getEdge(r);
  const books = getBooks(r);
  const grade = getGrade(r);
  const tier = getTier(r);
  const reasons = r.reasonsMerged || reasonsOf(r);

  const passesControlled =
    prob !== null &&
    edge !== null &&
    prob >= 0.685 &&
    edge >= 0.10 &&
    books >= 2 &&
    grade === "GREEN" &&
    !reasons.includes("grade_fade");

  const nearMissReasons = [];
  if (prob === null || prob < 0.685) nearMissReasons.push("prob_below_68_5");
  if (edge === null || edge < 0.10) nearMissReasons.push("edge_below_10");
  if (books < 2) nearMissReasons.push("books_below_2");
  if (grade !== "GREEN") nearMissReasons.push(`grade_${grade.toLowerCase()}`);
  if (reasons.includes("grade_fade")) nearMissReasons.push("grade_fade");

  return {
    date: DATE,
    player: r.player,
    team: r.team || r.resolvedTeam || null,
    game: r.game || r.resolvedGame || null,
    market: "bases",
    side: "MORE",
    line: 0.5,
    tier,
    prob,
    edge,
    books,
    grade,
    score: num(r.score ?? r.finalScore, null),
    sourceSeen: r.sourceSeen || [],
    originalReasons: reasons,
    controlledStatus: passesControlled ? "CONTROLLED_UNLOCK_AUDIT" : "NO_UNLOCK",
    nearMissReasons,
    officialEligible: false,
    note: passesControlled
      ? "Audit-only. Candidate clears strict controlled 0.5 bases MORE test but should remain track-only until multi-slate ROI validates."
      : "Does not clear controlled 0.5 bases MORE test."
  };
}).sort((a, b) =>
  Number(b.prob || 0) - Number(a.prob || 0) ||
  Number(b.edge || 0) - Number(a.edge || 0)
);

const unlocks = rows.filter(r => r.controlledStatus === "CONTROLLED_UNLOCK_AUDIT");
const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  total: rows.length,
  controlledUnlockAudit: unlocks.length,
  rules: {
    market: "bases MORE 0.5",
    minProb: 0.685,
    minEdge: 0.10,
    minBooks: 2,
    requiredGrade: "GREEN",
    officialEligible: false,
    note: "Audit-only until multi-slate ROI validates."
  },
  rows,
  unlocks
};

const lines = [];
lines.push("BASES MORE 0.5 CONTROLLED UNLOCK AUDIT");
lines.push("=======================================");
lines.push(`date: ${DATE}`);
lines.push(`total: ${rows.length}`);
lines.push(`controlledUnlockAudit: ${unlocks.length}`);
lines.push("");
if (!unlocks.length) {
  lines.push("No controlled unlocks.");
} else {
  lines.push("CONTROLLED UNLOCK AUDIT");
  lines.push("-----------------------");
  for (const r of unlocks) {
    lines.push(`- ${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | ${r.tier} | prob=${(r.prob * 100).toFixed(2)}% | edge=${(r.edge * 100).toFixed(2)}% | books=${r.books} | grade=${r.grade}`);
  }
}
lines.push("");
lines.push("TOP NO-UNLOCK NEAR MISSES");
lines.push("-------------------------");
for (const r of rows.filter(r => r.controlledStatus !== "CONTROLLED_UNLOCK_AUDIT").slice(0, 12)) {
  lines.push(`- ${r.player} | ${r.team} | prob=${r.prob} | edge=${r.edge} | books=${r.books} | grade=${r.grade} | misses=${r.nearMissReasons.join(",")}`);
}

write(OUT, report);
write(OUT_LATEST, report);
writeText(TXT, lines.join("\n"));
writeText(TXT_LATEST, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT}`);
console.log(`saved: ${OUT_LATEST}`);
console.log(`saved: ${TXT}`);
console.log(`saved: ${TXT_LATEST}`);
