const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const IN = `outputs/history/${DATE}-goblin-highprob-slips-graded.json`;
const OUT = "data/learning/goblin-highprob-history.json";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function keyLeg(l) {
  return [
    String(l.player || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
    String(l.market || "").toLowerCase(),
    String(l.side || "").toUpperCase(),
    String(l.line ?? "")
  ].join("|");
}

const graded = readJson(IN, null);
if (!graded || !Array.isArray(graded.slips)) {
  console.error(`Missing graded goblin file: ${IN}`);
  process.exit(1);
}

const history = readJson(OUT, { days: [], updatedAt: null });

const legs = graded.slips.flatMap(slip => (slip.legs || []).map(l => ({
  date: DATE,
  slipName: slip.name,
  slipSize: slip.size,
  slipResult: slip.grade?.result,
  player: l.player,
  team: l.team,
  market: l.market,
  side: l.side,
  line: l.line,
  probability: l.probability,
  result: l.result,
  actual: l.actual ?? null,
  matched: !!l.matched,
  key: keyLeg(l)
})));

const day = {
  date: DATE,
  summary: graded.summary,
  slips: graded.slips.map(s => ({
    name: s.name,
    size: s.size,
    result: s.grade?.result,
    hit: s.grade?.hit || 0,
    miss: s.grade?.miss || 0,
    unmatched: s.grade?.unmatched || 0,
    teams: s.prizePicksValidation?.teams || []
  })),
  legs
};

history.days = (history.days || []).filter(d => d.date !== DATE);
history.days.push(day);
history.days.sort((a,b) => String(a.date).localeCompare(String(b.date)));
history.updatedAt = new Date().toISOString();

const allLegs = history.days.flatMap(d => d.legs || []);
const byMarket = {};
for (const l of allLegs) {
  const k = `${l.market}|${l.side}`;
  byMarket[k] ||= { total: 0, hit: 0, miss: 0, unmatched: 0 };
  byMarket[k].total++;
  if (l.result === "HIT") byMarket[k].hit++;
  else if (l.result === "MISS") byMarket[k].miss++;
  else if (l.result === "UNMATCHED") byMarket[k].unmatched++;
}
history.byMarket = byMarket;

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(history, null, 2) + "\n");

console.log({
  saved: OUT,
  days: history.days.length,
  latestDate: DATE,
  legs: legs.length,
  byMarket
});
