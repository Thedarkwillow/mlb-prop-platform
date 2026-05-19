const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(x) {
  const n = Number(x);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function num(x, d = 3) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(d)) : null;
}

function latestRunId(date) {
  const dir = `outputs/history/runs/${date}`;
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir)
    .filter(x => /^\d{4}-\d{2}-\d{2}-/.test(x))
    .sort()
    .at(-1) || null;
}

function legTier(leg) {
  return String(leg.oddsTier || leg.tier || "standard").toLowerCase();
}

function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);

  const final = readJson("outputs/final-slips.json", { slips: [] });
  const playable = readJson("outputs/playable-final-slips.json", []);
  const watchlist = readJson("outputs/watchlist-final-slips.json", []);
  const blocked = readJson("outputs/blocked-final-candidates.json", []);
  const latestRun = latestRunId(date);

  console.log("\nMLB PROP COMMAND CENTER");
  console.log("=======================");
  console.log(`Date: ${date}`);
  console.log(`Latest run: ${latestRun || "none"}`);
  console.log(`Ranking: ${final.rankingMethod || "unknown"}`);

  console.log("\nPLAYABLE STATUS");
  console.log("---------------");
  if (!playable.length) {
    console.log("NO PLAYABLE SLIPS");
  } else {
    console.table(playable.map(s => ({
      slip: s.name,
      size: s.size,
      mode: s.entryMode,
      trueEVPct: pct(s.trueEVPct),
      payoutKey: s.payoutConfigKey || "—",
      payout: s.payout || "—",
      legs: (s.legs || []).length,
      green: s.green,
      neutral: s.neutral,
      correlation: s.correlation
    })));
  }

  console.log("\nFINAL SLIP BOARD");
  console.log("----------------");
  console.table((final.slips || []).map(s => ({
    slip: s.name,
    complete: s.complete,
    rejected: s.rejected,
    mode: s.entryMode,
    trueEVPct: pct(s.trueEVPct),
    payoutKey: s.payoutConfigKey || "—",
    payout: s.payout || "—",
    legs: (s.legs || []).length,
    reason: (s.rejectReasons || []).join(", ") || (s.complete ? "priced" : "incomplete")
  })));

  const allLegs = [];
  for (const s of final.slips || []) {
    for (const leg of s.legs || []) allLegs.push({ slip: s.name, ...leg });
  }

  console.log("\nTOP LEGS");
  console.log("--------");
  console.table(allLegs.slice(0, 12).map(l => ({
    player: l.player,
    team: l.team,
    market: l.market,
    side: l.side,
    line: l.line,
    tier: legTier(l),
    prob: num(l.calibratedDistributionProb ?? l.prob),
    edge: num(l.adjustedEdge ?? l.edge),
    grade: l.grade,
    books: l.books
  })));

  const tierCounts = {};
  const marketCounts = {};
  for (const l of allLegs) {
    tierCounts[legTier(l)] = (tierCounts[legTier(l)] || 0) + 1;
    marketCounts[l.market || "unknown"] = (marketCounts[l.market || "unknown"] || 0) + 1;
  }

  console.log("\nEXPOSURE SUMMARY");
  console.log("----------------");
  console.table({
    tiers: tierCounts,
    markets: marketCounts
  });

  console.log("\nWATCHLIST");
  console.log("---------");
  if (!watchlist.length) {
    console.log("No watchlist slips.");
  } else {
    console.table(watchlist.map(s => ({
      slip: s.name,
      status: s.complete ? "COMPLETE" : "INCOMPLETE",
      trueEVPct: pct(s.trueEVPct),
      legs: (s.legs || []).length,
      reason: s.complete ? ((s.rejectReasons || []).join(", ") || "not playable") : "incomplete"
    })));
  }

  console.log("\nBLOCKED CANDIDATES");
  console.log("------------------");
  const blockedCounts = {};
  for (const b of blocked || []) {
    const r = b.blockReason || b.reason || b.primaryReason || "unknown";
    blockedCounts[r] = (blockedCounts[r] || 0) + 1;
  }
  console.table(blockedCounts);

  console.log("\nACTION");
  console.log("------");
  if (!playable.length) {
    console.log("PASS — no positive trueEV playable slips.");
  } else {
    const best = playable[0];
    console.log(`Best slip: ${best.name} | trueEVPct=${pct(best.trueEVPct)} | payoutKey=${best.payoutConfigKey || "—"}`);
  }

  console.log("");
}

main();
