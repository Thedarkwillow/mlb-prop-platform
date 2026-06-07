const fs = require("fs");

function getDate() {
  const arg = process.argv.find(x => /^--date=/.test(x));
  if (arg) return arg.replace(/^--date=/, "");
  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const SRC = "outputs/manual/auto-reverse-hitter-signal.json";
const SRC_TXT = "outputs/manual/auto-reverse-hitter-signal.txt";
const OUT = `outputs/history/${DATE}-reverse-hitter-signal.json`;
const OUT_TXT = `outputs/history/${DATE}-reverse-hitter-signal.txt`;

fs.mkdirSync("outputs/history", { recursive: true });

if (!fs.existsSync(SRC)) {
  const msg = `MISSING_REVERSE_HITTER_SIGNAL_SOURCE: ${SRC}`;
  console.error(msg);
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    date: DATE,
    error: "MISSING_REVERSE_HITTER_SIGNAL_SOURCE",
    expectedSource: SRC
  }, null, 2));
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
raw.archivedAt = new Date().toISOString();
raw.archiveDate = DATE;
raw.archiveSource = SRC;

fs.writeFileSync(OUT, JSON.stringify(raw, null, 2) + "\n");

if (fs.existsSync(SRC_TXT)) {
  fs.copyFileSync(SRC_TXT, OUT_TXT);
} else {
  fs.writeFileSync(OUT_TXT, `Archived reverse hitter signal for ${DATE}\n`);
}

console.log({
  generatedAt: new Date().toISOString(),
  date: DATE,
  source: SRC,
  out: OUT,
  txt: OUT_TXT
});
