const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const explicitDateArg = !!(process.argv[2] || process.env.SLATE_DATE || process.env.npm_config_date);
const FILES = explicitDateArg
  ? [`outputs/external-confirmation/external-mlb-form-confirmation-${DATE}.json`]
  : [
      `outputs/external-confirmation/external-mlb-form-confirmation-${DATE}.json`,
      "outputs/external-confirmation/external-mlb-form-confirmation-latest.json"
    ];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function pickFile() {
  return FILES.find(f => fs.existsSync(f));
}

function val(v) {
  if (v === null || v === undefined || v === "") return "n/a";
  return v;
}

function pct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "n/a";
  return `${Number(v).toFixed(1)}%`;
}

function prop(r) {
  return `${r.market} ${r.side} ${r.line}`;
}

function compactProfile(r) {
  const p = r.externalGeneralHandProfile;
  if (!p?.available) return "";
  return ` | Profile(${p.hand}) PA=${val(p.pa)} xBA=${val(p.xba ?? p.avg)} xwOBA=${val(p.xwoba)} xSLG=${val(p.xslg)} sample=${p.enoughSample ? "OK" : "LIGHT"}`;
}

function line(r, i) {
  return [
    `${i + 1}. ${r.decision} | EXT ${r.externalGrade}(${r.externalScore}) | ${r.player} | ${r.team || ""} | ${prop(r)}`,
    `MLB L10=${pct(r.externalL10?.hitRate)} Season=${pct(r.externalSeason?.hitRate)} avg=${val(r.externalSeason?.average)} n=${val(r.externalSeason?.graded)}`,
    `HA(${val(r.currentHomeAway || r.homeAway)})=${pct(r.externalHomeAway?.hitRate)} n=${val(r.externalHomeAway?.graded)}`,
    `Hand(${val(r.currentPitcherHand || r.opposingPitcherHand)})=${pct(r.externalPitcherHand?.hitRate)} n=${val(r.externalPitcherHand?.graded)}`,
    `Signal=${val(r.externalHandSignalUsed)}${compactProfile(r)}`,
    `vsP=${r.externalVsPitcher?.available ? `${r.externalVsPitcher.pitcherName}: PA=${r.externalVsPitcher.plateAppearances} clear=${r.externalVsPitcher.clear}` : val(r.externalVsPitcher?.reason)}`
  ].join(" | ");
}

function section(title, rows) {
  const out = [];
  out.push(title);
  out.push("-".repeat(title.length));
  if (!rows.length) out.push("none");
  rows.forEach((r, i) => out.push(line(r, i)));
  out.push("");
  return out.join("\n");
}

function main() {
  const file = pickFile();
  if (!file) {
    console.log("EXTERNAL CONFIRMATION");
    console.log("=====================");
    console.log(`No external confirmation report found for ${DATE}.`);
    console.log("Run: npm run confirm:external -- YYYY-MM-DD");
    return;
  }

  const data = readJson(file, {});
  const rows = Array.isArray(data.rows) ? data.rows : [];

  const official = rows.filter(r => r.decision === "KEEP_OFFICIAL");
  const leans = rows.filter(r => r.decision === "KEEP_SMALL_LEAN");
  const watch = rows.filter(r => r.decision === "WATCH_ONLY" || r.decision === "WATCHLIST_PLUS" || r.decision === "OFFICIAL_REVIEW");

  const lines = [
    "",
    "EXTERNAL CONFIRMATION SUMMARY",
    "=============================",
    `date: ${data.date || DATE}`,
    `source: ${data.source || "external MLB confirmation"}`,
    `rows: ${rows.length}`,
    "",
    section("OFFICIAL EXTERNAL", official),
    section("LEAN EXTERNAL", leans),
    section("WATCH EXTERNAL", watch),
    "External notes:",
    "- Display only. This does not promote, downgrade, block, or change slips.",
    "- External grade is not active as a betting rule yet.",
    ""
  ];

  console.log(lines.join("\n"));
}

main();
