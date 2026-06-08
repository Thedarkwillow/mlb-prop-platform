const fs = require("fs");
const path = require("path");

const IN = "outputs/standard-leans-pickfinder-audit.json";
const OUT = "outputs/clean-standard-pf-lean-card.json";
const TXT = "outputs/clean-standard-pf-lean-card.txt";

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function text(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function avg(vals) {
  const xs = vals.map(n).filter(x => x !== null);
  return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : null;
}

const audit = read(IN, {});
const rows = Array.isArray(audit.topCandidates) ? audit.topCandidates : [];

const clean = [];

for (const r of rows) {
  const pf = r.pfFieldPreview && r.pfFieldPreview[0] ? r.pfFieldPreview[0] : null;
  if (!pf) continue;

  const side = String(r.side || "").toUpperCase();
  const l5 = n(pf.hitRateLast5);
  const l10 = n(pf.hitRateLast10);
  const l15 = n(pf.hitRateLast15);
  const pfAvg = avg([l5, l10, l15]);
  const diff = n(pf.differencePercent);
  const prob = n(r.probability);
  const ev = n(r.ev);

  if (r.pfRows < 1) continue;
  if (!String(r.lineupStatus || "").includes("CONFIRMED")) continue;

  // Pure PickFinder clean card guard:
  // Require the row to have PickFinder prop support AND PickFinder lineup confirmation.
  // Rows confirmed only by MLB Stats API can still live elsewhere, but not in this clean PF card.
  if (!String(r.lineupSource || "").toUpperCase().includes("PICKFINDER")) continue;

  if (String(r.tier || "").toLowerCase().includes("goblin")) continue;
  if (String(r.tier || "").toLowerCase().includes("demon")) continue;

  let pass = false;
  const tags = [];

  if (side === "MORE") {
    if (pfAvg !== null && pfAvg >= 62 && l10 !== null && l10 >= 60 && l15 !== null && l15 >= 55) {
      pass = true;
      tags.push("PF_MORE_TREND");
    }
    if (diff !== null && diff >= 50) tags.push("PF_DIFF_STRONG");
  }

  if (side === "LESS") {
    if (pfAvg !== null && pfAvg <= 38 && l10 !== null && l10 <= 40 && l15 !== null && l15 <= 45) {
      pass = true;
      tags.push("PF_LESS_TREND");
    }
    if (diff !== null && diff <= -25) tags.push("PF_DIFF_UNDER");
  }

  if (prob !== null && prob >= 0.62) tags.push("MODEL_PROB_OK");
  if (ev !== null && ev >= 0.20) tags.push("EV_OK");

  // Hard agreement guard:
  // A clean standard PF lean must have PickFinder trend support AND model/EV support.
  // This prevents rows with strong PF trend but weak model score, or strong model score but weak PF trend.
  if (!pass) continue;

  const modelAgrees =
    prob !== null &&
    prob >= 0.58 &&
    ev !== null &&
    ev >= 0.10;

  const strongerModelAgrees =
    prob !== null &&
    prob >= 0.62 &&
    ev !== null &&
    ev >= 0.20;

  const pfStrong =
    side === "MORE"
      ? (pfAvg !== null && pfAvg >= 62 && l10 !== null && l10 >= 60 && l15 !== null && l15 >= 55 && diff !== null && diff >= 40)
      : (pfAvg !== null && pfAvg <= 38 && l10 !== null && l10 <= 40 && l15 !== null && l15 <= 45 && diff !== null && diff <= -20);

  if (!pfStrong) continue;
  if (!(modelAgrees || strongerModelAgrees)) continue;

  clean.push({
    player: r.player,
    team: r.team,
    game: r.game,
    market: r.market,
    side: r.side,
    line: r.line,
    score: r.score,
    probability: r.probability,
    ev: r.ev,
    projection: r.projection,
    lineupStatus: r.lineupStatus,
    lineupSource: r.lineupSource,
    pfRows: r.pfRows,
    pfAvgHitRate: pfAvg === null ? null : +pfAvg.toFixed(1),
    pfL5: l5,
    pfL10: l10,
    pfL15: l15,
    pfDifferencePercent: diff,
    pfConsensusOver: pf.consensus_over_ip,
    pfConsensusUnder: pf.consensus_under_ip,
    tags,
    officialStatus: "RESEARCH_ONLY_STANDARD_PF_LEAN"
  });
}

clean.sort((a,b) => {
  const as = (a.probability || 0) * 100 + (a.ev || 0) * 10 + (a.pfAvgHitRate || 0);
  const bs = (b.probability || 0) * 100 + (b.ev || 0) * 10 + (b.pfAvgHitRate || 0);
  return bs - as;
});

write(OUT, {
  generatedAt: new Date().toISOString(),
  source: IN,
  count: clean.length,
  rule: "standard only, PickFinder-confirmed lineup, exact PickFinder prop match, PF trend threshold, model/EV agreement",
  officialStatus: "RESEARCH_ONLY_UNTIL_STANDARD_LANE_PROMOTES",
  rows: clean
});

const lines = [];
lines.push("CLEAN STANDARD PICKFINDER LEAN CARD");
lines.push("===================================");
lines.push(`generatedAt=${new Date().toISOString()}`);
lines.push(`count=${clean.length}`);
lines.push("officialStatus=RESEARCH_ONLY_UNTIL_STANDARD_LANE_PROMOTES");
lines.push("");
lines.push("TOP CLEAN STANDARD PF LEANS");
lines.push("---------------------------");

for (const r of clean.slice(0, 40)) {
  lines.push(`${r.player} | ${r.team} | ${r.game || "?"} | ${r.market} ${r.side} ${r.line} | prob=${r.probability ?? "?"} | EV=${r.ev ?? "?"} | PFavg=${r.pfAvgHitRate}% | L10=${r.pfL10}% | L15=${r.pfL15}% | diff=${r.pfDifferencePercent}% | source=${r.lineupSource}`);
  lines.push(`  tags=${r.tags.join(",")}`);
}

text(TXT, lines.join("\n") + "\n");

console.log({
  inputRows: rows.length,
  cleanRows: clean.length,
  top: clean.slice(0, 12).map(r => `${r.player} ${r.market} ${r.side} ${r.line} PFavg=${r.pfAvgHitRate} prob=${r.probability}`),
  out: OUT,
  txt: TXT
});
