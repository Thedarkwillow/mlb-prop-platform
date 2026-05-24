const fs = require("fs");
const path = require("path");

const date = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const AUDIT = "outputs/line-specific-block-audit-latest.json";
const OUT = `outputs/controlled-line-unlocks-${date}.json`;
const LATEST = "outputs/controlled-line-unlocks-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normMarket(x) {
  return String(x || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function normSide(x) {
  return String(x || "").toUpperCase().trim();
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isUnsupportedMarket(market) {
  return [
    "hitter_fantasy_score",
    "pitcher_fantasy_score",
    "home_runs",
    "triples",
    "singles",
    "walks",
    "walks_allowed",
    "pitches_thrown"
  ].includes(market);
}

function lineBucket(line) {
  const n = num(line);
  if (n === null) return "unknown";
  if ([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5].includes(n)) return String(n);
  if (n < 1) return "<1";
  if (n < 3) return "1-2.5";
  if (n < 6) return "3-5.5";
  if (n < 10) return "6-9.5";
  if (n < 20) return "10-19.5";
  return "20+";
}

function unlockRule(row) {
  const market = normMarket(row.market);
  const side = normSide(row.side);
  const line = num(row.line);
  const prob = num(row.prob);
  const edge = num(row.edge);

  if (!market || !side || line === null || prob === null || edge === null) return null;
  if (isUnsupportedMarket(market)) return null;
  if (!row.genericMarketPenalty) return null;

  // Elite 0.5 hitter-style MORE unlock.
  if (
    ["bases", "hits", "hrr"].includes(market) &&
    side === "MORE" &&
    line === 0.5 &&
    prob >= 0.70 &&
    edge >= 0.15
  ) {
    return {
      action: "CONTROLLED_WATCHLIST",
      rule: `${market}_MORE_0.5_elite_unlock`,
      reason: "generic market penalty may be too broad for elite 0.5 hitter line",
      required: {
        market,
        side,
        line,
        minProb: 0.70,
        minEdge: 0.15
      }
    };
  }

  // 0.5 LESS props with high hit probability and edge.
  if (
    ["runs", "rbis", "hits"].includes(market) &&
    side === "LESS" &&
    line === 0.5 &&
    prob >= 0.65 &&
    edge >= 0.10
  ) {
    return {
      action: "CONTROLLED_WATCHLIST",
      rule: `${market}_LESS_0.5_high_edge_unlock`,
      reason: "generic market penalty may be too broad for high-edge 0.5 LESS line",
      required: {
        market,
        side,
        line,
        minProb: 0.65,
        minEdge: 0.10
      }
    };
  }

  // Pitcher inflated-line LESS unlocks.
  if (
    ["strikeouts", "pitching_outs", "hits_allowed", "earned_runs_allowed"].includes(market) &&
    side === "LESS" &&
    prob >= 0.62 &&
    edge >= 0.10
  ) {
    return {
      action: "CONTROLLED_WATCHLIST",
      rule: `${market}_LESS_line_specific_unlock`,
      reason: "pitcher LESS line may be strong despite generic market penalty",
      required: {
        market,
        side,
        lineBucket: lineBucket(line),
        minProb: 0.62,
        minEdge: 0.10
      }
    };
  }

  // General high-prob/high-edge line-specific exception.
  if (prob >= 0.72 && edge >= 0.18) {
    return {
      action: "CONTROLLED_WATCHLIST",
      rule: "general_high_prob_high_edge_line_specific_unlock",
      reason: "high probability and edge despite generic market penalty",
      required: {
        minProb: 0.72,
        minEdge: 0.18
      }
    };
  }

  return null;
}

const audit = read(AUDIT, null);

if (!audit || !Array.isArray(audit.rows)) {
  console.error(`Missing or invalid audit file: ${AUDIT}`);
  console.error("Run: npm run audit:line-blocks -- " + date);
  process.exit(1);
}

const candidates = [];

for (const row of audit.rows) {
  const rule = unlockRule(row);
  if (!rule) continue;

  candidates.push({
    date,
    player: row.player,
    team: row.team,
    game: row.game,
    market: normMarket(row.market),
    side: normSide(row.side),
    line: num(row.line),
    lineBucket: lineBucket(row.line),
    tier: row.tier || null,
    prob: num(row.prob),
    edge: num(row.edge),
    genericBucket: row.genericBucket,
    specificBucket: row.specificBucket,
    blockedReason: row.blockedReason,
    genericMarketPenalty: row.genericMarketPenalty,
    fullBoardPromotion: row.fullBoardPromotion || null,
    unlock: rule,
    status: "WATCHLIST_ONLY",
    playable: false,
    note: "Controlled unlock candidate only. Track result before allowing into official playable slips."
  });
}

const byRule = Object.entries(
  candidates.reduce((acc, r) => {
    acc[r.unlock.rule] = (acc[r.unlock.rule] || 0) + 1;
    return acc;
  }, {})
).map(([rule, count]) => ({ rule, count }))
 .sort((a, b) => b.count - a.count);

const byBucket = Object.entries(
  candidates.reduce((acc, r) => {
    acc[r.specificBucket] = (acc[r.specificBucket] || 0) + 1;
    return acc;
  }, {})
).map(([bucket, count]) => ({ bucket, count }))
 .sort((a, b) => b.count - a.count);

const report = {
  date,
  generatedAt: new Date().toISOString(),
  sourceAudit: AUDIT,
  totalCandidates: candidates.length,
  byRule,
  byBucket,
  candidates
};

write(OUT, report);
write(LATEST, report);

console.log("CONTROLLED LINE UNLOCKS");
console.log("-----------------------");
console.log("date:", date);
console.log("candidates:", candidates.length);
console.table(byRule);
console.table(candidates.map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  prob: r.prob,
  edge: r.edge,
  rule: r.unlock.rule
})));
console.log("saved:", OUT);
console.log("saved:", LATEST);
