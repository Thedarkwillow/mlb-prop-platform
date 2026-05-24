const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "_").trim();
}

const final = readJson("outputs/playable-final-slips.json", []);
const goblinReport = readJson("outputs/goblin-shadow-report.json", null);
if (!goblinReport) throw new Error("Run node src/research/goblin-shadow-report.cjs first.");

const blockedMarkets = new Set([
  "hitter_fantasy_score",
  "pitcher_fantasy_score",
  "plate_appearances",
  "singles",
  "doubles",
  "triples",
  "stolen_bases",
  "pitcher_strikeouts_(combo)",
  "home_runs",
  "hr"
]);

const thresholds = {
  2: 0.85,
  3: 0.83,
  4: 0.81,
  5: 0.80,
  6: 0.78
};

const standardLegs = [];
for (const slip of final) {
  for (const leg of slip.legs || []) {
    if (!standardLegs.some(x =>
      x.player === leg.player &&
      x.market === leg.market &&
      x.side === leg.side &&
      Number(x.line) === Number(leg.line)
    )) {
      standardLegs.push(leg);
    }
  }
}

const goblins = (goblinReport.rows || [])
  .filter(r =>
    r.side === "MORE" &&
    !blockedMarkets.has(norm(r.market)) &&
    Number.isFinite(Number(r.prob))
  )
  .sort((a, b) => Number(b.prob || 0) - Number(a.prob || 0));

function buildSlip(size) {
  const minProb = thresholds[size];
  const baseCount = size - 1;
  const base = standardLegs.slice(0, baseCount);
  if (base.length < baseCount) return null;

  const usedPlayers = new Set(base.map(l => String(l.player).toLowerCase()));

  const goblin = goblins.find(g =>
    Number(g.prob) >= minProb &&
    !usedPlayers.has(String(g.player).toLowerCase())
  );

  if (!goblin) return null;

  return {
    name: `${size}-MAN GOBLIN-ASSISTED`,
    size,
    mode: "goblin_assisted",
    complete: true,
    warning: "Shadow-only. Goblin is a completion/stability leg, not an official +EV model play.",
    minGoblinProb: minProb,
    legs: [
      ...base,
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
        warning: "Goblin completion leg. Validate postgame before making official."
      }
    ]
  };
}

const slips = [2, 3, 4, 5, 6].map(buildSlip).filter(Boolean);

const out = {
  generatedAt: new Date().toISOString(),
  mode: "GOBLIN_ASSISTED_SHADOW_V2",
  policy: {
    liveEnabled: false,
    maxGoblinsPerSlip: 1,
    thresholds,
    reason: "Builds optional goblin-assisted 2-6 mans. Main playable slips remain unchanged."
  },
  standardLegsAvailable: standardLegs.length,
  eligibleGoblins: goblins.length,
  slips
};

fs.writeFileSync("outputs/goblin-assisted-slips.json", JSON.stringify(out, null, 2));

console.log("GOBLIN ASSISTED SLIPS V2");
console.log("========================");
console.log({ standardLegsAvailable: out.standardLegsAvailable, eligibleGoblins: out.eligibleGoblins, built: slips.length });
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
