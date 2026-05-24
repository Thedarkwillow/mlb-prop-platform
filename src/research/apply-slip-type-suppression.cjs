const fs = require("fs");
const path = require("path");

const PLAYABLE = "outputs/playable-final-slips.json";
const WATCHLIST = "outputs/watchlist-final-slips.json";
const REPORT = "outputs/slip-type-suppression-report.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.slips)) return x.slips;
  if (Array.isArray(x?.entries)) return x.entries;
  if (Array.isArray(x?.data)) return x.data;
  return [];
}

function legsOf(slip) {
  return (
    slip.legs ||
    slip.picks ||
    slip.props ||
    slip.entries ||
    slip.slip ||
    []
  ).filter(Boolean);
}

function sizeOf(slip) {
  const legs = legsOf(slip);
  const n = Number(
    slip.size ||
    slip.slipSize ||
    slip.legCount ||
    slip.numLegs ||
    legs.length ||
    0
  );
  return Number.isFinite(n) ? n : 0;
}

function modeOf(slip) {
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

  if (text.includes("mixed")) return "mixed";
  if (text.includes("flex")) return "flex";
  if (text.includes("power")) return "power";
  if (text.includes("standard")) return "standard";
  return "unknown";
}

function isComplete(slip) {
  const text = String(slip.status || slip.complete || "").toLowerCase();
  if (text === "complete" || text === "true") return true;
  if (text === "incomplete" || text === "false") return false;

  const size = sizeOf(slip);
  return size > 0 && legsOf(slip).length >= size;
}

function classify(slip) {
  const size = sizeOf(slip);
  const mode = modeOf(slip);
  const complete = isComplete(slip);

  const reasons = [];

  if (!complete) {
    return {
      action: "WATCHLIST",
      tier: "INCOMPLETE",
      reasons: ["incomplete_slip"]
    };
  }

  if (mode === "mixed") reasons.push("mixed_mode_negative_ledger");
  if (size >= 6) reasons.push("six_man_negative_ledger");
  if (mode === "flex" && size >= 4) reasons.push("four_to_six_flex_track_only");
  if (size >= 4) reasons.push("four_plus_track_only");

  if (reasons.length) {
    return {
      action: "SUPPRESS",
      tier: "TRACK_ONLY",
      reasons
    };
  }

  if (size === 3) {
    return {
      action: "WATCHLIST",
      tier: "SECONDARY",
      reasons: ["three_man_secondary_until_validated"]
    };
  }

  if (size === 2 && mode !== "flex" && mode !== "mixed") {
    return {
      action: "ALLOW",
      tier: "PRIMARY",
      reasons: ["two_man_primary_positive_ledger"]
    };
  }

  return {
    action: "WATCHLIST",
    tier: "UNPROVEN",
    reasons: ["unproven_slip_type"]
  };
}

const playableRaw = asArray(read(PLAYABLE, []));
const watchlistRaw = asArray(read(WATCHLIST, []));

const keptPlayable = [];
const newWatchlist = [...watchlistRaw];
const suppressed = [];

for (const slip of playableRaw) {
  const c = classify(slip);
  const annotated = {
    ...slip,
    slipTypeSuppression: {
      action: c.action,
      tier: c.tier,
      reasons: c.reasons,
      size: sizeOf(slip),
      mode: modeOf(slip),
      complete: isComplete(slip)
    }
  };

  if (c.action === "ALLOW") {
    keptPlayable.push(annotated);
  } else if (c.action === "WATCHLIST") {
    newWatchlist.push(annotated);
  } else {
    suppressed.push(annotated);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  inputPlayable: playableRaw.length,
  outputPlayable: keptPlayable.length,
  movedToWatchlist: newWatchlist.length - watchlistRaw.length,
  suppressed: suppressed.length,
  rules: [
    "2-man power/standard = primary playable",
    "3-man = secondary watchlist",
    "4+ = track only",
    "4-6 flex = track only",
    "6-man = suppressed",
    "mixed = suppressed"
  ],
  keptPlayable: keptPlayable.map(s => ({
    name: s.name || s.title || null,
    size: sizeOf(s),
    mode: modeOf(s),
    reasons: s.slipTypeSuppression?.reasons || []
  })),
  suppressed: suppressed.map(s => ({
    name: s.name || s.title || null,
    size: sizeOf(s),
    mode: modeOf(s),
    reasons: s.slipTypeSuppression?.reasons || []
  }))
};

write(PLAYABLE, keptPlayable);
write(WATCHLIST, newWatchlist);
write(REPORT, report);

console.log("SLIP TYPE SUPPRESSION");
console.log("---------------------");
console.log("input playable:", playableRaw.length);
console.log("output playable:", keptPlayable.length);
console.log("moved to watchlist:", report.movedToWatchlist);
console.log("suppressed:", suppressed.length);
console.table(report.suppressed);
console.log("saved:", PLAYABLE);
console.log("saved:", WATCHLIST);
console.log("saved:", REPORT);
