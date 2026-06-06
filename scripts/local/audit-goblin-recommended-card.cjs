const fs = require("fs");

const JSON_FILE = "outputs/goblin-recommended-card.json";
const TXT_FILE = "outputs/goblin-recommended-card.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch { return ""; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.id ||
    v.slipId ||
    v.lane ||
    v.playability ||
    v.recommendationBucket ||
    v.bucket ||
    v.entryType
  ) out.push(v);

  for (const val of Object.values(v)) flatten(val, out);
  return out;
}

function norm(v) {
  return String(v || "").trim().toUpperCase();
}

function section(text, startLabel, endLabels) {
  const lines = String(text || "").split(/\r?\n/);
  let on = false;
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === startLabel) {
      on = true;
      continue;
    }
    if (on && endLabels.includes(t)) break;
    if (on) out.push(line);
  }
  return out.join("\n");
}

const data = readJson(JSON_FILE, {});
const text = readText(TXT_FILE);
const rows = flatten(data);

const primaryRows = rows.filter(r => {
  const bucket = norm(r.recommendationBucket || r.bucket);
  return bucket.includes("PRIMARY");
});

const primaryDoNotPlay = primaryRows.filter(r => norm(r.playability) === "DO_NOT_PLAY");

const primaryText = section(text, "PRIMARY CARD", [
  "SECONDARY / UPSIDE",
  "SHADOW ONLY",
  "DO NOT PLAY"
]);

const primaryTextHasDoNotPlay = /\bDO_NOT_PLAY\b/i.test(primaryText);
const primaryTextHasPlayableSlip = /^\d+\.\s+/m.test(primaryText);
const primaryTextNoPlayableCard = /NO_PLAYABLE_GOBLIN_CARD/i.test(primaryText);

const summary = {
  generatedAt: new Date().toISOString(),
  jsonFile: JSON_FILE,
  txtFile: TXT_FILE,
  primaryRows: primaryRows.length,
  primaryDoNotPlay: primaryDoNotPlay.length,
  primaryTextHasDoNotPlay,
  primaryTextHasPlayableSlip,
  primaryTextNoPlayableCard,
  status: "PASS"
};

const errors = [];

if (primaryDoNotPlay.length) {
  errors.push(`JSON primary bucket contains ${primaryDoNotPlay.length} DO_NOT_PLAY row(s).`);
}

if (primaryTextHasDoNotPlay && primaryTextHasPlayableSlip) {
  errors.push("Text PRIMARY CARD section contains DO_NOT_PLAY playable rows.");
}

if (!primaryTextHasPlayableSlip && !primaryTextNoPlayableCard) {
  errors.push("Text PRIMARY CARD section has no playable slips and no NO_PLAYABLE_GOBLIN_CARD message.");
}

if (errors.length) {
  summary.status = "FAIL";
  summary.errors = errors;
}

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/goblin-recommended-card-audit.json", JSON.stringify(summary, null, 2));

const txt = [
  "GOBLIN RECOMMENDED CARD SAFETY AUDIT",
  "====================================",
  JSON.stringify(summary, null, 2),
  "",
  ...(primaryDoNotPlay.length ? [
    "BAD PRIMARY ROWS:",
    ...primaryDoNotPlay.slice(0, 25).map((r, i) =>
      `${i + 1}. ${r.id || r.slipId || "unknown"} | ${r.lane || "?"} | ${r.size || "?"}-man ${r.entryType || "?"} | ${r.playability || "?"} | bucket=${r.recommendationBucket || r.bucket || "?"}`
    )
  ] : ["No DO_NOT_PLAY rows found in primary card."])
].join("\n");

fs.writeFileSync("outputs/goblin-recommended-card-audit.txt", txt);

console.log(summary);

if (summary.status !== "PASS") {
  console.error("GOBLIN RECOMMENDED CARD AUDIT FAILED");
  process.exit(1);
}
