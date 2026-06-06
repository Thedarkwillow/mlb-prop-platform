const fs = require("fs");

const JSON_FILE = "outputs/goblin-recommended-card.json";
const TXT_FILE = "outputs/goblin-recommended-card.txt";
const OUT_TXT = "outputs/goblin-recommended-card-audit.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch { return ""; }
}

function isDoNotPlay(row) {
  return String(row?.playability || "").toUpperCase() === "DO_NOT_PLAY";
}

const json = readJson(JSON_FILE, {});
const text = readText(TXT_FILE);

const primaryRows = Array.isArray(json.primary) ? json.primary : [];
const secondaryRows = Array.isArray(json.secondary) ? json.secondary : [];
const shadowRows = Array.isArray(json.shadow) ? json.shadow : [];
const doNotPlayRows = Array.isArray(json.doNotPlay) ? json.doNotPlay : [];

const primaryDoNotPlayRows = primaryRows.filter(isDoNotPlay);
const secondaryDoNotPlayRows = secondaryRows.filter(isDoNotPlay);
const shadowDoNotPlayRows = shadowRows.filter(isDoNotPlay);

const primaryText = (() => {
  const a = text.indexOf("PRIMARY CARD");
  const b = text.indexOf("SECONDARY / UPSIDE");
  if (a === -1) return "";
  if (b === -1) return text.slice(a);
  return text.slice(a, b);
})();

const primaryTextNoPlayableCard = /NO_PLAYABLE_GOBLIN_CARD/i.test(primaryText);
const primaryTextHasDoNotPlaySlip = /\|\s*DO_NOT_PLAY\s*\|/.test(primaryText);
const primaryTextHasPlayableSlip = /\|\s*(WATCHLIST|PRIMARY_TRACK)\s*\|/.test(primaryText);

const errors = [];

if (primaryDoNotPlayRows.length) {
  errors.push(`JSON primary array contains ${primaryDoNotPlayRows.length} DO_NOT_PLAY row(s).`);
}
if (secondaryDoNotPlayRows.length) {
  errors.push(`JSON secondary array contains ${secondaryDoNotPlayRows.length} DO_NOT_PLAY row(s).`);
}
if (shadowDoNotPlayRows.length) {
  errors.push(`JSON shadow array contains ${shadowDoNotPlayRows.length} DO_NOT_PLAY row(s).`);
}
if (!primaryRows.length && !primaryTextNoPlayableCard) {
  errors.push("No JSON primary rows, but text does not clearly say NO_PLAYABLE_GOBLIN_CARD.");
}
if (primaryTextHasDoNotPlaySlip && !primaryTextNoPlayableCard) {
  errors.push("Primary text section contains DO_NOT_PLAY rows without NO_PLAYABLE_GOBLIN_CARD.");
}
if (primaryRows.length && !primaryTextHasPlayableSlip) {
  errors.push("JSON primary rows exist, but primary text has no playable slip rows.");
}

const report = {
  generatedAt: new Date().toISOString(),
  jsonFile: JSON_FILE,
  txtFile: TXT_FILE,
  status: errors.length ? "FAIL" : "PASS",
  primaryRows: primaryRows.length,
  secondaryRows: secondaryRows.length,
  shadowRows: shadowRows.length,
  doNotPlayRows: doNotPlayRows.length,
  primaryDoNotPlay: primaryDoNotPlayRows.length,
  secondaryDoNotPlay: secondaryDoNotPlayRows.length,
  shadowDoNotPlay: shadowDoNotPlayRows.length,
  primaryTextHasDoNotPlaySlip,
  primaryTextHasPlayableSlip,
  primaryTextNoPlayableCard,
  jsonStatus: json.status || null,
  errors
};

const lines = [];
lines.push("GOBLIN RECOMMENDED CARD SAFETY AUDIT");
lines.push("====================================");
lines.push(JSON.stringify(report, null, 2));

if (primaryDoNotPlayRows.length) {
  lines.push("");
  lines.push("BAD PRIMARY ROWS:");
  primaryDoNotPlayRows.forEach((row, i) => {
    lines.push(`${i + 1}. ${row.id || "?"} | ${row.lane || "?"} | ${row.size || "?"}-man ${row.entryType || "?"} | ${row.playability || "?"} | bucket=${row.recommendationBucket || row.bucket || "?"}`);
  });
}

fs.writeFileSync(OUT_TXT, lines.join("\n"));

console.log(report);

if (errors.length) {
  console.error("GOBLIN RECOMMENDED CARD AUDIT FAILED");
  process.exit(1);
}

console.log("GOBLIN RECOMMENDED CARD AUDIT PASSED");
