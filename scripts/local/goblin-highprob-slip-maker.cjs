const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const OUT = "outputs/goblin-highprob-slips.json";
const TXT = "outputs/goblin-highprob-slips.txt";

const MIN_PROB = Number(process.env.GOBLIN_MIN_PROB || 0.68);
const STRONG_PROB = Number(process.env.GOBLIN_STRONG_PROB || 0.70);
const ELITE_PROB = Number(process.env.GOBLIN_ELITE_PROB || 0.73);
const SLIP_SIZES = String(process.env.GOBLIN_SLIP_SIZES || "4,5,6")
  .split(",").map(x => Number(x.trim())).filter(Number.isFinite);
const SLIPS_PER_SIZE = Number(process.env.GOBLIN_SLIPS_PER_SIZE || 5);
const MAX_POOL = Number(process.env.GOBLIN_MAX_POOL || 80);
const ALLOW_HRR = String(process.env.GOBLIN_ALLOW_HRR || "0") === "1";
const ALLOW_FANTASY = String(process.env.GOBLIN_ALLOW_FANTASY || "0") === "1";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

const GOBLIN_HISTORY = readJson("data/learning/goblin-highprob-history.json", { days: [] });

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function market(v) {
  const t = String(v || "").toLowerCase();

  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("strikeouts") || t.includes("strikeout")) return "strikeouts";
  if (t.includes("pitching outs") || t === "outs" || t.includes(" outs")) return "pitching_outs";
  if (t.includes("total bases") || t === "bases") return "bases";
  if (t.includes("hits allowed")) return "hits_allowed";
  if (t === "hits" || t.includes("batter hits") || t.includes("player hits")) return "hits";
  if (t.includes("earned") || t.includes("runs allowed") || t === "runs") return "earned_runs_allowed";
  if (t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walks")) return "walks";

  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function side(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "";
}

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function probability(r) {
  return num(
    r.prob,
    r.probability,
    r.recommendedProb,
    r.calibratedDistributionProb,
    r.contextAdjustedDistributionProb,
    r.distributionProb,
    r.twoSidedPricing?.selectedProb,
    r.finalProbability,
    r.modelProbability
  );
}

function books(r) {
  return num(
    r.books,
    r.bookCount,
    r.sportsbookBookCount,
    r.directBookCount,
    r.supportBooks,
    r.twoSidedPricing?.books
  );
}

function tier(r) {
  const vals = [
    r.oddsTier,
    r.tier,
    r.boardTier,
    r.priceTier,
    r.pickType,
    r.projectionType,
    r.projection_type,
    r.type,
    r.raw?.oddsTier,
    r.raw?.tier,
    r.raw?.boardTier,
    r.raw?.priceTier,
    r.raw?.pickType,
    r.raw?.projectionType,
    r.raw?.type
  ];

  const joined = vals.map(v => String(v || "").toLowerCase()).join(" ");

  if (joined.includes("goblin")) return "goblin";
  if (joined.includes("demon")) return "demon";
  if (joined.includes("standard")) return "standard";

  // Boolean specialTier only means special, not whether it is goblin/demon.
  // Fall back to nested scan only after direct tier fields.
  const blob = JSON.stringify(r).toLowerCase();
  if (blob.includes('"oddstier":"goblin"') || blob.includes('"oddsTier":"goblin"'.toLowerCase())) return "goblin";
  if (blob.includes('"oddstier":"demon"') || blob.includes('"oddsTier":"demon"'.toLowerCase())) return "demon";
  if (blob.includes('"oddstier":"standard"') || blob.includes('"oddsTier":"standard"'.toLowerCase())) return "standard";

  return "";
}

function team(r) {
  return String(r.resolvedTeam || r.team || r.rawTeam || r.playerTeam || "").trim();
}

function player(r) {
  return String(r.player || r.playerName || r.name || "").trim();
}

function isSupportOk(r) {
  const b = books(r) || 0;
  const p = probability(r);
  const flags = [
    r.marketSupportFlag,
    r.support,
    r.supportClass,
    r.directSupportClass,
    r.bookSupportClass,
    r.qualityGrade,
    r.grade,
    r.savantReportGrade,
  ].map(x => String(x || "").toUpperCase());

  // Normal support: real books or explicit green/OK support.
  if (b >= 2) return true;
  if (flags.some(x => ["OK", "GREEN", "PF_SUPPORTED", "PF_STRONG_SUPPORT"].includes(x))) return true;

  // Goblin builder support: goblins are PrizePicks board-native and often do not carry normal book counts.
  // Allow high-prob board-native goblins as TRACK ONLY if not otherwise blocked by negative bias/unknown grade/fantasy/HRR.
  if (tier(r) === "goblin" && Number.isFinite(p) && p >= MIN_PROB) {
    const supportFlag = String(r.marketSupportFlag || "").toUpperCase();
    const grade = String(r.grade || r.qualityGrade || r.savantReportGrade || "").toUpperCase();

    if (supportFlag.includes("PHASE8_UNPRICED")) return false;
    if (grade === "UNKNOWN") return false;

    return true;
  }

  return false;
}

function isPitcherMarketName(m) {
  return [
    "pitching_outs",
    "strikeouts",
    "pitcher_strikeouts",
    "walks_allowed",
    "hits_allowed",
    "earned_runs_allowed",
    "pitcher_fantasy_score",
    "pitches_thrown"
  ].includes(String(m || ""));
}

function hasConfirmedHitterProblem(r, m) {
  if (isPitcherMarketName(m)) return false;

  const lineupStatus = String(r.lineupStatus || "").toLowerCase();
  const playerStatus = String(r.lineupPlayerStatus || "").toLowerCase();

  // Only enforce when a confirmed lineup signal exists.
  const lineupKnown = lineupStatus.includes("confirmed") ||
    r.confirmedLineup === true ||
    r.isConfirmedLineup === true ||
    r.lineupConfirmed === true ||
    playerStatus.includes("confirmed") ||
    playerStatus.includes("not_in_confirmed_lineup");

  if (!lineupKnown) return false;

  return !(
    playerStatus === "confirmed" ||
    playerStatus === "starter" ||
    playerStatus === "in_lineup" ||
    r.confirmedLineup === true ||
    r.isConfirmedLineup === true ||
    r.lineupConfirmed === true
  );
}

function marketProbabilityFloor(m, l) {
  const marketName = String(m || "");
  const lineValue = Number(l);

  if (marketName === "bases" && lineValue === 0.5) return 0.72;
  if (marketName === "hits" && lineValue === 0.5) return 0.72;
  if (marketName === "walks" || marketName === "walks_allowed") return 0.70;
  if (marketName === "strikeouts" || marketName === "pitcher_strikeouts") return 0.70;
  if (marketName === "pitches_thrown") return 0.70;

  return MIN_PROB;
}

function hasPositiveContext(r) {
  const blob = JSON.stringify({
    sideBias: r.sideBias,
    sideBiasClass: r.sideBiasClass,
    grade: r.grade,
    qualityGrade: r.qualityGrade,
    marketSupportFlag: r.marketSupportFlag,
    finalMarketGatePassed: r.finalMarketGatePassed,
    finalMarketSupported: r.finalMarketSupported,
    marketTrust: r.marketTrust,
    validationRule: r.validationRule,
    autoMarketDecision: r.autoMarketDecision
  }).toUpperCase();

  return blob.includes("STRONG_POSITIVE") ||
    blob.includes("GREEN") ||
    blob.includes("FINALMARKETGATEPASSED") ||
    r.finalMarketGatePassed === true;
}

function historicalUnmatchedProne(r, m) {
  const pKey = [
    norm(player(r)),
    String(m || ""),
    side(r.side || r.recommendedSide || r.pick || r.selection),
    String(num(r.line, r.ppLine, r.prizepicksLine))
  ].join("|");

  const legs = (GOBLIN_HISTORY.days || []).flatMap(d => d.legs || []);
  const exact = legs.filter(l => l.key === pKey);
  if (exact.length >= 1 && exact.every(l => l.result === "UNMATCHED")) return true;

  const marketLegs = legs.filter(l => l.market === m);
  if (marketLegs.length >= 8) {
    const unmatched = marketLegs.filter(l => l.result === "UNMATCHED").length;
    if (unmatched / marketLegs.length >= 0.35) return true;
  }

  return false;
}

function rejectReason(r) {
  const m = market(r.market || r.stat || r.projectionType || r.type);
  const s = side(r.side || r.recommendedSide || r.pick || r.selection);
  const p = probability(r);
  const t = tier(r);
  const reasonText = JSON.stringify([
    r.reason,
    r.reasons,
    r.disabledReason,
    r.blockReason,
    r.finalExecutionGate,
    r.sideBias,
    r.sideBiasClass,
    r.autoMarketDecision,
  ]).toLowerCase();

  const l = num(r.line, r.ppLine, r.prizepicksLine);
  const floor = marketProbabilityFloor(m, l);

  // Basic identity/tier/side checks first, so rejection counts stay honest.
  if (!player(r)) return "missing_player";
  if (!team(r)) return "missing_team";
  if (t !== "goblin") return "not_goblin";
  if (s !== "MORE") return "goblin_not_more";
  if (!Number.isFinite(p)) return "missing_probability";

  // Market exclusions before probability floors.
  if (!ALLOW_FANTASY && m.includes("fantasy")) return "fantasy_excluded";
  if (!ALLOW_HRR && m === "hrr") return "hrr_excluded_v1";

  // Goblin-specific risk filters.
  if (historicalUnmatchedProne(r, m)) return "historical_unmatched_prone";
  if (hasConfirmedHitterProblem(r, m)) return "hitter_not_confirmed_active";
  if (p < MIN_PROB) return "below_min_probability";
  if (Number.isFinite(p) && p < floor) return `below_market_probability_floor_${floor}`;
  if (m === "bases" && l === 0.5 && p < 0.72 && !hasPositiveContext(r)) return "bases_more_05_requires_72_or_positive_context";
  if (!isSupportOk(r)) return "support_not_ok";
  if (String(r.marketSupportFlag || "").toUpperCase().includes("PHASE8_UNPRICED")) return "phase8_unpriced";
  if (String(r.grade || r.qualityGrade || "").toUpperCase() === "UNKNOWN") return "unknown_grade";
  if (reasonText.includes("negative_side_bias") || reasonText.includes("high_probability_conflict")) return "negative_side_bias_conflict";

  return null;
}

function legKey(r) {
  return [
    norm(player(r)),
    market(r.market || r.stat || r.projectionType || r.type),
    side(r.side || r.recommendedSide || r.pick || r.selection),
    String(num(r.line, r.ppLine, r.prizepicksLine))
  ].join("|");
}

function playerKey(r) {
  return norm(player(r));
}

function slipTeamValid(legs) {
  const teams = new Set(legs.map(team).filter(Boolean));
  return teams.size >= 2;
}

function samePlayerProjectionCountValid(legs) {
  const counts = new Map();
  for (const l of legs) {
    const k = playerKey(l);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (counts.get(k) > 3) return false;
  }
  return true;
}

function duplicateProjectionValid(legs) {
  const seen = new Set();
  for (const l of legs) {
    const k = legKey(l);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function prizePicksValid(legs) {
  return legs.length <= 6 &&
    slipTeamValid(legs) &&
    samePlayerProjectionCountValid(legs) &&
    duplicateProjectionValid(legs);
}

function stackInfo(legs) {
  const teams = new Map();
  const games = new Map();

  for (const l of legs) {
    const tm = team(l) || "?";
    const gm = String(l.game || l.resolvedGame || l.rawGame || "?");
    teams.set(tm, (teams.get(tm) || 0) + 1);
    games.set(gm, (games.get(gm) || 0) + 1);
  }

  const maxTeam = Math.max(...teams.values());
  const maxGame = Math.max(...games.values());

  return {
    teams: [...teams.entries()].sort((a,b) => b[1] - a[1]),
    games: [...games.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5),
    maxTeam,
    maxGame,
    stackLabel: maxTeam >= legs.length - 1 ? "HEAVY_TEAM_STACK_VALID" :
      maxTeam >= 3 ? "TEAM_STACK_VALID" :
      maxGame >= 3 ? "GAME_STACK_VALID" :
      "LOW_STACK"
  };
}

function legScore(r) {
  const p = probability(r) || 0;
  const e = num(r.edge, r.adjustedEdge, r.expectedValue) || 0;
  const b = books(r) || 0;
  const m = market(r.market || r.stat || r.projectionType || r.type);

  let score = p * 100 + e * 25 + Math.min(b, 10) * 0.5;

  if (p >= ELITE_PROB) score += 8;
  else if (p >= STRONG_PROB) score += 4;

  if (m === "bases" || m === "hits") score -= 2; // chalky goblin hitter MORE caution
  if (m.includes("fantasy")) score -= 10;
  if (m === "hrr") score -= 8;

  return score;
}

const raw = readJson(BOARD, []);
const rows = Array.isArray(raw) ? raw : Object.values(raw).flat();

const rejected = {};
const poolMap = new Map();

for (const r of rows) {
  if (!r || typeof r !== "object") continue;
  if (r.recordType === "pricing_summary") continue;

  const bad = rejectReason(r);
  if (bad) {
    rejected[bad] = (rejected[bad] || 0) + 1;
    continue;
  }

  const leg = {
    player: player(r),
    team: team(r),
    game: r.resolvedGame || r.game || r.rawGame || "",
    market: market(r.market || r.stat || r.projectionType || r.type),
    side: side(r.side || r.recommendedSide || r.pick || r.selection),
    line: num(r.line, r.ppLine, r.prizepicksLine),
    tier: tier(r),
    probability: probability(r),
    edge: num(r.edge, r.adjustedEdge, r.expectedValue),
    books: books(r),
    support: r.marketSupportFlag || r.supportClass || r.directSupportClass || r.bookSupportClass || "OK",
    grade: r.grade || r.qualityGrade || r.savantReportGrade || "",
    score: 0,
    raw: r
  };

  leg.score = legScore(leg);
  const k = legKey(leg);
  const prev = poolMap.get(k);
  if (!prev || leg.score > prev.score) poolMap.set(k, leg);
}

const pool = [...poolMap.values()]
  .sort((a,b) => b.score - a.score)
  .slice(0, MAX_POOL);

function makeSlip(size, startOffset = 0) {
  const selected = [];
  const used = new Set();

  const rotated = [...pool.slice(startOffset), ...pool.slice(0, startOffset)];

  for (const leg of rotated) {
    if (selected.length >= size) break;
    if (used.has(legKey(leg))) continue;

    const trial = [...selected, leg];
    if (!samePlayerProjectionCountValid(trial)) continue;
    if (!duplicateProjectionValid(trial)) continue;

    selected.push(leg);
    used.add(legKey(leg));
  }

  if (selected.length !== size) return null;

  // If all same team, replace last leg with highest valid outside-team leg.
  if (!slipTeamValid(selected)) {
    const baseTeam = team(selected[0]);
    for (const leg of pool) {
      if (team(leg) === baseTeam) continue;
      const trial = [...selected.slice(0, -1), leg];
      if (prizePicksValid(trial)) {
        selected.splice(selected.length - 1, 1, leg);
        break;
      }
    }
  }

  if (!prizePicksValid(selected)) return null;

  const probs = selected.map(x => x.probability || 0);
  const avgProb = probs.reduce((a,b) => a+b, 0) / probs.length;
  const minProb = Math.min(...probs);
  const info = stackInfo(selected);

  return {
    type: `${size}-man goblin high-prob`,
    status: "TRACK_ONLY",
    size,
    avgProb,
    minProb,
    score: selected.reduce((a,b) => a + b.score, 0),
    prizePicksTeamValid: true,
    sameTeamStackAllowed: true,
    maxThreeProjectionsPerPlayerValid: samePlayerProjectionCountValid(selected),
    stackInfo: info,
    legs: selected
  };
}

const slips = [];
for (const size of SLIP_SIZES) {
  let tries = 0;
  let offset = 0;
  while (slips.filter(s => s.size === size).length < SLIPS_PER_SIZE && tries < pool.length * 3) {
    const slip = makeSlip(size, offset % Math.max(pool.length, 1));
    offset += Math.max(1, Math.floor(size / 2));
    tries++;

    if (!slip) continue;

    const sig = slip.legs.map(legKey).sort().join("||");
    if (slips.some(s => s.signature === sig)) continue;

    slip.name = `goblin_highprob_${size}_man_${slips.filter(s => s.size === size).length + 1}`;
    slip.signature = sig;
    slips.push(slip);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  rules: {
    minProb: MIN_PROB,
    strongProb: STRONG_PROB,
    eliteProb: ELITE_PROB,
    slipSizes: SLIP_SIZES,
    slipsPerSize: SLIPS_PER_SIZE,
    goblinOnly: true,
    moreOnly: true,
    allowSameTeamStacks: true,
    requireAtLeastTwoTeams: true,
    maxProjectionsPerPlayer: 3,
    fantasyAllowed: ALLOW_FANTASY,
    hrrAllowed: ALLOW_HRR
  },
  rawRows: rows.length,
  pool: pool.length,
  slips: slips.length,
  bySize: Object.fromEntries(SLIP_SIZES.map(s => [s, slips.filter(x => x.size === s).length])),
  rejected
};

fs.writeFileSync(OUT, JSON.stringify({ summary, pool, slips }, null, 2) + "\n");

const lines = [];
lines.push("GOBLIN HIGH-PROBABILITY SLIP MAKER");
lines.push("==================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");
lines.push("NOTE: TRACK ONLY. Not official. Same-team stacks are PrizePicks-valid if at least two teams are represented.");
lines.push("");

for (const slip of slips) {
  lines.push(`${slip.name} | ${slip.type} | ${slip.status} | avgProb=${(slip.avgProb*100).toFixed(1)}% | minProb=${(slip.minProb*100).toFixed(1)}% | stack=${slip.stackInfo.stackLabel}`);
  lines.push(`Teams: ${slip.stackInfo.teams.map(([t,c]) => `${t}:${c}`).join(", ")}`);
  slip.legs.forEach((l, i) => {
    lines.push(`${i + 1}. ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | prob=${(l.probability*100).toFixed(1)}% | books=${l.books ?? "?"} | support=${l.support}`);
  });
  lines.push("");
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
