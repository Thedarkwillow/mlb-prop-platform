const fs = require("fs");
const path = require("path");
const cp = require("child_process");

function argDate() {
  const a = process.argv.find(x => /^--date=/.test(x));
  if (a) return a.replace(/^--date=/, "");

  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;

  if (process.env.npm_config_date) return process.env.npm_config_date;

  return new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const TS = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const base = `full-eod-results-${DATE}-${TS}`;
const outRoot = path.join("outputs", "downloads", base);
const tarPath = path.join("outputs", "downloads", `${base}.tar.gz`);

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(src, destDir = outRoot) {
  if (!fs.existsSync(src)) return false;
  mkdirp(destDir);
  fs.copyFileSync(src, path.join(destDir, path.basename(src)));
  return true;
}

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

mkdirp(outRoot);

let copied = 0;

// Date-specific history only.
// This prevents a 2026-06-06 package from pulling generic 2026-06-07 current files.
walk("outputs/history", p => {
  const b = path.basename(p);
  if (b.startsWith(`${DATE}-`) && (b.endsWith(".json") || b.endsWith(".txt"))) {
    if (copyIfExists(p)) copied++;
  }
});

// Root output files only if filename itself includes the date.
walk("outputs", p => {
  const rel = p.replace(/\\/g, "/");
  if (rel.includes("/downloads/") || rel.includes("/history/")) return;

  const b = path.basename(p);
  if (b.includes(DATE) && (b.endsWith(".json") || b.endsWith(".txt"))) {
    if (copyIfExists(p)) copied++;
  }
});

// Context snapshot is allowed but clearly labeled as package-time context.
const contextDir = path.join(outRoot, "context_snapshot_generated_at_package_time");

for (const f of [
  "data/context/lineups.json",
  "data/context/bullpen-fatigue.json",
  "data/context/catcher-framing.json",
  "data/context/umpires.json",
  "data/context/imports/today-umpires.csv",
  "data/context/imports/catcher-framing.csv",
  "data/savant/bullpen-arsenal-compact.json",
  "data/savant/pitcher-arsenal-compact.json",
  "data/savant/pitcher-velocity-trends.json",
  "data/savant/starter-arsenal-compact.json",
  "data/manual-pitcher-risk-overrides.json",
  "package.json"
]) {
  if (copyIfExists(f, contextDir)) copied++;
}

const required = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/history/${DATE}-standard-hitter-bridge-watchlist-graded.json`,
  `outputs/history/${DATE}-less-batter-watchlist-graded.json`,
  `outputs/history/${DATE}-hrr-graded.json`
];

const missingRequired = required.filter(f => !fs.existsSync(f));

fs.writeFileSync(path.join(outRoot, "README.txt"), [
  "FULL END OF DAY RESULTS PACKAGE",
  `Date graded: ${DATE}`,
  `Generated UTC: ${new Date().toISOString()}`,
  "",
  "This package intentionally avoids generic current files like:",
  "- outputs/priced-board.json",
  "- outputs/final-slips.json",
  "- outputs/mobile-summary.txt",
  "- outputs/official-slip.json",
  "",
  `Generic current files are excluded unless their filename includes ${DATE}.`,
  `That prevents mixing a ${DATE} package with the next slate's current outputs.`,
  "",
  "Context files are included separately under:",
  "- context_snapshot_generated_at_package_time/",
  "",
  `Copied files: ${copied}`,
  "",
  "Missing required files:",
  ...(missingRequired.length ? missingRequired.map(x => `- ${x}`) : ["- none"])
].join("\n") + "\n");

cp.execFileSync("tar", ["-czf", tarPath, "-C", "outputs/downloads", base], {
  stdio: "inherit"
});

console.log(JSON.stringify({
  date: DATE,
  outRoot,
  tarPath,
  copied,
  missingRequired
}, null, 2));

if (missingRequired.length && process.env.STRICT_EOD_PACKAGE === "1") {
  process.exit(2);
}
