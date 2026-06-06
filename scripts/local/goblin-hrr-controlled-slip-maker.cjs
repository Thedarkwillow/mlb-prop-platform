const fs = require("fs");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

const BOARD = process.env.GOBLIN_HRR_BOARD || "outputs/priced-board.json";
const OUT = process.env.GOBLIN_HRR_OUT_JSON || "outputs/goblin-hrr-controlled-slips.json";
const TXT = process.env.GOBLIN_HRR_OUT_TXT || "outputs/goblin-hrr-controlled-slips.txt";

const HRR_MIN_PROB = Number(process.env.GOBLIN_HRR_MIN_PROB || 0.70);
const FILLER_MIN_PROB = Number(process.env.GOBLIN_HRR_FILLER_MIN_PROB || 0.72);
const SLIP_SIZES = [4, 5, 6];
const SLIPS_PER_SIZE = 5;
const MAX_HRR_PER_SLIP = 1;
const MAX_PROJECTIONS_PER_PLAYER = 3;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function player(r) {
  return r.player || r.playerName || r.name || "";
}

function team(r) {
  return String(r.resolvedTeam || r.team || r.rawTeam || r.playerTeam || "").trim();
}

function side(r) {
  const s = String(r.side || r.recommendedSide || r.playableSide || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return s;
}

function market(r) {
  const t = String(r.market || r.stat || r.projectionType || r.type || "").toLowerCase();

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

function tier(r) {
  const vals = [
    r.oddsTier,
    r.tier,
    r.boardTier,
    r.priceTier,
    r.pickType,
    r.projectionType,
    r.raw?.oddsTier,
    r.raw?.tier,
    r.raw?.boardTier,
    r.raw?.priceTier,
    r.raw?.pickType,
    r.raw?.projectionType
  ];

  for (const v of vals) {
    const s = String(v || "").toLowerCase();
    if (s.includes("goblin")) return "goblin";
    if (s.includes("demon")) return "demon";
    if (s.includes("standard")) return "standard";
  }

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
    r.preContextCalibratedDistributionProb,
    r.distributionProb,
    r.twoSidedPricing?.selectedProb,
    r.raw?.prob,
    r.raw?.probability,
    r.raw?.recommendedProb
  );
}

function hasNegativeBias(r) {
  const blob = JSON.stringify({
    sideBias: r.sideBias,
    sideBiasClass: r.sideBiasClass,
    reasons: r.reasons,
    reason: r.reason,
    disabledReason: r.disabledReason,
    finalExecutionGate: r.finalExecutionGate,
    autoMarketDecision: r.autoMarketDecision,
    validationRule: r.validationRule,
    marketTrust: r.marketTrust
  }).toLowerCase();

  return blob.includes("negative_side_bias") ||
    blob.includes("sidebias=negative") ||
    blob.includes("negative") ||
    blob.includes("high_probability_conflict") ||
    blob.includes("suppress") ||
    blob.includes("fade");
}

function confirmedOrUnknownOk(r) {
  const playerStatus = String(r.lineupPlayerStatus || "").toLowerCase();
  const lineupStatus = String(r.lineupStatus || "").toLowerCase();

  const known = lineupStatus.includes("confirmed") ||
    r.confirmedLineup === true ||
    r.isConfirmedLineup === true ||
    r.lineupConfirmed === true ||
    playerStatus.includes("confirmed") ||
    playerStatus.includes("not_in_confirmed_lineup");

  if (!known) return true;

  return playerStatus === "confirmed" ||
    playerStatus === "starter" ||
    playerStatus === "in_lineup" ||
    r.confirmedLineup === true ||
    r.isConfirmedLineup === true ||
    r.lineupConfirmed === true;
}

function isSupportOk(r) {
  const support = String(r.marketSupportFlag || r.support || r.priceCoverageTier || "").toUpperCase();
  const grade = String(r.grade || r.qualityGrade || r.savantReportGrade || "").toUpperCase();

  if (support.includes("PHASE8_UNPRICED")) return false;
  if (support.includes("UNKNOWN")) return false;
  if (grade.includes("FADE")) return false;

  return true;
}

function isBadFillerMarket(m) {
  // First goblin test: hits MORE went 0/7, walks were all unmatched.
  return m === "hits" || m === "walks" || m === "walks_allowed";
}

function fillerFloor(m, line) {
  if (m === "bases" && Number(line) === 0.5) return 0.72;
  if (m === "earned_runs_allowed") return 0.72;
  if (m === "hits_allowed") return 0.72;
  if (m === "strikeouts") return 0.72;
  return FILLER_MIN_PROB;
}

function rejectHrrAnchor(r) {
  const p = probability(r);
  const l = num(r.line, r.ppLine, r.prizepicksLine);

  if (!player(r)) return "missing_player";
  if (!team(r)) return "missing_team";
  if (tier(r) !== "goblin") return "not_goblin";
  if (market(r) !== "hrr") return "not_hrr";
  if (side(r) !== "MORE") return "not_more";
  if (l !== 0.5) return "hrr_v1_only_line_0_5";
  if (!Number.isFinite(p)) return "missing_probability";
  if (p < HRR_MIN_PROB) return "below_hrr_min_probability";
  if (hasNegativeBias(r)) return "negative_bias_or_conflict";
  if (!confirmedOrUnknownOk(r)) return "hitter_not_confirmed_active";

  return null;
}

function rejectFiller(r) {
  const p = probability(r);
  const m = market(r);
  const l = num(r.line, r.ppLine, r.prizepicksLine);

  if (!player(r)) return "missing_player";
  if (!team(r)) return "missing_team";
  if (tier(r) !== "goblin") return "not_goblin";
  if (m === "hrr") return "filler_not_hrr";
  if (side(r) !== "MORE") return "not_more";
  if (!Number.isFinite(p)) return "missing_probability";
  if (m.includes("fantasy")) return "fantasy_excluded";
  if (isBadFillerMarket(m)) return `bad_filler_market_${m}`;
  if (!confirmedOrUnknownOk(r)) return "hitter_not_confirmed_active";
  if (hasNegativeBias(r)) return "negative_bias_or_conflict";
  if (!isSupportOk(r)) return "support_not_ok";
  if (p < fillerFloor(m, l)) return `below_filler_floor_${fillerFloor(m, l)}`;

  return null;
}

function legKey(l) {
  return [norm(l.player), l.market, l.side, String(l.line)].join("|");
}

function playerKey(l) {
  return norm(l.player);
}

function makeLeg(r, role) {
  const m = market(r);
  return {
    player: player(r),
    team: team(r),
    market: m,
    stat: r.stat || m,
    side: "MORE",
    line: num(r.line, r.ppLine, r.prizepicksLine),
    probability: probability(r),
    edge: num(r.edge, r.adjustedEdge, r.expectedValue),
    tier: "goblin",
    role,
    support: r.marketSupportFlag || r.support || "BOARD_NATIVE",
    grade: r.grade || r.qualityGrade || r.savantReportGrade || "",
    sideBias: r.sideBias || r.sideBiasClass || "",
    lineupStatus: r.lineupStatus || "",
    lineupPlayerStatus: r.lineupPlayerStatus || "",
    game: r.resolvedGame || r.game || r.rawGame || "",
    raw: r
  };
}

function canAdd(slip, leg) {
  if (slip.some(x => legKey(x) === legKey(leg))) return false;

  const samePlayer = slip.filter(x => playerKey(x) === playerKey(leg)).length;
  if (samePlayer >= MAX_PROJECTIONS_PER_PLAYER) return false;

  const hrrCount = slip.filter(x => x.market === "hrr").length;
  if (leg.market === "hrr" && hrrCount >= MAX_HRR_PER_SLIP) return false;

  return true;
}

function buildSlips(hrrPool, fillerPool, size) {
  const slips = [];

  for (let start = 0; start < hrrPool.length && slips.length < SLIPS_PER_SIZE; start++) {
    const slip = [hrrPool[start]];

    for (const leg of fillerPool) {
      if (slip.length >= size) break;
      if (canAdd(slip, leg)) slip.push(leg);
    }

    if (slip.length !== size) continue;

    const validation = prizePicksSlipValidation(slip);
    if (!validation.valid) continue;

    const teams = {};
    for (const l of slip) teams[l.team] = (teams[l.team] || 0) + 1;

    slips.push({
      name: `goblin_hrr_controlled_${size}_man_${slips.length + 1}`,
      type: `${size}-man controlled HRR goblin`,
      status: "TRACK_ONLY",
      reason: "controlled_hrr_reintroduction_v1_hrr_anchor_clean_fillers",
      size,
      avgProb: slip.reduce((a,l) => a + (l.probability || 0), 0) / slip.length,
      minProb: Math.min(...slip.map(l => l.probability || 0)),
      maxHrrPerSlip: MAX_HRR_PER_SLIP,
      teams,
      prizePicksValidation: validation,
      legs: slip
    });
  }

  return slips;
}


const BASE_GOBLIN = process.env.GOBLIN_HRR_BASE_JSON || "outputs/goblin-highprob-slips.json";

function existingGoblinSlips() {
  const data = readJson(BASE_GOBLIN, {});
  return Array.isArray(data.slips) ? data.slips : [];
}


function injectedBaseFillerOk(rawLeg) {
  const l = rawLeg?.raw || rawLeg;
  const m = market(l);
  const p = probability(l);

  if (!player(l)) return false;
  if (!team(l)) return false;
  if (m === "hrr") return false;
  if (m.includes("fantasy")) return false;
  if (!["earned_runs_allowed", "hits_allowed"].includes(m)) return false;
  if (side(l) !== "MORE") return false;
  if (!Number.isFinite(p)) return false;
  if (p < 0.68) return false;

  return true;
}

function injectHrrIntoBaseSlips(hrrPool, baseSlips) {
  const out = [];
  let hrrIndex = 0;

  for (const base of baseSlips) {
    if (!base || !Array.isArray(base.legs) || !base.legs.length) continue;
    const size = Number(base.size || base.legs.length);
    if (![4,5,6].includes(size)) continue;

    const baseLegs = base.legs
      .filter(l => injectedBaseFillerOk(l))
      .map(l => makeLeg(l.raw || l, "FILLER"))
      .filter(l => l.market !== "hrr");

    if (baseLegs.length < size - 1) continue;

    const anchor = hrrPool[hrrIndex % Math.max(1, hrrPool.length)];
    if (!anchor) continue;
    hrrIndex++;

    const fillers = baseLegs
      .sort((a,b) => (b.probability || 0) - (a.probability || 0))
      .filter(l => playerKey(l) !== playerKey(anchor))
      .slice(0, size - 1);

    const slip = [anchor, ...fillers];

    if (slip.length !== size) continue;

    const validation = prizePicksSlipValidation(slip);
    if (!validation.valid) continue;

    const teams = {};
    for (const l of slip) teams[l.team] = (teams[l.team] || 0) + 1;

    out.push({
      name: `goblin_hrr_controlled_injected_${size}_man_${out.filter(x => x.size === size).length + 1}`,
      type: `${size}-man controlled HRR goblin injected`,
      status: "TRACK_ONLY",
      reason: "controlled_hrr_reintroduction_v1_hrr_anchor_injected_into_tightened_goblin",
      size,
      avgProb: slip.reduce((a,l) => a + (l.probability || 0), 0) / slip.length,
      minProb: Math.min(...slip.map(l => l.probability || 0)),
      maxHrrPerSlip: MAX_HRR_PER_SLIP,
      sourceBaseSlip: base.name || base.type || "",
      teams,
      prizePicksValidation: validation,
      legs: slip
    });
  }

  return out
    .filter((s, _, arr) => arr.filter(x => x.size === s.size).indexOf(s) < SLIPS_PER_SIZE)
    .slice(0, SLIP_SIZES.length * SLIPS_PER_SIZE);
}

const rows = readJson(BOARD, []).filter(x => x && typeof x === "object");

const hrrRejected = {};
const fillerRejected = {};
const hrrPool = [];
const fillerPool = [];

for (const r of rows) {
  const hrrReason = rejectHrrAnchor(r);
  if (!hrrReason) hrrPool.push(makeLeg(r, "HRR_ANCHOR"));
  else hrrRejected[hrrReason] = (hrrRejected[hrrReason] || 0) + 1;

  const fillerReason = rejectFiller(r);
  if (!fillerReason) fillerPool.push(makeLeg(r, "FILLER"));
  else fillerRejected[fillerReason] = (fillerRejected[fillerReason] || 0) + 1;
}

hrrPool.sort((a,b) =>
  (b.probability || 0) - (a.probability || 0) ||
  (b.edge || 0) - (a.edge || 0)
);

fillerPool.sort((a,b) =>
  (b.probability || 0) - (a.probability || 0) ||
  (b.edge || 0) - (a.edge || 0)
);

const baseSlips = existingGoblinSlips();
let slips = SLIP_SIZES.flatMap(size => buildSlips(hrrPool, fillerPool, size));
if (!slips.length && hrrPool.length && baseSlips.length) {
  slips = injectHrrIntoBaseSlips(hrrPool, baseSlips);
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  rules: {
    hrrMinProb: HRR_MIN_PROB,
    fillerMinProb: FILLER_MIN_PROB,
    slipSizes: SLIP_SIZES,
    slipsPerSize: SLIPS_PER_SIZE,
    goblinOnly: true,
    hrrAnchorOnly: true,
    hrrLineOnly: 0.5,
    moreOnly: true,
    maxHrrPerSlip: MAX_HRR_PER_SLIP,
    maxProjectionsPerPlayer: MAX_PROJECTIONS_PER_PLAYER,
    requireAtLeastTwoTeams: true,
    excludedFillers: ["bases", "hits", "walks", "walks_allowed", "strikeouts", "fantasy", "hrr"],
    allowedFillers: ["earned_runs_allowed", "hits_allowed"],
    trackOnly: true
  },
  rawRows: rows.length,
  hrrPool: hrrPool.length,
  fillerPool: fillerPool.length,
  baseGoblinSlips: baseSlips.length,
  injectionModeUsed: slips.some(s => String(s.reason || '').includes('injected')),
  slips: slips.length,
  bySize: Object.fromEntries(SLIP_SIZES.map(s => [s, slips.filter(x => x.size === s).length])),
  hrrRejected,
  fillerRejected
};

fs.writeFileSync(OUT, JSON.stringify({ summary, hrrPool, fillerPool, slips }, null, 2) + "\n");

const lines = [];
lines.push("CONTROLLED HRR GOBLIN SLIP MAKER");
lines.push("=================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");
lines.push("NOTE: TRACK ONLY. HRR goblin MORE 0.5 anchor + clean non-HRR goblin fillers.");
for (const slip of slips) {
  lines.push("");
  lines.push(`${slip.name} | ${slip.type} | ${slip.status} | avgProb=${(slip.avgProb*100).toFixed(1)}% | minProb=${(slip.minProb*100).toFixed(1)}%`);
  lines.push(`Teams: ${Object.entries(slip.teams).map(([t,n]) => `${t}:${n}`).join(", ")}`);
  for (const [i,l] of slip.legs.entries()) {
    lines.push(`${i+1}. ${l.role} | ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | prob=${(l.probability*100).toFixed(1)}% | sideBias=${l.sideBias || "?"}`);
  }
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
