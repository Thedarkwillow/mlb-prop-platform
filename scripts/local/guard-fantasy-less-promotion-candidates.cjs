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

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function norm(v) {
  return s(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}

function market(r) {
  return norm(r.market || r.statType || r.projectionType || r.stat);
}

function side(r) {
  return s(r.side || r.pick || r.direction || r.selection).toUpperCase();
}

function line(r) {
  return n(r.line ?? r.statValue ?? r.value ?? r.projectionLine);
}

function game(r) {
  return s(r.game || r.matchup || r.gameText || r.eventName);
}

function tier(r) {
  return norm(
    r.tier ||
    r.priceTier ||
    r.projectionTier ||
    r.payoutTier ||
    r.type ||
    r.pickType ||
    r.oddsTier ||
    r.specialType ||
    r.boardTier
  );
}

function fillMethod(r) {
  return norm(
    r.gameFillMethod ||
    r.gameFill?.method ||
    r.gameMatchMethod ||
    r.matchMethod ||
    r.gameSourceMethod ||
    r.fillMethod
  );
}

function isUnknownGame(v) {
  const x = s(v);
  return !x || x === "UNKNOWN_GAME" || /^null\s*@\s*null$/i.test(x);
}

function isSpecialTier(r) {
  const t = tier(r);
  return (
    t.includes("demon") ||
    t.includes("goblin") ||
    t.includes("special") ||
    t.includes("discount") ||
    t.includes("boost")
  );
}

function hasPlayerOnlyFill(r) {
  const m = fillMethod(r);
  const notes = JSON.stringify(r.reasonCodes || r.notes || r.gameFill || r.metadata || {});
  return m === "player_only" || /player_only/i.test(notes);
}

function guardReason(r) {
  const reasons = [];

  if (market(r) !== "hitter_fantasy_score") {
    reasons.push("market_not_hitter_fantasy_score");
  }

  if (side(r) !== "LESS") {
    reasons.push("side_not_less");
  }

  const ln = line(r);
  if (ln === null || ln < 9.5 || ln > 12.5) {
    reasons.push("outside_promoted_line_bucket_9_5_to_12_5");
  }

  if (isSpecialTier(r)) {
    reasons.push("special_tier_less_not_allowed");
  }

  if (isUnknownGame(game(r))) {
    reasons.push("unknown_game_not_allowed");
  }

  if (hasPlayerOnlyFill(r)) {
    reasons.push("player_only_game_fill_not_allowed");
  }

  if (!player(r)) {
    reasons.push("missing_player");
  }

  return reasons;
}

function summarize(rows) {
  const out = {
    total: rows.length,
    byReason: {},
    byMarket: {},
    byTier: {},
    byLine: {}
  };

  for (const r of rows) {
    for (const reason of r.guardReasons || []) {
      out.byReason[reason] = (out.byReason[reason] || 0) + 1;
    }
    const mk = market(r) || "unknown";
    const tr = tier(r) || "standard_or_blank";
    const ln = String(line(r) ?? "unknown");
    out.byMarket[mk] = (out.byMarket[mk] || 0) + 1;
    out.byTier[tr] = (out.byTier[tr] || 0) + 1;
    out.byLine[ln] = (out.byLine[ln] || 0) + 1;
  }

  return out;
}

const data = readJson(FILE, null);
if (!data || typeof data !== "object") {
  console.error(`Missing or invalid ${FILE}`);
  process.exit(1);
}

const eligibleRows = Array.isArray(data.eligibleRows)
  ? data.eligibleRows
  : Array.isArray(data.eligible)
    ? data.eligible
    : [];

const passed = [];
const blocked = [];

for (const row of eligibleRows) {
  const reasons = guardReason(row);
  if (reasons.length) {
    blocked.push({
      ...row,
      guardStatus: "BLOCKED",
      guardReasons: reasons
    });
  } else {
    passed.push({
      ...row,
      guardStatus: "FANTASY_LESS_PROMOTION_GUARD_PASSED",
      guardReasons: ["standard_hitter_fantasy_less_9_5_to_12_5_clean_game"]
    });
  }
}

data.fantasyLessPromotionGuard = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  rule: "Only STANDARD hitter_fantasy_score LESS 9.5-12.5 with clean non-player-only game context may pass.",
  inputEligibleRows: eligibleRows.length,
  passedRows: passed.length,
  blockedRows: blocked.length,
  passedSummary: summarize(passed),
  blockedSummary: summarize(blocked)
};

data.officialEligibleRows = passed;
data.guardBlockedRows = blocked;
data.officialEligible = passed.length;
data.guardBlocked = blocked.length;

writeJson(FILE, data);
writeJson(HIST_OUT, data);

const lines = [];
lines.push("FANTASY LESS PROMOTION SAFETY GUARD");
lines.push("===================================");
lines.push(`generatedAt=${data.fantasyLessPromotionGuard.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`inputEligibleRows=${eligibleRows.length}`);
lines.push(`officialEligible=${passed.length}`);
lines.push(`guardBlocked=${blocked.length}`);
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push(data.fantasyLessPromotionGuard.rule);
lines.push("");
lines.push("BLOCKED REASONS");
lines.push("---------------");
for (const [reason, count] of Object.entries(data.fantasyLessPromotionGuard.blockedSummary.byReason)) {
  lines.push(`${reason}: ${count}`);
}
lines.push("");
lines.push("OFFICIAL ELIGIBLE SAMPLE");
lines.push("------------------------");
for (const r of passed.slice(0, 30)) {
  lines.push(`${player(r)} | ${s(r.team || "?")} | ${game(r)} | ${market(r)} ${side(r)} ${line(r)} | tier=${tier(r) || "standard_or_blank"} | actual=${r.actual ?? "?"} | result=${r.result ?? "ungraded"}`);
}
lines.push("");
lines.push("GUARD BLOCKED SAMPLE");
lines.push("--------------------");
for (const r of blocked.slice(0, 40)) {
  lines.push(`${player(r)} | ${s(r.team || "?")} | ${game(r) || "UNKNOWN_GAME"} | ${market(r)} ${side(r)} ${line(r)} | tier=${tier(r) || "standard_or_blank"} | reasons=${(r.guardReasons || []).join(",")}`);
}
lines.push("");

writeText(TXT, lines.join("\n"));
writeText(HIST_TXT, lines.join("\n"));

console.log({
  date: DATE,
  inputEligibleRows: eligibleRows.length,
  officialEligible: passed.length,
  guardBlocked: blocked.length,
  blockedReasons: data.fantasyLessPromotionGuard.blockedSummary.byReason
});
