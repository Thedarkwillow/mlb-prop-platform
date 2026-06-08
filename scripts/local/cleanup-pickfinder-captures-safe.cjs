const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "outputs");
const LOG = path.join(ROOT, "logs", "pickfinder-cleanup.log");

const KEEP_ACTIVE_FILES = new Set([
  "pickfinder-mlb-full-capture.json",
  "pickfinder-mlb-props.json",
  "pickfinder-mlb-popular.json",
  "pickfinder-mlb-discrepancies.json",
  "pickfinder-mlb-odds.json",
  "pickfinder-mlb-player-details.json",
  "pickfinder-mlb-lineups.json",
  "pickfinder-player-signals.txt",
  "pickfinder-board-signal-audit.json",
  "pickfinder-board-signal-audit.txt",
  "pickfinder-field-inventory.json",
  "pickfinder-field-inventory.txt",
  "pickfinder-coverage-lite.json",
  "pickfinder-coverage-lite.txt"
]);

const COMPRESS_PATTERNS = [
  /^pickfinder-.*\.json$/,
  /^pickfinder-.*\.txt$/,
  /^auto-pickfinder-.*\.json$/,
  /^auto-pickfinder-.*\.txt$/
];

const DELETE_GZ_AFTER_DAYS = Number(process.env.PF_CLEANUP_DELETE_GZ_DAYS || 14);
const COMPRESS_AFTER_HOURS = Number(process.env.PF_CLEANUP_COMPRESS_AFTER_HOURS || 36);
const DRY_RUN = process.env.DRY_RUN === "1";

function nowIso() {
  return new Date().toISOString();
}

function log(line) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const msg = `[${nowIso()}] ${line}`;
  fs.appendFileSync(LOG, msg + "\n");
  console.log(msg);
}

function ageHours(st) {
  return (Date.now() - st.mtimeMs) / 36e5;
}

function ageDays(st) {
  return (Date.now() - st.mtimeMs) / 864e5;
}

function shouldCompress(file) {
  if (KEEP_ACTIVE_FILES.has(file)) return false;
  if (file.endsWith(".gz")) return false;
  return COMPRESS_PATTERNS.some(rx => rx.test(file));
}

function compressFile(abs) {
  const gz = `${abs}.gz`;
  if (fs.existsSync(gz)) return { skipped: true, reason: "gz_exists" };

  if (!DRY_RUN) {
    const input = fs.readFileSync(abs);
    const output = zlib.gzipSync(input, { level: 9 });
    fs.writeFileSync(gz, output);
    fs.unlinkSync(abs);
  }

  return { skipped: false, gz };
}

function main() {
  log("=== PICKFINDER CLEANUP START ===");
  log(`dryRun=${DRY_RUN} compressAfterHours=${COMPRESS_AFTER_HOURS} deleteGzAfterDays=${DELETE_GZ_AFTER_DAYS}`);

  if (!fs.existsSync(OUT_DIR)) {
    log(`missing outputs dir: ${OUT_DIR}`);
    return;
  }

  const files = fs.readdirSync(OUT_DIR);
  let compressed = 0;
  let deleted = 0;
  let skipped = 0;

  for (const file of files) {
    const abs = path.join(OUT_DIR, file);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;

    if (file.endsWith(".gz") && /^pickfinder-/.test(file)) {
      if (ageDays(st) > DELETE_GZ_AFTER_DAYS) {
        if (!DRY_RUN) fs.unlinkSync(abs);
        deleted++;
        log(`deleted old gz: ${file} ageDays=${ageDays(st).toFixed(1)}`);
      } else {
        skipped++;
      }
      continue;
    }

    if (!shouldCompress(file)) {
      skipped++;
      continue;
    }

    if (ageHours(st) < COMPRESS_AFTER_HOURS) {
      skipped++;
      continue;
    }

    const res = compressFile(abs);
    if (res.skipped) {
      skipped++;
      log(`skip compress ${file}: ${res.reason}`);
    } else {
      compressed++;
      log(`compressed: ${file} -> ${path.basename(res.gz)}`);
    }
  }

  log(`summary compressed=${compressed} deleted=${deleted} skipped=${skipped}`);
  log("=== PICKFINDER CLEANUP END ===");
}

main();
