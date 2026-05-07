const fs = require("fs");

const slipsRaw = JSON.parse(fs.readFileSync("outputs/slips.json", "utf8"));
const savantRaw = JSON.parse(fs.readFileSync("data/savant-latest.json", "utf8"));

const slips = slipsRaw.slips || slipsRaw;
const legs = Array.isArray(slips) ? slips.flatMap(s => s.legs || []) : [];

const savantRows = Array.isArray(savantRaw)
  ? savantRaw
  : [...(savantRaw.batters || []), ...(savantRaw.pitchers || [])];

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function displayName(r) {
  const raw = r["last_name, first_name"] || r.player_name || r.name || r.player || "";
  const txt = String(raw);
  if (txt.includes(",")) {
    const [last, first] = txt.split(",").map(x => x.trim());
    return `${first} ${last}`;
  }
  return txt;
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function gradeBatter(row) {
  if (!row) return "UNKNOWN";
  let score = 0;
  if (n(row.xba) >= 0.270) score++;
  if (n(row.xwoba) >= 0.340) score++;
  if (n(row.hard_hit_percent) >= 42) score++;
  if (n(row.k_percent) <= 23) score++;
  if (score >= 3) return "BOOST";
  if (score >= 2) return "OK";
  return "DOWNGRADE";
}

const batterMap = new Map();
for (const r of savantRows) {
  const name = displayName(r);
  if (name) batterMap.set(normName(name), r);
}

const out = legs.map(l => {
  const hit = batterMap.get(normName(l.player));
  return {
    ...l,
    savantMatchedReport: !!hit,
    savantGradeReport: gradeBatter(hit),
    savantXba: n(hit?.xba),
    savantXwoba: n(hit?.xwoba),
    savantHardHit: n(hit?.hard_hit_percent),
    savantKPercent: n(hit?.k_percent)
  };
});

fs.writeFileSync("outputs/slips-savant.json", JSON.stringify(out, null, 2));

console.log("savant rows:", savantRows.length);
console.log("legs:", legs.length);
console.log("matched:", out.filter(x => x.savantMatchedReport).length);
console.log("unknown:", out.filter(x => !x.savantMatchedReport).length);

console.table(out.map(x => ({
  player: x.player,
  team: x.team,
  grade: x.savantGradeReport,
  xba: x.savantXba,
  xwoba: x.savantXwoba,
  hardHit: x.savantHardHit,
  kPct: x.savantKPercent
})));
