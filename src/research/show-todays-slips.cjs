const fs = require("fs");

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.rows)) return v.rows;
  if (Array.isArray(v.candidates)) return v.candidates;
  if (Array.isArray(v.unlocked)) return v.unlocked;
  if (Array.isArray(v.slips)) return v.slips;
  if (Array.isArray(v.legs)) return v.legs;
  return [];
}

function flattenLegs(v, out = []) {
  if (!v) return out;

  if (Array.isArray(v)) {
    for (const x of v) flattenLegs(x, out);
    return out;
  }

  if (typeof v !== "object") return out;

  const looksLikeLeg =
    v.player ||
    v.playerName ||
    v.market ||
    v.side ||
    v.line !== undefined;

  if (looksLikeLeg && !Array.isArray(v.legs)) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flattenLegs(val, out);
  }

  return out;
}

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "n/a";
  const n = Number(v);
  if (n <= 1) return `${(n * 100).toFixed(1)}%`;
  return `${n.toFixed(1)}%`;
}

function fmtNum(v, digits = 4) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "n/a";
  return Number(v).toFixed(digits);
}

function legRow(r) {
  return {
    player: r.player || r.playerName || "UNKNOWN",
    market: r.market || "n/a",
    side: r.side || "n/a",
    line: r.line ?? "n/a",
    tier: r.tier || r.oddsTier || "standard",
    prob: fmtPct(r.prob ?? r.probability ?? r.hitProb ?? r.calibratedDistributionProb),
    edge: fmtNum(r.edge ?? r.ev ?? r.modelEdge, 4),
    class: r.candidateClass || r.layer || r.role || r.status || "n/a",
    reason:
      r.reason ||
      r.reasonBlocked ||
      r.disabledReason ||
      r.blockedReason ||
      (Array.isArray(r.reasons) ? r.reasons.join(",") : "n/a")
  };
}

function slipReason(slip) {
  const green = Number(slip.green || 0);
  const neutral = Number(slip.neutral || 0);
  const watchlist = Number(slip.watchlist || 0);
  const fade = Number(slip.fade || 0);
  const size = Number(slip.size || 0);

  if (!slip.complete) return "incomplete slip";
  if (fade > 0) return "has FADE leg";
  if (watchlist > 0) return "has WATCHLIST leg";
  if (size === 2 && green < 2) return "needs 2 GREEN legs";
  if (size === 3 && green < 2) return "needs more GREEN legs";
  if (size === 4 && green < 2) return "needs more GREEN legs";
  if (size === 5 && green < 3) return "needs more GREEN legs";
  if (size === 6 && green < 4) return "needs more GREEN legs";
  if (neutral >= green) return "too many NEUTRAL legs";

  return "playable";
}

function printLegTable(title, rows, max = 25) {
  console.log(title);
  console.log("-".repeat(title.length));

  if (!rows.length) {
    console.log("None.");
    return;
  }

  console.table(rows.slice(0, max).map(legRow));
  if (rows.length > max) console.log(`... ${rows.length - max} more`);
}

function printSlipTable(title, slips) {
  console.log(title);
  console.log("-".repeat(title.length));

  if (!slips.length) {
    console.log("None.");
    return;
  }

  for (const slip of slips) {
    const legs = Array.isArray(slip.legs) ? slip.legs : [];
    const status = slip.status || (slip.complete ? "COMPLETE" : "INCOMPLETE");
    const name = slip.name || slip.type || slip.slipType || "SLIP";
    const reason = slip.reason || slip.disabledReason || slip.blockedReason || slipReason(slip);
    const green = slip.green ?? slip.greenCount ?? 0;
    const neutral = slip.neutral ?? slip.neutralCount ?? 0;
    const corr = slip.correlation ?? slip.correlationStatus ?? "OK";

    console.log(`${name} | status=${status} | reason=${reason} | green=${green} neutral=${neutral} correlation=${corr}`);

    if (legs.length) console.table(legs.map(legRow));
    else console.log("(no legs)");
  }
}

const playableSlips = asArray(readJson("outputs/playable-final-slips.json", []));
const watchlistSlips = asArray(readJson("outputs/watchlist-final-slips.json", []));
const finalSlips = asArray(readJson("outputs/final-slips.json", []));

const leanRows = flattenLegs(readJson("outputs/lean-final-slips.json", []))
  .filter(r => r.player || r.playerName || r.market);

const blockedRows = asArray(readJson("outputs/blocked-final-candidates.json", []));
const controlledUnlockRows = asArray(readJson("outputs/controlled-line-unlocks-latest.json", []));
const lineAuditRows = asArray(readJson("outputs/line-specific-block-audit-latest.json", []));

console.log("PLAYABLE SLIPS");
console.log("==============");
printSlipTable("Playable", playableSlips);

console.log("");
printLegTable("ACTIONABLE LEAN / LEAN LEGS", leanRows);

console.log("");
printLegTable("CONTROLLED UNLOCK WATCH", controlledUnlockRows);

console.log("");
printLegTable("BLOCKED CANDIDATES", blockedRows);

console.log("");
printLegTable("LINE-SPECIFIC AUDIT", lineAuditRows);

console.log("");
console.log("WATCHLIST / BLOCKED SLIPS");
console.log("=========================");
printSlipTable("Watchlist slips", watchlistSlips);

console.log("");
console.log("FINAL SLIP OBJECTS");
console.log("==================");
printSlipTable("Final slips", finalSlips);
