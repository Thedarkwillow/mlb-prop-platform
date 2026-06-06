const fs = require("fs");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

const BOARD = process.env.GOBLIN_HRR_BOARD || "outputs/priced-board.json";
const OUT = process.env.GOBLIN_HRR_OUT_JSON || "outputs/goblin-hrr-controlled-slips.json";
const TXT = process.env.GOBLIN_HRR_OUT_TXT || "outputs/goblin-hrr-controlled-slips.txt";

const HRR_MIN_PROB = Number(process.env.GOBLIN_HRR_MIN_PROB || 0.70);
const FILLER_MIN_PROB = Number(process.env.GOBLIN_HRR_FILLER_MIN_PROB || 0.68);
const SLIP_SIZES = [2, 3, 4, 5, 6];
const SLIPS_PER_SIZE = 5;
const MAX_PROJECTIONS_PER_PLAYER = 3;

const BAD_FILLER_PLAYERS = new Set(["reiddetmers", "jackperkins"]);
const ALLOWED_FILLER_MARKETS = new Set(["earned_runs_allowed", "hits_allowed"]);

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
  return r?.player || r?.playerName || r?.name || "";
}

function team(r) {
  return r?.resolvedTeam || r?.team || r?.rawTeam || "";
}

function tier(r) {
  const vals = [
    r?.oddsTier,
    r?.tier,
    r?.boardTier,
    r?.priceTier,
    r?.pickType,
    r?.projectionType,
    r?.projection_type,
    r?.type,
    r?.raw?.oddsTier,
    r?.raw?.tier,
    r?.raw?.boardTier,
    r?.raw?.priceTier,
    r?.raw?.pickType,
    r?.raw?.projectionType,
    r?.raw?.type
  ];
  for (const v of vals) {
    const t = String(v || "").toLowerCase();
    if (t.includes("goblin")) return "goblin";
    if (t.includes("demon")) return "demon";
    if (t.includes("standard")) return "standard";
  }
  return "";
}

function market(r) {
  const t = String(r?.market || r?.stat || r?.projectionType || r?.type || "").toLowerCase();
  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("earned") || t.includes("runs allowed")) return "earned_runs_allowed";
  if (t.includes("hits allowed")) return "hits_allowed";
  if (t.includes("strikeouts") || t.includes("strikeout")) return "strikeouts";
  if (t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walks")) return "walks";
  if (t.includes("total bases") || t === "bases") return "bases";
  if (t === "hits" || t.includes("batter hits") || t.includes("player hits")) return "hits";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function side(r) {
  return String(r?.side || r?.recommendedSide || r?.playableSide || "").toUpperCase();
}

function probability(r) {
  const vals = [
    r?.prob,
    r?.probability,
    r?.recommendedProb,
    r?.calibratedDistributionProb,
    r?.contextAdjustedDistributionProb,
    r?.distributionProb,
    r?.twoSidedPricing?.selectedProb
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isConfirmedActive(r) {
  const m = market(r);
  if (m === "earned_runs_allowed" || m === "hits_allowed") return true;

  const status = String(
    r?.lineupPlayerStatus ||
    r?.confirmedLineupStatus ||
    r?.lineupStatus ||
    ""
  ).toLowerCase();

  if (r?.confirmedLineup === true || r?.isConfirmedLineup === true || status === "confirmed") return true;
  if (status.includes("not_in_confirmed_lineup")) return false;
  return true;
}

function rejectHrr(r) {
  if (!player(r)) return "missing_player";
  if (tier(r) !== "goblin") return "not_goblin";
  if (market(r) !== "hrr") return "not_hrr";
  if (side(r) !== "MORE") return "not_more";
  if (Number(r?.line) !== 0.5) return "hrr_v1_only_line_0_5";
  if (!isConfirmedActive(r)) return "hitter_not_confirmed_active";
  const p = probability(r);
  if (!Number.isFinite(p) || p < HRR_MIN_PROB) return "below_hrr_min_probability";
  return null;
}

function rejectFiller(r) {
  if (!player(r)) return "missing_player";
  if (tier(r) !== "goblin") return "not_goblin";
  if (BAD_FILLER_PLAYERS.has(norm(player(r)))) return "historical_unmatched_prone_filler";
  const m = market(r);
  if (!ALLOWED_FILLER_MARKETS.has(m)) return `bad_filler_market_${m || "unknown"}`;
  if (side(r) !== "MORE") return "not_more";
  if (!isConfirmedActive(r)) return "filler_not_active";
  const p = probability(r);
  if (!Number.isFinite(p) || p < FILLER_MIN_PROB) return "below_filler_min_probability";
  return null;
}

function makeLeg(r, role) {
  return {
    role,
    player: player(r),
    team: team(r),
    resolvedTeam: team(r),
    market: market(r),
    side: side(r),
    line: Number(r?.line),
    prob: probability(r),
    probability: probability(r),
    oddsTier: tier(r),
    support: "OK",
    raw: r
  };
}

function avg(xs) {
  const ns = xs.map(Number).filter(Number.isFinite);
  return ns.length ? ns.reduce((a,b) => a + b, 0) / ns.length : null;
}

function entryTypesForSize(size) {
  const n = Number(size);
  if (n === 2) return ["POWER"];
  return ["POWER", "FLEX"];
}

function playerProjectionCountsOk(legs) {
  const counts = new Map();
  for (const l of legs) {
    const k = norm(player(l));
    counts.set(k, (counts.get(k) || 0) + 1);
    if (counts.get(k) > MAX_PROJECTIONS_PER_PLAYER) return false;
  }
  return true;
}


function teamCountsObject(legs) {
  const out = {};
  for (const leg of Array.isArray(legs) ? legs : []) {
    const t = team(leg);
    if (!t) continue;
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

function slipName(size, idx, entryType) {
  return `goblin_hrr_controlled_${size}_man_${idx}_${String(entryType).toLowerCase()}`;
}

function buildSlips(hrrPool, fillerPool) {
  const base = [];

  for (const size of SLIP_SIZES) {
    const neededFillers = size - 1;
    if (fillerPool.length < neededFillers) continue;

    let made = 0;
    let hrrIdx = 0;
    let fillerStart = 0;

    while (made < SLIPS_PER_SIZE && hrrIdx < hrrPool.length * 2) {
      const hrr = hrrPool[hrrIdx % hrrPool.length];
      const fillers = [];

      for (let i = 0; i < fillerPool.length && fillers.length < neededFillers; i++) {
        const f = fillerPool[(fillerStart + i) % fillerPool.length];
        if (norm(player(f)) === norm(player(hrr))) continue;
        fillers.push(f);
      }

      hrrIdx++;
      fillerStart++;

      if (fillers.length !== neededFillers) continue;

      const legs = [makeLeg(hrr, "HRR_ANCHOR"), ...fillers.map(f => makeLeg(f, "FILLER"))];

      if (!playerProjectionCountsOk(legs)) continue;

      const validation = prizePicksSlipValidation(legs);
      if (!validation.valid) continue;

      made++;
      base.push({
        name: `goblin_hrr_controlled_${size}_man_${made}`,
        label: `${size}-man controlled HRR goblin`,
        status: "TRACK_ONLY",
        size,
        avgProb: avg(legs.map(l => l.prob)),
        minProb: Math.min(...legs.map(l => Number(l.prob)).filter(Number.isFinite)),
        teams: teamCountsObject(legs),
        prizePicksValid: validation.valid,
        prizePicksValidation: validation,
        legs
      });
    }
  }

  const expanded = [];
  const perSizeTypeCount = {};
  for (const slip of base) {
    for (const entryType of entryTypesForSize(slip.size)) {
      const key = `${slip.size}_${entryType}`;
      perSizeTypeCount[key] = (perSizeTypeCount[key] || 0) + 1;
      expanded.push({
        ...slip,
        name: slipName(slip.size, perSizeTypeCount[key], entryType),
        entryType,
        payoutMode: entryType
      });
    }
  }

  return expanded;
}

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "n/a";
}

const rows = readJson(BOARD, []).filter(r => r && typeof r === "object" && r.recordType !== "pricing_summary");

const hrrRejected = {};
const fillerRejected = {};
const hrrPool = [];
const fillerPool = [];

for (const r of rows) {
  const hrrReason = rejectHrr(r);
  if (!hrrReason) hrrPool.push(r);
  else hrrRejected[hrrReason] = (hrrRejected[hrrReason] || 0) + 1;

  const fillerReason = rejectFiller(r);
  if (!fillerReason) fillerPool.push(r);
  else fillerRejected[fillerReason] = (fillerRejected[fillerReason] || 0) + 1;
}

hrrPool.sort((a,b) => probability(b) - probability(a));
fillerPool.sort((a,b) => probability(b) - probability(a));

const slips = buildSlips(hrrPool, fillerPool);

const bySize = {};
for (const s of slips) bySize[s.size] = (bySize[s.size] || 0) + 1;

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
    maxProjectionsPerPlayer: MAX_PROJECTIONS_PER_PLAYER,
    requireAtLeastTwoTeams: true,
    allowedFillers: [...ALLOWED_FILLER_MARKETS],
    excludedFillers: ["bases", "hits", "walks", "walks_allowed", "strikeouts", "fantasy", "hrr"],
    entryTypes: "POWER for 2-6, FLEX for 3-6",
    trackOnly: true,
    cleanBuilderV2: true
  },
  rawRows: rows.length,
  hrrPool: hrrPool.length,
  fillerPool: fillerPool.length,
  slips: slips.length,
  bySize,
  hrrRejected,
  fillerRejected
};

const out = { summary, slips };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

const lines = [];
lines.push("CONTROLLED HRR GOBLIN SLIP MAKER");
lines.push("=================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("NOTE: TRACK ONLY. HRR goblin MORE 0.5 anchor + pitcher-damage fillers only.");
for (const slip of slips) {
  lines.push("");
  lines.push(`${slip.name} | ${slip.size}-man ${slip.entryType} controlled HRR goblin | ${slip.status} | avgProb=${fmtPct(slip.avgProb)} | minProb=${fmtPct(slip.minProb)}`);
  lines.push(`Teams: ${Object.entries(slip.teams).map(([t,c]) => `${t}:${c}`).join(", ")}`);
  slip.legs.forEach((l, i) => {
    lines.push(`${i + 1}. ${l.role} | ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | prob=${fmtPct(l.prob)}`);
  });
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
