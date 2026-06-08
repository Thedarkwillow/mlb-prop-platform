const fs = require("fs");

const files = [
  "outputs/pickfinder-mlb-full-capture.json",
  "outputs/pickfinder-mlb-props.json",
  "outputs/pickfinder-mlb-popular.json",
  "outputs/pickfinder-mlb-discrepancies.json",
  "outputs/pickfinder-mlb-odds.json",
  "outputs/pickfinder-mlb-player-details.json",
  "data/context/pickfinder-lineups.json",
  "data/context/pickfinder-player-signals.json",
  "outputs/pickfinder-board-signal-audit.json",
  "outputs/pickfinder-board-signal-audit.txt"
];

function stat(file) {
  try {
    const s = fs.statSync(file);
    return {
      file,
      exists: true,
      size: s.size,
      mtime: s.mtime.toISOString()
    };
  } catch {
    return { file, exists: false };
  }
}

console.log("PICKFINDER REFRESH STATUS");
console.log("=========================");
for (const f of files) {
  const x = stat(f);
  console.log(`${x.exists ? "OK" : "MISS"} ${x.file} ${x.exists ? `${x.size} bytes ${x.mtime}` : ""}`);
}

console.log("");
console.log("Latest cron log tail:");
try {
  const log = fs.readFileSync("logs/pickfinder-refresh-cron.log", "utf8").trim().split(/\n/).slice(-40).join("\n");
  console.log(log || "(empty)");
} catch {
  console.log("(no log yet)");
}
