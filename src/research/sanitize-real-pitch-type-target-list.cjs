const fs = require("fs");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const files = [
  "outputs/context/real-pitch-type-target-list-latest.json",
  `outputs/context/real-pitch-type-target-list-${date}.json`
];

const knownBadHitterStrikeoutNames = new Set([
  "Riley Greene",
  "Spencer Torkelson",
  "Kyle Stowers",
  "Jac Caglianone",
  "Isaac Collins",
  "Colson Montgomery",
  "Garrett Mitchell",
  "Christian Yelich",
  "Rafael Devers",
  "Willy Adames",
  "Hunter Goodman",
  "Willi Castro",
  "Randy Arozarena",
  "Cedric Mullins",
  "Colt Keith",
  "Dillon Dingler",
  "Jonathan Aranda",
  "Kerry Carpenter",
  "Kevin McGonigle"
]);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function marketsOnlyStrikeouts(target) {
  const markets = target.markets || target.marketList || {};
  const keys = Array.isArray(markets)
    ? markets.map(x => String(x.key || x.market || x[0] || "").toLowerCase())
    : Object.keys(markets).map(x => String(x).toLowerCase());

  if (!keys.length) {
    const m = String(target.topMarket || target.market || "").toLowerCase();
    return m === "strikeouts" || m === "hitter_strikeouts";
  }

  return keys.every(k => k === "strikeouts" || k === "hitter_strikeouts");
}

function shouldMoveToHitterMatchup(target) {
  const name = target.pitcher || target.player || target.name;
  if (knownBadHitterStrikeoutNames.has(name) && marketsOnlyStrikeouts(target)) return true;

  const examples = Array.isArray(target.examples) ? target.examples : [];
  if (!examples.length) return false;

  return examples.every(row => {
    const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();
    const market = String(row.market || row.stat || row.stat_short || "").toLowerCase();

    if (sourceType === "pitcher") return false;
    if (!(market === "strikeouts" || market === "hitter_strikeouts")) return false;

    return true;
  });
}

let totalMoved = 0;

for (const file of files) {
  const report = readJson(file, null);
  if (!report) continue;

  const pitcherTargets = Array.isArray(report.pitcherArsenalTargets)
    ? report.pitcherArsenalTargets
    : [];

  const hitterTargets = Array.isArray(report.hitterMatchupTargets)
    ? report.hitterMatchupTargets
    : [];

  const keep = [];
  const moved = [];

  for (const target of pitcherTargets) {
    if (shouldMoveToHitterMatchup(target)) {
      moved.push({
        ...target,
        type: "hitter_matchup",
        reason: "MISSING_HITTER_OR_MATCHUP",
        movedFrom: "pitcher_arsenal",
        movedReason: "hitter_strikeout_row_misclassified_as_pitcher_arsenal"
      });
    } else {
      keep.push(target);
    }
  }

  report.pitcherArsenalTargets = keep;
  report.hitterMatchupTargets = [...hitterTargets, ...moved];

  if (report.summary) {
    report.summary.pitcherArsenalTargets = keep.length;
    report.summary.hitterMatchupTargets = report.hitterMatchupTargets.length;
  }

  report.sanitizedAt = new Date().toISOString();
  report.sanitizer = "sanitize-real-pitch-type-target-list.cjs";
  report.sanitizerMovedRows = moved.length;

  writeJson(file, report);
  totalMoved += moved.length;

  console.log({
    file,
    moved: moved.length,
    pitcherArsenalTargets: keep.length,
    hitterMatchupTargets: report.hitterMatchupTargets.length
  });
}

console.log("SANITIZE REAL PITCH TYPE TARGET LIST");
console.log("------------------------------------");
console.log({ totalMoved });
