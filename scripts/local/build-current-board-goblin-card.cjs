const fs = require("fs");
const path = require("path");

const BOARD = "outputs/priced-board.json";
const OUT = "outputs/current-board-goblin-card.json";
const TXT = "outputs/current-board-goblin-card.txt";

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

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.statType || v.line) out.push(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flat(x, out);
  }
  return out;
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

function team(r) {
  return s(r.team || r.teamAbbr || r.playerTeam || r.abbreviation);
}

function game(r) {
  return s(r.game || r.matchup || r.gameName || r.event || r.eventName);
}

function market(r) {
  return norm(r.market || r.statType || r.projectionType || r.stat);
}

function side(r) {
  return s(r.side || r.pickSide || r.recommendation || r.direction).toUpperCase();
}

function line(r) {
  return n(r.line ?? r.target ?? r.threshold ?? r.value);
}

function tierText(r) {
  return [
    r.tier,
    r.oddsTier,
    r.type,
    r.payoutType,
    r.source,
    r.sourceType,
    r.label,
    r.riskStatus,
    r.sampleStatus
  ].map(s).join(" ").toLowerCase();
}

function isGoblin(r) {
  return tierText(r).includes("goblin");
}

function probability(r) {
  const vals = [
    r.probability,
    r.finalProbability,
    r.modelProbability,
    r.winProbability,
    r.overProb,
    r.moreProb,
    r.hitProb,
    r.prob,
    r.p
  ];
  for (const v of vals) {
    const x = n(v);
    if (x !== null) return x > 1 ? x / 100 : x;
  }
  return null;
}

function projection(r) {
  return n(r.projection ?? r.modelProjection ?? r.contextAdjustedProjection ?? r.rawProjection ?? r.mean);
}

function finalScore(r) {
  return n(r.finalScore ?? r.score ?? r.edgeScore ?? r.rankScore ?? r.evScore);
}

function riskStatus(r) {
  return s(r.riskStatus || r.playability || r.status || "");
}

function sampleStatus(r) {
  return s(r.sampleStatus || "");
}

function lineupStatus(r) {
  return s(r.lineupStatus || "");
}

function key(r) {
  return [
    norm(player(r)),
    norm(team(r)),
    norm(game(r)),
    market(r),
    side(r),
    String(line(r))
  ].join("|");
}

function badCurrentRow(r) {
  const reasons = [];
  if (!player(r)) reasons.push("missing_player");
  if (!team(r)) reasons.push("missing_team");
  if (!game(r) || game(r) === "UNKNOWN_GAME" || /^null\s*@\s*null$/i.test(game(r))) reasons.push("missing_game");
  if (!market(r)) reasons.push("missing_market");
  if (side(r) !== "MORE") reasons.push("goblin_not_more");
  if (line(r) === null) reasons.push("missing_line");

  const m = market(r);

  // Keep the first official goblin pass conservative.
  // These are current-board goblins, but still research unless they pass known-safe buckets.
  const allowedMarkets = new Set([
    "hits",
    "bases",
    "hrr",
    "hitter_fantasy_score",
    "singles",
    "runs",
    "strikeouts",
    "hits_allowed",
    "earned_runs_allowed",
    "walks_allowed",
    "pitching_outs",
    "pitcher_fantasy_score",
    "pitches_thrown"
  ]);

  if (!allowedMarkets.has(m)) reasons.push(`unsupported_market:${m}`);

  // Do not allow same player duplicate combos or combo player rows.
  if (player(r).includes("+")) reasons.push("combo_player_row");

  return reasons;
}

function rowScore(r) {
  const p = probability(r);
  const fs = finalScore(r);
  const proj = projection(r);
  const l = line(r);
  const m = market(r);

  let score = 0;

  if (p !== null) score += p * 1000;
  if (fs !== null) score += fs;
  if (proj !== null && l !== null) {
    const gap = side(r) === "MORE" ? proj - l : l - proj;
    score += gap * 25;
  }

  // Conservative preference for simpler hitter goblins first.
  if (m === "hits") score += 60;
  if (m === "bases") score += 45;
  if (m === "hrr") score += 35;
  if (m === "hitter_fantasy_score") score += 20;

  // More volatile / less validated goblin markets get held down.
  if (m === "earned_runs_allowed") score -= 40;
  if (m === "pitcher_fantasy_score") score -= 50;
  if (m === "pitches_thrown") score -= 70;

  return Number(score.toFixed(3));
}

const raw = flat(readJson(BOARD, []));
const goblinsRaw = raw.filter(isGoblin);

const seen = new Set();
const goblins = [];
const blocked = [];

for (const r of goblinsRaw) {
  const k = key(r);
  if (seen.has(k)) continue;
  seen.add(k);

  const reasons = badCurrentRow(r);
  const out = {
    player: player(r),
    team: team(r),
    game: game(r),
    market: market(r),
    side: side(r),
    line: line(r),
    projection: projection(r),
    probability: probability(r),
    finalScore: finalScore(r),
    score: rowScore(r),
    tier: "goblin",
    riskStatus: riskStatus(r),
    sampleStatus: sampleStatus(r),
    lineupStatus: lineupStatus(r),
    source: "current_priced_board",
    rawKey: k
  };

  if (reasons.length) {
    out.blockReasons = reasons;
    blocked.push(out);
  } else {
    goblins.push(out);
  }
}

goblins.sort((a, b) => {
  const as = Number.isFinite(a.score) ? a.score : -999999;
  const bs = Number.isFinite(b.score) ? b.score : -999999;
  return bs - as;
});

const byMarket = {};
const byGame = {};
for (const r of goblins) {
  byMarket[r.market] = (byMarket[r.market] || 0) + 1;
  byGame[r.game] = (byGame[r.game] || 0) + 1;
}

const top = goblins.slice(0, 40);

const report = {
  generatedAt: new Date().toISOString(),
  board: BOARD,
  rawBoardRows: raw.length,
  rawGoblinRows: goblinsRaw.length,
  dedupedGoblinRows: goblins.length + blocked.length,
  usableCurrentGoblinRows: goblins.length,
  blockedRows: blocked.length,
  byMarket,
  byGame,
  top,
  blockedSample: blocked.slice(0, 40)
};

const lines = [];
lines.push("CURRENT BOARD GOBLIN CARD");
lines.push("=========================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`rawBoardRows=${report.rawBoardRows}`);
lines.push(`rawGoblinRows=${report.rawGoblinRows}`);
lines.push(`dedupedGoblinRows=${report.dedupedGoblinRows}`);
lines.push(`usableCurrentGoblinRows=${report.usableCurrentGoblinRows}`);
lines.push(`blockedRows=${report.blockedRows}`);
lines.push("");
lines.push("BY MARKET");
lines.push("---------");
for (const [k, v] of Object.entries(byMarket).sort((a,b)=>b[1]-a[1])) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("BY GAME");
lines.push("-------");
for (const [k, v] of Object.entries(byGame).sort((a,b)=>b[1]-a[1]).slice(0, 25)) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("TOP CURRENT GOBLIN LEGS");
lines.push("-----------------------");
if (!top.length) {
  lines.push("none");
} else {
  top.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.player} | ${r.team} | ${r.game} | ${r.market} ${r.side} ${r.line} | prob=${r.probability ?? "?"} | proj=${r.projection ?? "?"} | score=${r.score} | tier=goblin`);
  });
}
lines.push("");
lines.push("SIMPLE 2-LEG GOBLIN IDEA");
lines.push("------------------------");
const slip = [];
const usedPlayers = new Set();
const usedGames = new Map();
for (const r of top) {
  if (usedPlayers.has(norm(r.player))) continue;
  const gc = usedGames.get(r.game) || 0;
  if (gc >= 1) continue;
  slip.push(r);
  usedPlayers.add(norm(r.player));
  usedGames.set(r.game, gc + 1);
  if (slip.length >= 2) break;
}
if (slip.length < 2) {
  lines.push("No clean 2-leg goblin idea after current-board safety rules.");
} else {
  slip.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.player} | ${r.team} | ${r.game} | ${r.market} ${r.side} ${r.line} | prob=${r.probability ?? "?"} | score=${r.score}`);
  });
  lines.push("");
  lines.push("WARNING: This is still RESEARCH unless goblin lane promotion allows it.");
}
lines.push("");
lines.push("BLOCKED SAMPLE");
lines.push("--------------");
for (const r of blocked.slice(0, 30)) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | ${r.market} ${r.side} ${r.line} | reasons=${(r.blockReasons || []).join(",")}`);
}

writeJson(OUT, report);
writeText(TXT, lines.join("\n") + "\n");

console.log({
  rawBoardRows: report.rawBoardRows,
  rawGoblinRows: report.rawGoblinRows,
  usableCurrentGoblinRows: report.usableCurrentGoblinRows,
  blockedRows: report.blockedRows,
  top: report.top.slice(0, 5).map(r => ({
    player: r.player,
    team: r.team,
    game: r.game,
    market: r.market,
    side: r.side,
    line: r.line,
    probability: r.probability,
    score: r.score
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
