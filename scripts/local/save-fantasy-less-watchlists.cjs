const fs = require("fs");
const path = require("path");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);

const files = [
  ["outputs/watchlists/fantasy-less-top.json", `outputs/history/${DATE}-fantasy-less-top.json`],
  ["outputs/watchlists/fantasy-less-top.txt", `outputs/history/${DATE}-fantasy-less-top.txt`],
  ["outputs/watchlists/fantasy-less-watchlist.json", `outputs/history/${DATE}-fantasy-less-watchlist.json`],
  ["outputs/watchlists/fantasy-less-watchlist.txt", `outputs/history/${DATE}-fantasy-less-watchlist.txt`],
];

fs.mkdirSync("outputs/history", { recursive: true });

const saved = [];
const missing = [];

for (const [src, dst] of files) {
  if (!fs.existsSync(src)) {
    missing.push(src);
    continue;
  }
  fs.copyFileSync(src, dst);
  saved.push(dst);
}

const manifest = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  policy: "Date-specific Fantasy LESS watchlist snapshot. Research-only. Used for future direct Fantasy LESS grading/backtests.",
  saved,
  missing
};

fs.writeFileSync(`outputs/history/${DATE}-fantasy-less-watchlist-manifest.json`, JSON.stringify(manifest, null, 2));

console.log("FANTASY LESS WATCHLIST SNAPSHOT");
console.log("===============================");
console.log(`date: ${DATE}`);
console.log(`saved: ${saved.length}`);
for (const x of saved) console.log(`- ${x}`);
if (missing.length) {
  console.log(`missing: ${missing.length}`);
  for (const x of missing) console.log(`- ${x}`);
}
