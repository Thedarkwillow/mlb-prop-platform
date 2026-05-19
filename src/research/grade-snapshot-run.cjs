const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const DATE =
  args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const RUN =
  process.env.npm_config_run ||
  args.find(a => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(a)) ||
  null;

const useLatest =
  process.env.npm_config_latest === "true" ||
  args.includes("--latest") ||
  !RUN;

function read(pathName, fallback) {
  try {
    if (!fs.existsSync(pathName)) return fallback;
    return JSON.parse(fs.readFileSync(pathName, "utf8"));
  } catch {
    return fallback;
  }
}

const baseDir = path.join("outputs", "history", "runs", DATE);
let runId = RUN;

if (useLatest) {
  const latest = read(path.join(baseDir, "latest-run.json"), null);
  if (!latest?.runId) {
    throw new Error(`No latest-run.json found for ${DATE}`);
  }
  runId = latest.runId;
}

const runDir = path.join(baseDir, runId);
const snapshotPlayable = path.join(runDir, "playable-final-slips.json");

if (!fs.existsSync(snapshotPlayable)) {
  throw new Error(`Missing snapshot playable slips: ${snapshotPlayable}`);
}

fs.mkdirSync("outputs/history/grade-backups", { recursive: true });

const backupPath = path.join(
  "outputs",
  "history",
  "grade-backups",
  `playable-final-slips-before-grade-run-${DATE}-${Date.now()}.json`
);

if (fs.existsSync("outputs/playable-final-slips.json")) {
  fs.copyFileSync("outputs/playable-final-slips.json", backupPath);
}

fs.copyFileSync(snapshotPlayable, "outputs/playable-final-slips.json");

console.log("GRADE SNAPSHOT RUN");
console.log(JSON.stringify({
  date: DATE,
  runId,
  runDir,
  source: snapshotPlayable,
  activeTarget: "outputs/playable-final-slips.json",
  backupPath: fs.existsSync(backupPath) ? backupPath : null
}, null, 2));

const res = spawnSync("npm", ["run", "grade", `--date=${DATE}`], {
  stdio: "inherit",
  shell: false
});

if (res.status !== 0) {
  process.exit(res.status || 1);
}

const gradedPath = `outputs/playable-final-slips-graded-${DATE}.json`;
const frozenGradedPath = path.join(runDir, `playable-final-slips-graded-${DATE}.json`);

if (fs.existsSync(gradedPath)) {
  fs.copyFileSync(gradedPath, frozenGradedPath);
  console.log("Wrote frozen graded snapshot:", frozenGradedPath);
}

const manifestPath = path.join(runDir, "manifest.json");
const manifest = read(manifestPath, {});
manifest.graded = {
  gradedAtUtc: new Date().toISOString(),
  date: DATE,
  runId,
  source: snapshotPlayable,
  gradedPath: fs.existsSync(frozenGradedPath) ? frozenGradedPath : null
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const perf = spawnSync("node", ["src/research/slip-type-performance.cjs", DATE, fs.existsSync(frozenGradedPath) ? frozenGradedPath : gradedPath], {
  stdio: "inherit",
  shell: false
});

if (perf.status !== 0) {
  console.warn("WARNING: slip-type performance tracking failed");
}

console.log("Snapshot grading complete.");
