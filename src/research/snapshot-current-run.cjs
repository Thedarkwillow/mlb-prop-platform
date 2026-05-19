const fs = require("fs");
const path = require("path");

const now = new Date();
const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
}).format(now).replaceAll(":", "");

const runId = `${DATE}-${stamp}`;

const outDir = path.join("outputs", "history", "runs", DATE, runId);
fs.mkdirSync(outDir, { recursive: true });

function copyIfExists(src, destName) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, path.join(outDir, destName));
  return true;
}

const copied = {
  pricedBoard: copyIfExists("outputs/priced-board.json", "priced-board.json"),
  finalSlips: copyIfExists("outputs/final-slips.json", "final-slips.json"),
  playableSlips: copyIfExists("outputs/playable-final-slips.json", "playable-final-slips.json"),
  blockedCandidates: copyIfExists("outputs/blocked-final-candidates.json", "blocked-final-candidates.json"),
  slipTypeOptimization: copyIfExists("outputs/slip-type-optimization.json", "slip-type-optimization.json"),
  fantasyWatchlist: copyIfExists("outputs/fantasy-watchlist.json", "fantasy-watchlist.json")
};

const manifest = {
  runId,
  date: DATE,
  timestampUtc: now.toISOString(),
  timestampPacific: `${DATE} ${stamp}`,
  copied,
  immutable: true,
  note: "Snapshot of board/slips at build time. Do not overwrite."
};

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Latest pointer for easy lookup.
fs.mkdirSync(path.join("outputs", "history", "runs", DATE), { recursive: true });
fs.writeFileSync(
  path.join("outputs", "history", "runs", DATE, "latest-run.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

console.log("SNAPSHOT CURRENT RUN");
console.log(JSON.stringify(manifest, null, 2));
console.log("Wrote", outDir);
