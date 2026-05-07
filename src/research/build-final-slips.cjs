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

function teamKey(x) {
  return String(x.team || "").toUpperCase().trim();
}

function marketFamily(x) {
  const m = String(x.market || x.stat || "").toLowerCase();

  if (["hits", "bases", "hrr", "runs", "rbis", "home_runs"].includes(m)) {
    return "hitter_counting";
  }

  if (m.includes("strikeout")) return "pitcher_k";

  return m;
}

function cleanLeg(x) {
  return {
    player: x.player,
    team: x.team,
    game: x.game || x.sportsbookGame || null,
    gamePk: x.gamePk || null,
    market: x.market,
    side: x.side,
    line: x.line,
    edge: x.sportsbookEdge,
    adjustedEdge: x.sportsbookAdjustedEdge,
    grade: x.qualityGrade,
    books: x.sportsbookBookCount,
    savant: x.savantReportGrade,
    marketSupportFlag: x.marketSupportFlag || null
  };
}

function counts(legs, x) {
  const g = gameKey(x);
  const t = teamKey(x);
  const fam = marketFamily(x);
  const market = String(x.market || x.stat || "").toLowerCase();

  return {
    sameGame: legs.filter(l => gameKey(l) === g).length,
    sameTeam: legs.filter(l => teamKey(l) === t).length,
    sameFamily: legs.filter(l => marketFamily(l) === fam).length,
    sameMarket: legs.filter(l => String(l.market || l.stat || "").toLowerCase() === market).length
  };
}

function canAddStrict(legs, x) {
  const player = normName(x.player);

  if (legs.some(l => normName(l.player) === player)) return false;

  const c = counts(legs, x);
  const fam = marketFamily(x);

  // Avoid same-game stacks in final slips.
  if (gameKey(x) && c.sameGame >= 1) return false;

  // Avoid same-team hitter stacks.
  if (teamKey(x) && c.sameTeam >= 1) return false;

  // Avoid too much of same market family.
  if (fam === "hitter_counting" && c.sameFamily >= 4) return false;
  if (fam === "pitcher_k" && c.sameFamily >= 1) return false;

  // Avoid same exact market overload.
  if (c.sameMarket >= 3) return false;

  return true;
}

function canAddBalanced(legs, x) {
  const player = normName(x.player);

  if (legs.some(l => normName(l.player) === player)) return false;

  const c = counts(legs, x);
  const fam = marketFamily(x);

  // Hard rule: no same-game stacks in final playable slips.
  if (gameKey(x) && c.sameGame >= 1) return false;

  // Hard rule: no same-team hitter stacks.
  if (teamKey(x) && c.sameTeam >= 1) return false;

  if (fam === "hitter_counting" && c.sameFamily >= 5) return false;
  if (fam === "pitcher_k" && c.sameFamily >= 1) return false;

  if (c.sameMarket >= 4) return false;

  return true;
}

function correlationLabel(legs) {
  const byGame = new Map();
  const byTeam = new Map();

  for (const l of legs) {
    const g = gameKey(l);
    const t = teamKey(l);

    if (g) byGame.set(g, (byGame.get(g) || 0) + 1);
    if (t) byTeam.set(t, (byTeam.get(t) || 0) + 1);
  }

  const maxGame = Math.max(0, ...byGame.values());
  const maxTeam = Math.max(0, ...byTeam.values());

  if (maxGame >= 3 || maxTeam >= 3) return "HIGH_CORRELATION";
  if (maxGame >= 2) return "GAME_STACK";
  if (maxTeam >= 2) return "TEAM_PAIR";

  return "OK";
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
  if (canAddStrict(finalTop, x)) finalTop.push(x);
}

const slipDefs = [
  { name: "2-MAN POWER", size: 2 },
  { name: "3-MAN FLEX", size: 3 },
  { name: "4-MAN FLEX", size: 4 },
  { name: "5-MAN FLEX", size: 5 },
  { name: "6-MAN FLEX", size: 6 }
];

const slips = slipDefs.map(def => {
  const legs = [];

  // Build from full priced pool, but use stricter rules for 2-4 and balanced rules for 5-6.
  for (const x of top) {
    if (legs.length >= def.size) break;

    const ok = def.size <= 4
      ? canAddStrict(legs, x)
      : canAddBalanced(legs, x);

    if (ok) legs.push(x);
  }

  return {
    name: def.name,
    size: def.size,
    complete: legs.length === def.size,
    green: legs.filter(x => x.qualityGrade === "GREEN").length,
    neutral: legs.filter(x => x.qualityGrade === "NEUTRAL").length,
    correlation: correlationLabel(legs),
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
  game: x.game || x.sportsbookGame || null,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: x.sportsbookEdge,
  grade: x.qualityGrade,
  books: x.sportsbookBookCount
})));

console.log("Slip correlation:");
console.table(slips.map(s => ({
  name: s.name,
  size: s.size,
  complete: s.complete,
  green: s.green,
  neutral: s.neutral,
  correlation: s.correlation
})));
