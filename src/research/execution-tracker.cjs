const fs = require("fs");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slateQuality(poolSize, playableCount) {
  if (playableCount > 0 && poolSize >= 20) return "high";
  if (playableCount > 0 && poolSize >= 12) return "medium";
  if (poolSize >= 20) return "watch";
  return "low";
}

function summarizeSource(source, slips, played = false) {
  return slips.map(s => ({
    source,
    generated: true,
    played,
    name: s.name,
    size: s.size,
    mode: s.entryMode || s.mode || null,
    complete: s.complete ?? true,
    trueEV: s.trueEV ?? null,
    trueEVPct: s.trueEVPct ?? null,
    payoutConfigKey: s.payoutConfigKey ?? null,
    payout: s.payout ?? null,
    payoutMap: s.payoutMap ?? null,
    legs: (s.legs || []).map(l => ({
      player: l.player,
      team: l.team,
      market: l.market,
      side: l.side,
      line: l.line,
      oddsTier: l.oddsTier || l.specialTier || "standard",
      prob: l.prob ?? l.calibratedDistributionProb ?? null,
      edge: l.edge ?? l.adjustedEdge ?? null
    }))
  }));
}

function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);

  const playable = readJson("outputs/playable-final-slips.json", []);
  const watchlist = readJson("outputs/watchlist-final-slips.json", []);
  const mixed = readJson("outputs/mixed-slip-ev-optimizer.json", {
    poolSize: 0,
    safeSlips: [],
    aggressiveWatchlist: []
  });
  const fantasy = readJson("outputs/fantasy-watchlist.json", []);

  const coreOfficial = summarizeSource("core_official", playable, false);
  const shadow = summarizeSource("shadow", watchlist, false);
  const mixedEv = summarizeSource("mixed_ev", mixed.safeSlips || [], false);
  const mixedAggressive = summarizeSource("mixed_ev_research", mixed.aggressiveWatchlist || [], false);
  const fantasyTrackOnly = Array.isArray(fantasy)
    ? summarizeSource("fantasy_track_only", fantasy, false)
    : [];

  const poolSize = Number(mixed.poolSize || 0);
  const playableCount = playable.length;

  const output = {
    date,
    generatedAt: new Date().toISOString(),
    slate: {
      poolSize,
      playableCount,
      slateQuality: slateQuality(poolSize, playableCount)
    },
    sources: {
      core_official: {
        generated: coreOfficial.length,
        played: coreOfficial.filter(x => x.played).length
      },
      mixed_ev: {
        generated: mixedEv.length,
        played: mixedEv.filter(x => x.played).length
      },
      shadow: {
        generated: shadow.length,
        played: 0
      },
      fantasy_track_only: {
        generated: fantasyTrackOnly.length,
        played: 0
      }
    },
    slips: [
      ...coreOfficial,
      ...mixedEv,
      ...mixedAggressive,
      ...shadow,
      ...fantasyTrackOnly
    ]
  };

  ensureDir("outputs/execution");
  fs.writeFileSync(
    `outputs/execution/execution-summary-${date}.json`,
    JSON.stringify(output, null, 2) + "\n"
  );
  fs.writeFileSync(
    "outputs/execution/latest-execution-summary.json",
    JSON.stringify(output, null, 2) + "\n"
  );

  console.log("EXECUTION TRACKER");
  console.log("=================");
  console.log(`Date: ${date}`);
  console.log(`Pool size: ${poolSize}`);
  console.log(`Playable count: ${playableCount}`);
  console.log(`Slate quality: ${output.slate.slateQuality}`);
  console.table(output.sources);
  console.log(`Wrote outputs/execution/execution-summary-${date}.json`);
}

main();
