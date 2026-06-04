const fs = require("fs");

const INPUTS = [
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/slips-priced.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/priced-board.json"
];

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const hasLegShape =
    v.player || v.playerName || v.name ||
    v.market || v.statType || v.line ||
    v.side || v.pick || v.recommendation;

  if (hasLegShape) out.push(v);

  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flatten(x, out);
  }

  return out;
}

function normMarket(x) {
  return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function isPitcherMarket(m) {
  return /strikeout|pitching|earned_run|outs|walks_allowed|hits_allowed|k\b|ks\b/.test(normMarket(m));
}

function sideOf(x) {
  const s = String(x.side || x.pick || x.recommendation || x.selection || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "";
}

function getNum(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pfSide(obj) {
  const raw = String(
    obj.pickfinderSide ||
    obj.pfSide ||
    obj.pickFinderSide ||
    obj.pfRecommendation ||
    obj.pickfinderRecommendation ||
    obj.pfLean ||
    obj.pickfinderLean ||
    ""
  ).toUpperCase();

  if (raw.includes("MORE") || raw.includes("OVER")) return "MORE";
  if (raw.includes("LESS") || raw.includes("UNDER")) return "LESS";

  const line = getNum(obj, ["line", "propLine", "ppLine"]);
  const pfProj = getNum(obj, [
    "pickfinderProjection",
    "pfProjection",
    "pickFinderProjection",
    "pfProj",
    "pickfinderProj"
  ]);

  if (line !== null && pfProj !== null) {
    if (pfProj > line) return "MORE";
    if (pfProj < line) return "LESS";
  }

  return "";
}

function playerOf(x) {
  return String(x.player || x.playerName || x.name || x.fullName || "").trim();
}

function teamOf(x) {
  return String(x.team || x.playerTeam || x.abbrev || "").trim();
}

const rows = [];

for (const file of INPUTS) {
  const data = readJson(file);
  if (!data) continue;

  for (const r of flatten(data)) {
    const player = playerOf(r);
    const market = r.market || r.statType || r.projectionType || "";
    if (!player || !market) continue;
    if (isPitcherMarket(market)) continue;

    const ourSide = sideOf(r);
    const pf = pfSide(r);
    if (!ourSide || !pf) continue;

    const line = getNum(r, ["line", "propLine", "ppLine"]);
    const ourProj = getNum(r, ["projection", "modelProjection", "proj", "mean"]);
    const pfProj = getNum(r, ["pickfinderProjection", "pfProjection", "pickFinderProjection", "pfProj", "pickfinderProj"]);
    const prob = getNum(r, ["probability", "prob", "modelProbability", "hitProbability"]);
    const ev = getNum(r, ["ev", "EV", "expectedValue"]);

    if (ourSide !== pf) {
      rows.push({
        file,
        player,
        team: teamOf(r),
        market,
        line,
        ourSide,
        pickfinderSide: pf,
        ourProjection: ourProj,
        pickfinderProjection: pfProj,
        probability: prob,
        ev,
        confidence: r.confidence || r.conf || r.tier || "",
        reason: "PF_DISAGREES_WITH_MODEL_SIDE"
      });
    }
  }
}

rows.sort((a, b) => {
  const ea = Number.isFinite(b.ev) ? b.ev : -999;
  const eb = Number.isFinite(a.ev) ? a.ev : -999;
  return ea - eb;
});

const report = {
  generatedAt: new Date().toISOString(),
  inputFiles: INPUTS,
  disagreeCount: rows.length,
  rows
};

fs.writeFileSync("outputs/audits/hitter-pf-disagree-audit.json", JSON.stringify(report, null, 2));

console.log("=== Hitter PickFinder Disagree Audit ===");
console.log("Disagreements:", rows.length);
for (const r of rows.slice(0, 25)) {
  console.log(`${r.player} | ${r.market} ${r.line ?? ""} | model=${r.ourSide} pf=${r.pickfinderSide} | proj=${r.ourProjection ?? "-"} pfProj=${r.pickfinderProjection ?? "-"} | ${r.file}`);
}
console.log("Saved: outputs/audits/hitter-pf-disagree-audit.json");
