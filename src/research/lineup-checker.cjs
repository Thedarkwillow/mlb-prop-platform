const fs = require("fs");

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const slipsRaw = JSON.parse(fs.readFileSync("outputs/slips.json", "utf8"));
const slips = slipsRaw.slips || slipsRaw;
const legs = Array.isArray(slips) ? slips.flatMap(s => s.legs || []) : [];

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function getSchedule() {
  const url = `https://statsapi.mlb.com/api/v1/schedule?date=${DATE}&hydrate=lineups,team,probablePitcher`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`schedule fetch failed ${res.status}`);
  return res.json();
}

function extractLineups(data) {
  const map = new Map();

  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      for (const side of ["away", "home"]) {
        const team = g.teams?.[side];
        const lineup = team?.lineup || [];

        lineup.forEach((p, i) => {
          const name = p.fullName || p.name || "";
          if (!name) return;
          map.set(normName(name), {
            confirmed: true,
            order: i + 1,
            side,
            team: team?.team?.abbreviation || null,
            gamePk: g.gamePk
          });
        });
      }
    }
  }

  return map;
}

(async () => {
  const data = await getSchedule();
  const lineupMap = extractLineups(data);

  let confirmed = 0;
  let unknown = 0;

  const out = legs.map(l => {
    const info = lineupMap.get(normName(l.player));

    if (info) {
      confirmed++;
      return { ...l, lineupConfirmed: true, battingOrder: info.order, lineupGrade: "ACTIVE" };
    }

    unknown++;
    return { ...l, lineupConfirmed: false, battingOrder: null, lineupGrade: "UNKNOWN" };
  });

  fs.writeFileSync("outputs/slips-lineups.json", JSON.stringify(out, null, 2));

  console.log("date:", DATE);
  console.log("legs:", legs.length);
  console.log("confirmed:", confirmed);
  console.log("unknown:", unknown);

  console.table(out.map(x => ({
    player: x.player,
    team: x.team,
    market: x.market || x.stat,
    side: x.side,
    line: x.line,
    confirmed: x.lineupConfirmed,
    order: x.battingOrder,
    grade: x.lineupGrade
  })));
})();
