const fs = require("fs");
const path = require("path");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const FILE = "outputs/fantasy-less-promotion-candidates.json";
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
function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function norm(v) {
  return s(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function player(r) { return s(r?.player || r?.playerName || r?.name || r?.athleteName); }
function team(r) { return s(r?.team || r?.teamAbbr || r?.teamCode); }
function market(r) { return norm(r?.market || r?.statType || r?.projectionType || r?.stat); }
function side(r) { return s(r?.side || r?.pick || r?.direction).toUpperCase(); }
function line(r) { return n(r?.line ?? r?.target ?? r?.threshold); }
function game(r) { return s(r?.game || r?.matchup || r?.gameText); }
function tier(r) {
  return norm(r?.tier || r?.priceTier || r?.oddsTier || r?.specialType || r?.pickType || "");
}
function resultOf(r) {
  return s(r?.result || r?.grade || r?.outcome || "").toLowerCase();
}
function actualOf(r) {
  return n(r?.actual ?? r?.actualValue ?? r?.fantasyActual ?? r?.score ?? r?.finalScore);
}
function isUnknownGame(v) {
  const x = s(v);
  return !x || x === "UNKNOWN_GAME" || /^null\s*@\s*null$/i.test(x);
}
function isPlayerOnlyFill(r) {
  const method = s(r?.gameFillMethod || r?.matchMethod || r?.gameMatchMethod);
  return method === "player_only";
}
function isStandardTier(r) {
  const t = tier(r);
  return !t || t === "standard" || t === "standard_or_blank";
}
function summarize(rows) {
  const byReason = {};
  const byMarket = {};
  const byTier = {};
  const byLine = {};
  for (const r of rows) {
    const reasons = Array.isArray(r.guardReasons) ? r.guardReasons : [r.guardReason || "passed"];
    for (const reason of reasons) byReason[reason] = (byReason[reason] || 0) + 1;
    byMarket[market(r) || "unknown"] = (byMarket[market(r) || "unknown"] || 0) + 1;
    byTier[tier(r) || "standard_or_blank"] = (byTier[tier(r) || "standard_or_blank"] || 0) + 1;
    byLine[String(line(r) ?? "?")] = (byLine[String(line(r) ?? "?")] || 0) + 1;
  }
  return { total: rows.length, byReason, byMarket, byTier, byLine };
}

const data = readJson(FILE, {});
const input = Array.isArray(data.eligibleRows) ? data.eligibleRows : [];
const official = [];
const blocked = [];

for (const row of input) {
  const reasons = [];
  const m = market(row);
  const sd = side(row);
  const ln = line(row);
  const gm = game(row);
  const res = resultOf(row);
  const actual = actualOf(row);

  if (m !== "hitter_fantasy_score") reasons.push("market_not_hitter_fantasy_score");
  if (sd !== "LESS") reasons.push("side_not_less");
  if (ln === null || ln < 9.5 || ln > 12.5) reasons.push("line_not_9_5_to_12_5");
  if (!isStandardTier(row)) reasons.push("non_standard_tier_not_allowed");
  if (isUnknownGame(gm)) reasons.push("unknown_game_not_allowed");
  if (isPlayerOnlyFill(row)) reasons.push("player_only_game_fill_not_allowed");
  if (res === "unmatched" || res === "unknown" || !res) reasons.push("historical_unmatched_not_allowed");
  if (actual === null) reasons.push("missing_actual_not_allowed");

  const out = {
    ...row,
    guardChecked: true,
    guardReasons: reasons.length ? reasons : ["standard_hitter_fantasy_less_9_5_to_12_5_clean_game_known_actual"],
    riskStatus: reasons.length ? "FANTASY_LESS_PROMOTION_GUARD_BLOCKED" : "FANTASY_LESS_PROMOTION_REVIEW",
    sampleStatus: reasons.length ? "FANTASY_LESS_GUARD_BLOCKED" : "FANTASY_LESS_PROMOTION_SAMPLE_PASSED"
  };

  if (reasons.length) blocked.push(out);
  else official.push(out);
}

data.officialEligible = official.length;
data.officialEligibleRows = official;
data.guardBlocked = blocked.length;
data.guardBlockedRows = blocked;
data.guard = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  rule: "Only STANDARD hitter_fantasy_score LESS 9.5-12.5 with clean game context, non-player-only game fill, matched result, and known actual may pass.",
  inputEligibleRows: input.length,
  passedRows: official.length,
  blockedRows: blocked.length,
  passedSummary: summarize(official),
  blockedSummary: summarize(blocked)
};

writeJson(FILE, data);
writeJson(HIST_OUT, data);

const lines = [];
lines.push("FANTASY LESS PROMOTION SAFETY GUARD");
lines.push("===================================");
lines.push(`generatedAt=${data.guard.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`inputEligibleRows=${input.length}`);
lines.push(`officialEligible=${official.length}`);
lines.push(`guardBlocked=${blocked.length}`);
lines.push("RULE");
lines.push("----");
lines.push(data.guard.rule);
lines.push("BLOCKED REASONS");
lines.push("---------------");
for (const [k, v] of Object.entries(data.guard.blockedSummary.byReason)) lines.push(`${k}: ${v}`);
lines.push("OFFICIAL ELIGIBLE SAMPLE");
lines.push("------------------------");
for (const r of official.slice(0, 30)) {
  lines.push(`${player(r)} | ${team(r) || "?"} | ${game(r)} | ${market(r)} ${side(r)} ${line(r)} | tier=${tier(r) || "standard_or_blank"} | actual=${actualOf(r) ?? "?"} | result=${resultOf(r) || "?"}`);
}
lines.push("GUARD BLOCKED SAMPLE");
lines.push("--------------------");
for (const r of blocked.slice(0, 40)) {
  lines.push(`${player(r)} | ${team(r) || "?"} | ${game(r) || "UNKNOWN_GAME"} | ${market(r)} ${side(r)} ${line(r)} | tier=${tier(r) || "standard_or_blank"} | reasons=${(r.guardReasons || []).join(",")}`);
}
writeText(TXT, lines.join("\n") + "\n");
writeText(HIST_TXT, lines.join("\n") + "\n");

console.log({
  date: DATE,
  inputEligibleRows: input.length,
  officialEligible: official.length,
  guardBlocked: blocked.length,
  blockedReasons: data.guard.blockedSummary.byReason
});
