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

function hasExternalDetail(r) {
  return Boolean(
    r.externalGrade ||
    r.externalScore !== undefined ||
    r.externalL10 ||
    r.externalSeason ||
    r.externalHomeAway ||
    r.externalPitcherHand ||
    r.externalHandSignalUsed ||
    r.externalVsPitcher ||
    r.externalGeneralHandProfile ||
    r.form ||
    r.lineup ||
    r.pickfinder
  );
}

function gradeLabel(r) {
  return r.externalGrade || r.grade || "UNKNOWN";
}

function scoreLabel(r) {
  return r.externalScore ?? r.score ?? "n/a";
}

function formSummary(r) {
  if (!r.form) return null;
  if (typeof r.form === "string") return `Form=${r.form}`;
  const parts = [];
  if (r.form.l10HitRate != null) parts.push(`L10=${pct(r.form.l10HitRate)}`);
  if (r.form.seasonHitRate != null) parts.push(`Season=${pct(r.form.seasonHitRate)}`);
  if (r.form.average != null) parts.push(`avg=${val(r.form.average)}`);
  if (r.form.graded != null) parts.push(`n=${val(r.form.graded)}`);
  return parts.length ? `Form ${parts.join(" ")}` : null;
}

function lineupSummary(r) {
  if (!r.lineup) return null;
  if (typeof r.lineup === "string") return `Lineup=${r.lineup}`;
  const status = r.lineup.status || r.lineup.confirmed || r.lineup.source || null;
  return status ? `Lineup=${status}` : null;
}

function pickfinderSummary(r) {
  if (!r.pickfinder) return null;
  if (typeof r.pickfinder === "string") return `PF=${r.pickfinder}`;
  const parts = [];
  if (r.pickfinder.status) parts.push(r.pickfinder.status);
  if (r.pickfinder.battingOrder) parts.push(`bat=${r.pickfinder.battingOrder}`);
  if (r.pickfinder.pitcherHand) parts.push(`vs ${r.pickfinder.pitcherHand}`);
  return parts.length ? `PF=${parts.join(" ")}` : null;
}

function line(r, i) {
  const head = `${i + 1}. ${r.decision} | EXT ${gradeLabel(r)}(${scoreLabel(r)}) | ${r.player} | ${r.team || ""} | ${prop(r)} | tier=${val(r.tier)} | prob=${val(r.prob)} | edge=${val(r.edge)} | books=${val(r.books)}`;

  const details = [];

  if (r.externalL10 || r.externalSeason) {
    details.push(`MLB L10=${pct(r.externalL10?.hitRate)} Season=${pct(r.externalSeason?.hitRate)} avg=${val(r.externalSeason?.average)} n=${val(r.externalSeason?.graded)}`);
  }

  if (r.externalHomeAway) {
    details.push(`HA(${val(r.currentHomeAway || r.homeAway)})=${pct(r.externalHomeAway?.hitRate)} n=${val(r.externalHomeAway?.graded)}`);
  }

  if (r.externalPitcherHand) {
    details.push(`Hand(${val(r.currentPitcherHand || r.opposingPitcherHand)})=${pct(r.externalPitcherHand?.hitRate)} n=${val(r.externalPitcherHand?.graded)}`);
  }

  if (r.externalHandSignalUsed || r.externalGeneralHandProfile) {
    details.push(`Signal=${val(r.externalHandSignalUsed)}${compactProfile(r)}`);
  }

  if (r.externalVsPitcher) {
    details.push(`vsP=${r.externalVsPitcher?.available ? `${r.externalVsPitcher.pitcherName}: PA=${r.externalVsPitcher.plateAppearances} clear=${r.externalVsPitcher.clear}` : val(r.externalVsPitcher?.reason)}`);
  }

  const form = formSummary(r);
  const lineup = lineupSummary(r);
  const pf = pickfinderSummary(r);
  if (form) details.push(form);
  if (lineup) details.push(lineup);
  if (pf) details.push(pf);

  if (Array.isArray(r.notes) && r.notes.length) details.push(`notes=${r.notes.join(",")}`);
  if (Array.isArray(r.reasons) && r.reasons.length) details.push(`reasons=${r.reasons.join(",")}`);

  return details.length ? `${head} | ${details.join(" | ")}` : head;
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
