const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const gradedPath =
  process.env.npm_config_file ||
  process.argv[3] ||
  `outputs/playable-final-slips-graded-${DATE}.json`;

const outPath = "data/results/slip-type-performance.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(path) {
  fs.mkdirSync(path, { recursive: true });
}

function normalizeResult(leg) {
  return String(
    leg.result ||
    leg.gradeResult ||
    leg.outcome ||
    leg.status ||
    ""
  ).toUpperCase();
}

function baseEntryType(slip) {
  return String(slip.entryType || slip.type || slip.name || "").toUpperCase().includes("FLEX")
    ? "FLEX"
    : "POWER";
}

function resolveEffectiveSlip(slip) {
  const legs = slip.legs || [];
  const originalEntryType = baseEntryType(slip);
  const originalSize = legs.length || Number(slip.size || 0);

  let active = 0;
  let hits = 0;
  let misses = 0;
  let pushes = 0;
  let dnp = 0;
  let ties = 0;
  const activeTeams = new Set();

  for (const leg of legs) {
    const r = normalizeResult(leg);

    if (r === "DNP" || r === "REBOOT") {
      dnp += 1;
      continue;
    }

    active += 1;
    if (leg.team) activeTeams.add(leg.team);

    if (r === "HIT" || r === "WIN" || r === "WON") hits += 1;
    else if (r === "PUSH" || r === "TIE") {
      pushes += 1;
      ties += 1;
    } else misses += 1;
  }

  // PrizePicks ties revert payout by one level but are not removed for same-team/2-pick eligibility.
  const payoutSize = Math.max(0, active - ties);

  // 3-flex with one DNP/reboot reverts to 2-pick power.
  let effectiveEntryType = originalEntryType;
  if (originalEntryType === "FLEX" && payoutSize === 2) {
    effectiveEntryType = "POWER";
  }

  const sameTeamRefund =
    active >= 2 &&
    activeTeams.size === 1 &&
    dnp > 0;

  return {
    originalEntryType,
    entryType: effectiveEntryType,
    originalSize,
    size: payoutSize,
    active,
    hits,
    misses,
    pushes,
    dnp,
    ties,
    sameTeamRefund,
    legs
  };
}

function resultOfSlip(slip) {
  return resolveEffectiveSlip(slip);
}

function payoutReturn(entryType, size, hits, slipResult = {}) {
  const payouts = read("data/config/prizepicks-slip-payouts.json", {});

  if (slipResult.sameTeamRefund) return 1;
  if (size <= 1) return slipResult.dnp > 0 ? 1 : 0;

  if (entryType === "POWER") {
    if (size === 2) {
      if (hits === 2) return Number(payouts.power?.["2"] || 3);
      if (hits === 1 && slipResult.ties > 0) return 1.5;
      return 0;
    }
    return hits === size ? Number(payouts.power?.[String(size)] || 0) : 0;
  }

  const table = payouts.flex?.[String(size)] || {};
  return Number(table[String(hits)] || 0);
}

function emptyBucket() {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    stake: 0,
    returns: 0,
    profit: 0,
    roi: 0,
    avgReturn: 0
  };
}

function addToBucket(bucket, slipResult) {
  const { entryType, size, hits, pushes } = slipResult;
  const ret = payoutReturn(entryType, size, hits, slipResult);
  const profit = ret - 1;

  bucket.count += 1;
  bucket.stake += 1;
  bucket.returns += ret;
  bucket.profit += profit;

  if (profit > 0) bucket.wins += 1;
  else if (profit < 0) bucket.losses += 1;
  else bucket.pushes += 1;

  bucket.roi = Number((bucket.profit / Math.max(1, bucket.stake)).toFixed(4));
  bucket.avgReturn = Number((bucket.returns / Math.max(1, bucket.count)).toFixed(4));
}

const graded = read(gradedPath, []);
const slips = Array.isArray(graded) ? graded : (graded.slips || graded.finalSlips || []);

const day = {
  date: DATE,
  gradedPath,
  generatedAt: new Date().toISOString(),
  overall: emptyBucket(),
  byType: {
    POWER: emptyBucket(),
    FLEX: emptyBucket()
  },
  slips: []
};

for (const slip of slips) {
  const r = resultOfSlip(slip);
  if (!r.size || !r.legs.length) continue;

  const ret = payoutReturn(r.entryType, r.size, r.hits);
  const profit = ret - 1;

  const row = {
    name: slip.name,
    entryType: r.entryType,
    size: r.size,
    originalSize: r.originalSize,
    hits: r.hits,
    misses: r.misses,
    pushes: r.pushes,
    dnp: r.dnp,
    ties: r.ties,
    active: r.active,
    originalEntryType: r.originalEntryType,
    sameTeamRefund: r.sameTeamRefund,
    returnMultiplier: ret,
    profit,
    roi: profit,
    powerEv: slip.slipTypeOptimization?.powerEv ?? null,
    flexEv: slip.slipTypeOptimization?.flexEv ?? null,
    bestEv: slip.slipTypeOptimization?.bestEv ?? null,
    qualityTier: slip.quality?.tier ?? slip.slipTypeOptimization?.qualityTier ?? null
  };

  day.slips.push(row);
  addToBucket(day.overall, r);
  if (!day.byType[r.entryType]) day.byType[r.entryType] = emptyBucket();
  addToBucket(day.byType[r.entryType], r);
}

const history = read(outPath, { days: [], summary: { overall: emptyBucket(), byType: { POWER: emptyBucket(), FLEX: emptyBucket() } } });
history.days = (history.days || []).filter(d => d.date !== DATE);
history.days.push(day);
history.days.sort((a, b) => String(a.date).localeCompare(String(b.date)));

const summary = {
  overall: emptyBucket(),
  byType: {
    POWER: emptyBucket(),
    FLEX: emptyBucket()
  }
};

for (const d of history.days) {
  for (const slip of d.slips || []) {
    const r = {
      entryType: slip.entryType,
      size: slip.size,
      hits: slip.hits,
      pushes: slip.pushes,
      legs: Array.from({ length: slip.size })
    };
    addToBucket(summary.overall, r);
    addToBucket(summary.byType[slip.entryType], r);
  }
}

history.summary = summary;
history.updatedAt = new Date().toISOString();

ensureDir("data/results");
fs.writeFileSync(outPath, JSON.stringify(history, null, 2) + "\n");
fs.writeFileSync(`outputs/slip-type-performance-${DATE}.json`, JSON.stringify(day, null, 2) + "\n");

console.log("SLIP TYPE PERFORMANCE", DATE);
console.table([
  { bucket: "OVERALL", ...day.overall },
  { bucket: "POWER", ...day.byType.POWER },
  { bucket: "FLEX", ...day.byType.FLEX }
]);
console.log("Wrote", outPath);
console.log(`Wrote outputs/slip-type-performance-${DATE}.json`);
