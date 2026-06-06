const fs = require("fs");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

const BOARD = process.env.GOBLIN_BOARD || "outputs/priced-board.json";
const OUT = "outputs/goblin-highprob-slips.json";
const TXT = "outputs/goblin-highprob-slips.txt";

const SLIP_SIZES = [2, 3, 4, 5, 6];
const SLIPS_PER_SIZE = Number(process.env.GOBLIN_SLIPS_PER_SIZE || 5);
const MAX_PROJECTIONS_PER_PLAYER = 3;

const ALLOWED_MARKETS = new Set([
  "earned_runs_allowed",
  "hits_allowed"
]);

const BLOCKED_PLAYERS = new Set([
  "reiddetmers",
  "jackperkins",
  "fostergriffin",
  "frambervaldez"
]);

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
  return String(r?.player || r?.playerName || r?.name || "").trim();
}

function team(r) {
  return String(r?.resolvedTeam || r?.team || r?.rawTeam || r?.playerTeam || "").trim();
}

function market(r) {
  const t = String(r?.market || r?.stat || r?.projectionType || r?.type || "").toLowerCase();
  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("earned") || t.includes("runs allowed")) return "earned_runs_allowed";
  if (t.includes("hits allowed")) return "hits_allowed";
  if (t.includes("strikeout")) return "strikeouts";
  if (t.includes("pitching outs") || t === "outs" || t.includes(" outs")) return "pitching_outs";
  if (t.includes("total bases") || t === "bases") return "bases";
  if (t === "hits" || t.includes("batter hits") || t.includes("player hits")) return "hits";
  if (t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walks")) return "walks";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function side(r) {
  return String(r?.side || r?.playableSide || r?.recommendedSide || "").toUpperCase();
}

function tier(r) {
  const vals = [
    r?.oddsTier,
    r?.tier,
    r?.boardTier,
    r?.priceTier,
    r?.pickType,
    r?.projectionType,
    r?.type,
    r?.raw?.oddsTier,
    r?.raw?.tier,
    r?.raw?.boardTier,
    r?.raw?.priceTier,
    r?.raw?.pickType,
    r?.raw?.projectionType,
    r?.raw?.type
  ];
  return vals.map(x => String(x || "").toLowerCase()).find(Boolean) || "";
}

function probability(r) {
  const vals = [
    r?.recommendedProb,
    r?.probability,
    r?.prob,
    r?.hitProbability,
    r?.modelProb,
    r?.calibratedProb,
    r?.p
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
  }
  return null;
}

function line(r) {
  const n = Number(r?.line ?? r?.ppLine ?? r?.prizepicksLine);
  return Number.isFinite(n) ? n : null;
}

function marketFloor(m) {
  if (m === "earned_runs_allowed") return 0.68;
  if (m === "hits_allowed") return 0.68;
  return 0.99;
}

function reject(r) {
  const p = player(r);
  const t = team(r);
  const m = market(r);
  const pr = probability(r);
  const sd = side(r);
  const tr = tier(r);

  if (!p) return "missing_player";
  if (!t) return "missing_team";
  if (!tr.includes("goblin")) return "not_goblin";
  if (sd !== "MORE") return "not_more";
  if (!ALLOWED_MARKETS.has(m)) return `bad_market_${m || "unknown"}`;
  if (BLOCKED_PLAYERS.has(norm(p))) return "historical_unmatched_prone";
  if (!Number.isFinite(pr)) return "missing_probability";
  if (pr < marketFloor(m)) return `below_market_floor_${marketFloor(m)}`;
  if (!Number.isFinite(line(r))) return "missing_line";
  return "";
}

function legKey(r) {
  return [
    norm(player(r)),
    market(r),
    side(r),
    String(line(r))
  ].join("|");
}

function makeLeg(r) {
  return {
    player: player(r),
    team: team(r),
    market: market(r),
    side: side(r),
    line: line(r),
    probability: probability(r),
    prob: probability(r),
    oddsTier: "goblin",
    role: "GOBLIN_HIGHPROB",
    raw: r
  };
}

function teamCounts(legs) {
  const out = {};
  for (const l of legs) {
    const t = team(l);
    if (t) out[t] = (out[t] || 0) + 1;
  }
  return out;
}

function marketCounts(legs) {
  const out = {};
  for (const l of legs) {
    const m = market(l);
    if (m) out[m] = (out[m] || 0) + 1;
  }
  return out;
}

function validCombo(legs) {
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > 6) return false;

  const keys = new Set();
  const playerCounts = new Map();

  for (const leg of legs) {
    const k = legKey(leg);
    if (keys.has(k)) return false;
    keys.add(k);

    const p = norm(player(leg));
    playerCounts.set(p, (playerCounts.get(p) || 0) + 1);
    if (playerCounts.get(p) > MAX_PROJECTIONS_PER_PLAYER) return false;
  }

  const validation = prizePicksSlipValidation(legs);
  return Boolean(validation.valid);
}

function slipScore(legs) {
  const probs = legs.map(x => probability(x)).filter(Number.isFinite);
  const minProb = Math.min(...probs);
  const avgProb = probs.reduce((a,b) => a + b, 0) / probs.length;

  let score = avgProb * 700 + minProb * 500;

  const markets = marketCounts(legs);
  if ((markets.earned_runs_allowed || 0) === legs.length) score -= 35;
  if ((markets.hits_allowed || 0) > 0) score += 8;

  return score;
}

function buildSlip(pool, size, start) {
  const legs = [];
  const used = new Set();

  for (let step = 0; step < pool.length * 2 && legs.length < size; step++) {
    const r = pool[(start + step) % pool.length];
    const k = legKey(r);
    if (used.has(k)) continue;

    const next = [...legs, makeLeg(r)];
    if (!validCombo(next) && next.length >= 2) continue;

    legs.push(makeLeg(r));
    used.add(k);
  }

  if (legs.length !== size) return null;
  if (!validCombo(legs)) return null;
  return legs;
}

function buildSlips(pool) {
  const slips = [];

  for (const size of SLIP_SIZES) {
    let made = 0;
    for (let start = 0; start < pool.length * 3 && made < SLIPS_PER_SIZE; start++) {
      const legs = buildSlip(pool, size, start);
      if (!legs) continue;

      const duplicate = slips.some(s => {
        const a = s.legs.map(legKey).sort().join("||");
        const b = legs.map(legKey).sort().join("||");
        return a === b;
      });
      if (duplicate) continue;

      made++;
      const probs = legs.map(x => probability(x));
      slips.push({
        id: `goblin_highprob_clean_${size}_man_${made}`,
        name: `goblin_highprob_clean_${size}_man_${made}`,
        size,
        status: "TRACK_ONLY",
        lane: size <= 3 ? "PRIMARY_TRACK" : "UPSIDE_TRACK",
        avgProb: probs.reduce((a,b) => a + b, 0) / probs.length,
        minProb: Math.min(...probs),
        score: slipScore(legs),
        teams: teamCounts(legs),
        markets: marketCounts(legs),
        prizePicksValid: prizePicksSlipValidation(legs).valid,
        validation: prizePicksSlipValidation(legs),
        legs
      });
    }
  }

  return slips.sort((a,b) => b.score - a.score);
}

const rows = readJson(BOARD, []).filter(x => x && typeof x === "object");
const rejected = {};
const pool = [];

for (const r of rows) {
  const why = reject(r);
  if (why) {
    rejected[why] = (rejected[why] || 0) + 1;
    continue;
  }
  pool.push(r);
}

pool.sort((a,b) => probability(b) - probability(a));

const slips = buildSlips(pool);

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  rules: {
    minProb: 0.68,
    slipSizes: SLIP_SIZES,
    slipsPerSize: SLIPS_PER_SIZE,
    goblinOnly: true,
    moreOnly: true,
    cleanBuilderV2: true,
    allowedMarkets: [...ALLOWED_MARKETS],
    blockedPlayers: [...BLOCKED_PLAYERS],
    requireAtLeastTwoTeams: true,
    maxProjectionsPerPlayer: MAX_PROJECTIONS_PER_PLAYER,
    trackOnly: true
  },
  rawRows: rows.length,
  pool: pool.length,
  slips: slips.length,
  bySize: Object.fromEntries(SLIP_SIZES.map(s => [s, slips.filter(x => x.size === s).length])),
  rejected
};

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, slips }, null, 2));

const lines = [];
lines.push("GOBLIN HIGH-PROBABILITY CLEAN SLIP MAKER");
lines.push("=========================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("NOTE: TRACK ONLY. Clean goblin highprob construction: pitcher-damage goblins only.");
for (const slip of slips) {
  lines.push("");
  lines.push(`${slip.id} | ${slip.size}-man goblin high-prob clean | ${slip.status} | avgProb=${(slip.avgProb*100).toFixed(1)}% | minProb=${(slip.minProb*100).toFixed(1)}%`);
  lines.push(`Teams: ${Object.entries(slip.teams).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  lines.push(`Markets: ${Object.entries(slip.markets).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  slip.legs.forEach((l, i) => {
    lines.push(`${i+1}. ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | prob=${(l.probability*100).toFixed(1)}%`);
  });
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
