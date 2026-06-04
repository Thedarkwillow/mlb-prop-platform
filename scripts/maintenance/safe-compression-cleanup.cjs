const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOTS = [
  "outputs/history",
  "outputs/warehouse",
  "outputs/audits"
];

const DRY_RUN = process.env.DRY_RUN === "1";
const COMPRESS_OLDER_DAYS = Number(process.env.COMPRESS_OLDER_DAYS || 14);
const DELETE_GZ_OLDER_DAYS = Number(process.env.DELETE_GZ_OLDER_DAYS || 120);
const now = Date.now();

function ageDays(file) {
  const st = fs.statSync(file);
  return (now - st.mtimeMs) / 86400000;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function safeCompress(file) {
  const gz = `${file}.gz`;
  if (fs.existsSync(gz)) return { action: "skip_exists", file };

  if (DRY_RUN) return { action: "would_compress", file };

  const input = fs.readFileSync(file);
  const output = zlib.gzipSync(input, { level: 9 });
  fs.writeFileSync(gz, output);
  fs.unlinkSync(file);
  return { action: "compressed", file, gz };
}

function safeDelete(file) {
  if (DRY_RUN) return { action: "would_delete_old_gz", file };
  fs.unlinkSync(file);
  return { action: "deleted_old_gz", file };
}

const actions = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const base = path.basename(file);

    // Never touch current live artifacts.
    if (/latest|current|final-slips|playable|official-slip|priced-board|mobile/i.test(base)) continue;

    const age = ageDays(file);

    if (file.endsWith(".json") && age >= COMPRESS_OLDER_DAYS) {
      actions.push(safeCompress(file));
    } else if (file.endsWith(".json.gz") && age >= DELETE_GZ_OLDER_DAYS) {
      actions.push(safeDelete(file));
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  compressOlderDays: COMPRESS_OLDER_DAYS,
  deleteGzOlderDays: DELETE_GZ_OLDER_DAYS,
  actions
};

fs.mkdirSync("outputs/maintenance", { recursive: true });
fs.writeFileSync("outputs/maintenance/safe-compression-cleanup-report.json", JSON.stringify(report, null, 2));

console.log("=== Safe Compression Cleanup ===");
console.log("Dry run:", DRY_RUN);
console.log("Actions:", actions.length);
for (const a of actions.slice(0, 40)) console.log(`${a.action}: ${a.file}`);
console.log("Saved: outputs/maintenance/safe-compression-cleanup-report.json");
