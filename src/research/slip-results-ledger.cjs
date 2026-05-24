const fs = require("fs");
const path = require("path");

const dateArg = process.argv[2] || process.env.npm_config_date || null;
const OUT = "data/results/slip-results-ledger.json";
const LATEST = "outputs/slip-results-ledger-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function filesForDate(date) {
  const files = [];
  const candidates = [
    `outputs/playable-final-slips-graded-${date}.json`,
    `outputs/final-slips-graded-${date}.json`,
    `outputs/official-slip-graded-${date}.json`
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) files.push(f);
  }
  return files;
}

function allGradedSlipFiles() {
  const dirs = ["outputs", "outputs/history"];
  const files = [];

  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (/slip.*graded.*\.json$/i.test(name) || /graded.*slip.*\.json$/i.test(name)) {
        files.push(path.join(d, name));
      }
    }
  }

  return [...new Set(files)].sort();
}

function dateFromFile(file) {
  const m = file.match(/(20\d{2}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.slips)) return x.slips;
  if (Array.isArray(x?.entries)) return x.entries;
  if (Array.isArray(x?.data)) return x.data;
  if (Array.isArray(x?.gradedSlips)) return x.gradedSlips;
  if (x && typeof x === "object") {
    const vals = Object.values(x).filter(v => v && typeof v === "object");
    if (vals.some(v => Array.isArray(v))) {
      return vals.flatMap(v => Array.isArray(v) ? v : []);
    }
  }
  return [];
}

function legsOf(slip) {
  return (
    slip.legs ||
    slip.picks ||
    slip.props ||
    slip.entries ||
    slip.slip ||
    slip.rows ||
    []
  ).filter(Boolean);
}

function resultOfLeg(leg) {
  const r = String(
    leg.result ||
    leg.gradeResult ||
    leg.outcome ||
    leg.status ||
    leg.grade ||
    ""
  ).toUpperCase();

  if (["HIT", "WIN", "WON", "CORRECT"].includes(r)) return "HIT";
  if (["MISS", "LOSS", "LOST", "INCORRECT"].includes(r)) return "MISS";
  if (["PUSH", "VOID", "REFUND", "REFUNDED"].includes(r)) return "PUSH";

  return "UNKNOWN";
}

function gradeLegs(legs) {
  let hits = 0;
  let misses = 0;
  let pushes = 0;
  let unknown = 0;

  for (const leg of legs) {
    const r = resultOfLeg(leg);
    if (r === "HIT") hits++;
    else if (r === "MISS") misses++;
    else if (r === "PUSH") pushes++;
    else unknown++;
  }

  return { hits, misses, pushes, unknown };
}

function sizeOf(slip, legs) {
  return Number(
    slip.size ||
    slip.slipSize ||
    slip.legCount ||
    slip.numLegs ||
    legs.length ||
    0
  );
}

function powerPayoutFor(size) {
  // Default standard Power total-return multipliers.
  // If a graded slip file contains an explicit payout, that value overrides this.
  if (size === 2) return 3;
  if (size === 3) return 6;
  if (size === 4) return 10;
  if (size === 5) return 20;
  if (size === 6) return 37.5;
  return null;
}

function flexPayoutFor(size, hits) {
  // Default standard Flex total-return multipliers.
  // These are intentionally centralized so we can adjust if PrizePicks changes payouts.
  const table = {
    3: { 3: 2.25, 2: 1.25 },
    4: { 4: 5, 3: 1.5 },
    5: { 5: 10, 4: 2, 3: 0.4 },
    6: { 6: 25, 5: 2, 4: 0.4 }
  };
  return table[size]?.[hits] ?? null;
}

function payoutFor(size, mode, hits = null) {
  const m = String(mode || "").toLowerCase();

  if (m.includes("flex")) {
    return flexPayoutFor(size, hits);
  }

  return powerPayoutFor(size);
}

function slipMode(slip) {
  const text = [
    slip.mode,
    slip.type,
    slip.slipType,
    slip.entryType,
    slip.payoutType,
    slip.name,
    slip.title,
    slip.slipName
  ].map(x => String(x || "")).join(" ").toLowerCase();

  if (text.includes("flex")) return "flex";
  if (text.includes("power")) return "power";
  if (text.includes("mixed")) return "mixed";
  if (text.includes("standard")) return "standard";

  return "";
}

function slipStatus({ hits, misses, pushes, unknown }, size, mode) {
  if (unknown > 0) return "PENDING_OR_UNKNOWN";

  const m = String(mode || "").toLowerCase();
  const activeSize = Math.max(0, size - pushes);

  if (m.includes("flex")) {
    const payout = flexPayoutFor(activeSize || size, hits);
    return Number.isFinite(Number(payout)) && Number(payout) > 0 ? "WIN" : "LOSS";
  }

  if (misses > 0) return "LOSS";
  if (hits + pushes >= size && hits > 0) return "WIN";

  return "PENDING_OR_UNKNOWN";
}

function profitFor(slip, status, size, mode, hits = null, pushes = 0) {
  if (Number.isFinite(Number(slip.profit))) return Number(slip.profit);
  if (Number.isFinite(Number(slip.profitUnits))) return Number(slip.profitUnits);
  if (Number.isFinite(Number(slip.roiUnits))) return Number(slip.roiUnits);

  const stake = Number(slip.stake || slip.unit || 1);
  if (status === "LOSS") return -stake;
  if (status !== "WIN") return 0;

  const explicitPayout = Number(
    slip.payout ||
    slip.payoutMultiplier ||
    slip.multiplier ||
    slip.truePayout ||
    slip.projectedPayout
  );

  const activeSize = Math.max(0, size - Number(pushes || 0));

  const payout = Number.isFinite(explicitPayout) && explicitPayout > 0
    ? explicitPayout
    : payoutFor(activeSize || size, mode, hits);

  if (!Number.isFinite(payout)) return 0;

  // Profit, not total return.
  return Number(((payout - 1) * stake).toFixed(4));
}

function normalizeLeg(leg) {
  return {
    player: leg.player || leg.name || leg.playerName || null,
    team: leg.team || null,
    market: leg.market || leg.stat || leg.statType || null,
    side: leg.side || leg.direction || leg.recommendedSide || null,
    line: leg.line ?? leg.ppLine ?? leg.projectionLine ?? null,
    tier: leg.oddsTier || leg.tier || leg.specialTier || null,
    result: resultOfLeg(leg),
    actual: leg.actual ?? leg.actualValue ?? null
  };
}

function normalizeSlip(raw, file, date, index) {
  const legs = legsOf(raw);
  const size = sizeOf(raw, legs);
  const mode = slipMode(raw);
  const g = gradeLegs(legs);
  const status = String(raw.status || raw.result || raw.outcome || "").toUpperCase();

  const finalStatus = ["WIN", "LOSS", "PUSH", "PENDING"].includes(status)
    ? status
    : slipStatus(g, size, mode);

  const profit = profitFor(raw, finalStatus, size, mode, g.hits, g.pushes);

  return {
    date,
    sourceFile: file,
    slipId: raw.id || raw.slipId || raw.name || `${date}-${path.basename(file)}-${index + 1}`,
    name: raw.name || raw.title || raw.slipName || `${path.basename(file)} #${index + 1}`,
    size,
    mode: mode || null,
    status: finalStatus,
    hits: g.hits,
    misses: g.misses,
    pushes: g.pushes,
    unknown: g.unknown,
    gradedLegs: g.hits + g.misses + g.pushes,
    totalLegs: legs.length,
    stake: Number(raw.stake || raw.unit || 1),
    payout: raw.payout || raw.payoutMultiplier || raw.multiplier || payoutFor(Math.max(0, size - g.pushes) || size, mode, g.hits),
    profitUnits: profit,
    roiUnits: Number((profit / Number(raw.stake || raw.unit || 1)).toFixed(4)),
    legs: legs.map(normalizeLeg)
  };
}

function summarize(rows) {
  const graded = rows.filter(r => r.status === "WIN" || r.status === "LOSS");
  const wins = graded.filter(r => r.status === "WIN").length;
  const losses = graded.filter(r => r.status === "LOSS").length;
  const profit = graded.reduce((a, r) => a + Number(r.profitUnits || 0), 0);

  const bySize = {};
  const byMode = {};

  for (const r of graded) {
    const sk = String(r.size || "unknown");
    const mk = String(r.mode || "unknown");

    bySize[sk] ||= { slips: 0, wins: 0, losses: 0, profitUnits: 0 };
    byMode[mk] ||= { slips: 0, wins: 0, losses: 0, profitUnits: 0 };

    for (const bucket of [bySize[sk], byMode[mk]]) {
      bucket.slips++;
      if (r.status === "WIN") bucket.wins++;
      if (r.status === "LOSS") bucket.losses++;
      bucket.profitUnits += Number(r.profitUnits || 0);
    }
  }

  function finalize(obj) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [
      k,
      {
        ...v,
        profitUnits: Number(v.profitUnits.toFixed(4)),
        roiUnits: v.slips ? Number((v.profitUnits / v.slips).toFixed(4)) : null,
        winRate: v.slips ? Number((v.wins / v.slips).toFixed(4)) : null
      }
    ]));
  }

  return {
    slips: rows.length,
    graded: graded.length,
    wins,
    losses,
    pendingOrUnknown: rows.length - graded.length,
    profitUnits: Number(profit.toFixed(4)),
    roiUnits: graded.length ? Number((profit / graded.length).toFixed(4)) : null,
    winRate: graded.length ? Number((wins / graded.length).toFixed(4)) : null,
    bySize: finalize(bySize),
    byMode: finalize(byMode)
  };
}

const files = dateArg ? filesForDate(dateArg) : allGradedSlipFiles();

const ledgerRows = [];
for (const file of files) {
  const date = dateArg || dateFromFile(file);
  if (!date) continue;

  const raw = read(file, null);
  const slips = asArray(raw);

  slips.forEach((slip, i) => {
    const legs = legsOf(slip);
    if (!legs.length && !slip.size && !slip.name) return;
    ledgerRows.push(normalizeSlip(slip, file, date, i));
  });
}

const existing = read(OUT, []);
const keep = dateArg
  ? existing.filter(r => r.date !== dateArg)
  : [];

const merged = [...keep, ...ledgerRows]
  .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name)));

const output = {
  generatedAt: new Date().toISOString(),
  date: dateArg || "ALL",
  summary: summarize(merged),
  rows: merged
};

write(OUT, merged);
write(LATEST, output);

console.log("SLIP RESULTS LEDGER");
console.log("-------------------");
console.log("date:", dateArg || "ALL");
console.log("files:", files.length);
console.log("rows added:", ledgerRows.length);
console.log("ledger rows:", merged.length);
console.table([summarize(merged)]);
console.log("saved:", OUT);
console.log("saved:", LATEST);
