const fs = require("fs");

const priced = JSON.parse(fs.readFileSync("outputs/slips-priced.json", "utf8"));

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function gameKey(x) {
  return String(x.game || x.sportsbookGame || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function marketFamily(x) {
  const m = String(x.market || x.stat || "").toLowerCase();
  if (["hits", "bases", "hrr", "runs", "rbis", "home_runs"].includes(m)) return "hitter_counting";
  if (m.includes("strikeout")) return "pitcher_k";
  return m;
}

function cleanLeg(x) {
  return {
    player: x.player,
    team: x.team,
    game: x.game || x.sportsbookGame || null,
    market: x.market,
    side: x.side,
    line: x.line,
    edge: x.sportsbookEdge,
    adjustedEdge: x.sportsbookAdjustedEdge,
    grade: x.qualityGrade,
    books: x.sportsbookBookCount,
    savant: x.savantReportGrade
  };
}

function canAdd(legs, x) {
  const player = normName(x.player);
  if (legs.some(l => normName(l.player) === player)) return false;

  const sameGame = legs.filter(l => gameKey(l) === gameKey(x)).length;
  if (gameKey(x) && sameGame >= 2) return false;

  const sameTeam = legs.filter(l => String(l.team || "") === String(x.team || "")).length;
  if (sameTeam >= 2) return false;

  const fam = marketFamily(x);
  const sameFamily = legs.filter(l => marketFamily(l) === fam).length;
  if (fam === "hitter_counting" && sameFamily >= 4) return false;
  if (fam === "pitcher_k" && sameFamily >= 1) return false;

  return true;
}

const top = priced
  .filter(x =>
    x.sportsbookMatch &&
    x.qualityGrade !== "FADE" &&
    typeof x.sportsbookEdge === "number" &&
    x.sportsbookEdge > 0
  )
  .sort((a, b) =>
    (b.sportsbookAdjustedEdge ?? b.sportsbookEdge ?? -999) -
    (a.sportsbookAdjustedEdge ?? a.sportsbookEdge ?? -999)
  );

const finalTop = [];
for (const x of top) {
  if (canAdd(finalTop, x)) finalTop.push(x);
}


function canAddRelaxed(legs, x) {
  const player = normName(x.player);
  if (legs.some(y => normName(y.player) === player)) return false;

  const sameGame = legs.filter(y => gameKey(y) === gameKey(x)).length;
  if (sameGame >= 3) return false;

  const sameMarket = legs.filter(y => String(y.market || y.stat || "").toLowerCase() === String(x.market || x.stat || "").toLowerCase()).length;
  if (sameMarket >= 4) return false;

  return true;
}

const slipDefs = [
  { name: "2-MAN POWER", size: 2 },
  { name: "3-MAN FLEX", size: 3 },
  { name: "4-MAN FLEX", size: 4 },
  { name: "5-MAN FLEX", size: 5 },
  { name: "6-MAN FLEX", size: 6 }
];

const slips = slipDefs
  .map(def => {
    const legs = [];
    const pool = def.size <= 4 ? finalTop : top;
    for (const x of pool) {
      if (legs.length >= def.size) break;
      const ok = def.size <= 4 ? canAdd(legs, x) : canAddRelaxed(legs, x);
      if (ok) legs.push(x);
    }
    return {
      name: def.name,
      size: def.size,
      complete: legs.length === def.size,
      green: legs.filter(x => x.qualityGrade === "GREEN").length,
      neutral: legs.filter(x => x.qualityGrade === "NEUTRAL").length,
      legs: legs.map(cleanLeg)
    };
  });

const output = {
  generatedAt: new Date().toISOString(),
  topLegs: finalTop.map(cleanLeg),
  slips
};

fs.writeFileSync("outputs/final-slips.json", JSON.stringify(output, null, 2));

const SLATE_DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

fs.writeFileSync(`outputs/final-slips-${SLATE_DATE}.json`, JSON.stringify(output, null, 2));

console.log("Wrote outputs/final-slips.json");
console.log(`Wrote outputs/final-slips-${SLATE_DATE}.json`);
console.log("Top legs:");
console.table(finalTop.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  team: x.team,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: x.sportsbookEdge,
  grade: x.qualityGrade,
  books: x.sportsbookBookCount
})));
