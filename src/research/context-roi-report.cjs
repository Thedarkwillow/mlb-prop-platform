const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function push(map, key, row) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, {
      signal: key,
      total: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      hitRate: null,
      roi: null,
      avgProb: null,
      avgEV: null
    });
  }

  const x = map.get(key);
  x.total++;

  const result = String(row.result || row.grade || row.outcome || "").toUpperCase();
  if (["WIN", "HIT", "W"].includes(result)) x.wins++;
  else if (["LOSS", "MISS", "L"].includes(result)) x.losses++;
  else x.pushes++;

  const prob = Number(row.recommendedProb ?? row.probability ?? row.prob);
  const ev = Number(row.expectedValue ?? row.ev);

  if (!x._probs) x._probs = [];
  if (!x._evs) x._evs = [];

  if (Number.isFinite(prob)) x._probs.push(prob);
  if (Number.isFinite(ev)) x._evs.push(ev);
}

function finish(x) {
  const decided = x.wins + x.losses;
  x.hitRate = decided ? +(x.wins / decided).toFixed(4) : null;

  // PrizePicks-style flat unit proxy: win +1, loss -1.
  // Exact slip payout ROI belongs in slip-level reports.
  x.roi = decided ? +((x.wins - x.losses) / decided).toFixed(4) : null;

  x.avgProb = x._probs?.length
    ? +(x._probs.reduce((a, b) => a + b, 0) / x._probs.length).toFixed(4)
    : null;

  x.avgEV = x._evs?.length
    ? +(x._evs.reduce((a, b) => a + b, 0) / x._evs.length).toFixed(4)
    : null;

  delete x._probs;
  delete x._evs;
  return x;
}

const files = [
  "outputs/all-markets-graded.json",
  "outputs/playable-final-slips-graded.json",
  "outputs/playable-final-slips-graded-2026-05-22.json",
  "data/results/prop-warehouse.json"
];

let rows = [];

for (const f of files) {
  const data = readJson(f, null);
  if (!data) continue;

  if (Array.isArray(data)) rows.push(...data);
  else if (Array.isArray(data.rows)) rows.push(...data.rows);
  else if (Array.isArray(data.props)) rows.push(...data.props);
  else if (Array.isArray(data.legs)) rows.push(...data.legs);
  else if (Array.isArray(data.slips)) {
    for (const s of data.slips) rows.push(...(s.legs || []));
  }
}

rows = rows.filter(r => r && (r.player || r.playerName));

const signals = new Map();

for (const r of rows) {
  push(signals, `market:${r.market}`, r);
  push(signals, `side:${r.recommendedSide || r.side}`, r);
  push(signals, `market_side:${r.market}_${r.recommendedSide || r.side}`, r);

  push(signals, `confidence:${r.confidenceBucket || r.confidence}`, r);

  push(signals, `pitchType:${r.pitchTypeMatchupTier}`, r);
  push(signals, `catcher:${r.opponentCatcherFramingTier}`, r);
  push(signals, `ownBullpen:${r.ownBullpenFatigueTier}`, r);
  push(signals, `oppBullpen:${r.opponentBullpenFatigueTier}`, r);
  push(signals, `lineup:${r.lineupTier}`, r);

  push(signals, `savantForm:${r.savantRollingForm?.formTier}`, r);
  push(signals, `rollingForm:${r.rollingFormTrend}`, r);

  const flags = [
    ...(r.pitchTypeMatchupFlags || []),
    ...(r.contextAdjustment?.flags || []),
    ...(r.handednessAdjustment?.flags || []),
    ...(r.contactQualityAdjustment?.flags || []),
    ...(r.savantRollingForm?.flags || [])
  ];

  for (const flag of flags) push(signals, `flag:${flag}`, r);
}

const report = Array.from(signals.values())
  .map(finish)
  .filter(x => x.total >= 3)
  .sort((a, b) => {
    const ar = a.roi ?? -999;
    const br = b.roi ?? -999;
    return br - ar || b.total - a.total;
  });

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/context-roi-report.json", JSON.stringify(report, null, 2));

console.log("CONTEXT ROI REPORT");
console.log("==================");
console.log({ gradedRows: rows.length, signals: report.length });
console.table(report.slice(0, 30));
console.log("Wrote outputs/context-roi-report.json");
