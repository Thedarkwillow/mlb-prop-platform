const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

const final = readJson("outputs/playable-final-slips.json", []);
const goblinReport = readJson("outputs/goblin-shadow-report.json", null);

if (!goblinReport) {
  throw new Error("Missing outputs/goblin-shadow-report.json. Run node src/research/goblin-shadow-report.cjs first.");
}

const blockedMarkets = new Set([
  "hitter_fantasy_score",
  "pitcher_fantasy_score",
  "pitches_thrown",
  "plate_appearances",
  "walks",
  "walks_allowed",
  "singles",
  "doubles",
  "triples",
  "stolen_bases",
  "hitter_strikeouts",
  "pitcher_strikeouts_(combo)",
  "home_runs",
  "hr"
]);

const standard2 = final.find(s => s.name === "2-MAN POWER" && s.complete && Array.isArray(s.legs) && s.legs.length === 2);

const goblins = (goblinReport.rows || [])
  .filter(r =>
    r.side === "MORE" &&
    !blockedMarkets.has(norm(r.market)) &&
    Number(r.prob) >= 0.75
  )
  .sort((a, b) => Number(b.prob || 0) - Number(a.prob || 0));

const usedPlayers = new Set((standard2?.legs || []).map(l => String(l.player).toLowerCase()));

const goblin = goblins.find(g => !usedPlayers.has(String(g.player).toLowerCase()));

const slips = [];

if (standard2 && goblin) {
  slips.push({
    name: "3-MAN GOBLIN-ASSISTED",
    mode: "goblin_assisted",
    complete: true,
    warning: "Goblin is a probability helper, not standalone +EV. Use only if you prefer lower payout over no 3-man.",
    legs: [
      ...standard2.legs,
      {
        player: goblin.player,
        team: goblin.team,
        game: goblin.game,
        market: goblin.market,
        side: "MORE",
        line: goblin.line,
        calibratedDistributionProb: goblin.prob,
        grade: "GOBLIN_ASSIST",
        books: goblin.books,
        edge: goblin.edge,
        modelEv: goblin.modelEv,
        specialTier: "goblin",
        warning: "Negative standalone goblin EV; added only as completion leg."
      }
    ]
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  mode: "GOBLIN_ASSISTED_SHADOW",
  policy: {
    liveEnabled: false,
    maxGoblinsPerSlip: 1,
    minGoblinProb: 0.75,
    reason: "Shadow-only goblin-assisted construction. Main playable slips remain unchanged."
  },
  baseSlipFound: Boolean(standard2),
  eligibleGoblins: goblins.length,
  selectedGoblin: goblin || null,
  slips
};

fs.writeFileSync("outputs/goblin-assisted-slips.json", JSON.stringify(out, null, 2));

console.log("GOBLIN ASSISTED SLIPS");
console.log("=====================");
console.log({
  baseSlipFound: out.baseSlipFound,
  eligibleGoblins: out.eligibleGoblins,
  built: slips.length
});
console.table(slips.flatMap(s => s.legs.map((l, i) => ({
  slip: s.name,
  leg: i + 1,
  player: l.player,
  market: l.market,
  side: l.side,
  line: l.line,
  prob: l.calibratedDistributionProb,
  grade: l.grade,
  tier: l.specialTier || "standard"
}))));
console.log("Wrote outputs/goblin-assisted-slips.json");
