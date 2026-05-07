const fs = require("fs");

const DATE = process.argv[2] || "2026-05-04";

const TEAM_ID = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",
  116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WSH",121:"NYM",133:"ATH",134:"PIT",
  135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",
  143:"PHI",144:"ATL",145:"CWS",146:"MIA",147:"NYY",158:"MIL"
};

function normName(s) {
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[.'’\-]/g,"")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi,"")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}

function teamAbbr(t) {
  return t?.abbreviation || TEAM_ID[t?.id] || null;
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// First-pass PrizePicks-style fantasy estimate.
// We will tune this later if needed.
function hitterFantasy(b) {
  const singles = Math.max(0, num(b.hits) - num(b.doubles) - num(b.triples) - num(b.homeRuns));
  return (
    singles * 3 +
    num(b.doubles) * 6 +
    num(b.triples) * 8 +
    num(b.homeRuns) * 10 +
    num(b.rbi) * 2 +
    num(b.runs) * 2 +
    num(b.baseOnBalls) * 3 +
    num(b.stolenBases) * 5
  );
}

function pitcherFantasy(p) {
  return (
    num(p.outs) * 1 +
    num(p.strikeOuts) * 3 +
    num(p.win) * 6 -
    num(p.earnedRuns) * 3 -
    num(p.hits) * 1 -
    num(p.baseOnBalls) * 1
  );
}

async function buildActuals(date) {
  const schedule = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const games = schedule.dates?.[0]?.games || [];
  const map = new Map();

  for (const g of games) {
    const box = await getJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);

    for (const side of ["away", "home"]) {
      const team = teamAbbr(box.teams?.[side]?.team);
      const players = box.teams?.[side]?.players || {};

      for (const p of Object.values(players)) {
        const name = p.person?.fullName;
        if (!name || !team) continue;

        const batting = p.stats?.batting || {};
        const pitching = p.stats?.pitching || {};

        map.set(`${team}|${normName(name)}`, {
          hitterFantasy: hitterFantasy(batting),
          pitcherFantasy: pitcherFantasy(pitching)
        });
      }
    }
  }

  return map;
}

function sideFor(row) {
  const s = String(row.side || row.recommendedSide || row.direction || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  if (s === "MORE" || s === "LESS") return s;

  // PrizePicks raw board may not include side.
  // For research, infer side from tier:
  // goblin/demon are MORE only in your rules.
  const tier = String(row.oddsTier || row.tier || "").toLowerCase();
  if (tier === "goblin" || tier === "demon") return "MORE";

  return "";
}

function grade(actual, line, side) {
  if (!Number.isFinite(actual) || !Number.isFinite(line) || !side) return "UNGRADED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNGRADED";
}

function stat(label, arr) {
  const h = arr.filter(r=>r.result==="HIT").length;
  const m = arr.filter(r=>r.result==="MISS").length;
  const p = arr.filter(r=>r.result==="PUSH").length;
  const rate = h+m ? (h/(h+m)*100).toFixed(1)+"%" : "0.0%";
  console.log(`${label}: ${h}-${m}-${p} | graded=${h+m} | hitRate=${rate}`);
}

(async () => {
  const raw = JSON.parse(fs.readFileSync("outputs/merged-board.json","utf8"));
  const rows = Array.isArray(raw) ? raw : raw.rows || raw.data || raw.props || raw.candidates || [];

  const fantasy = rows.filter(r =>
    String(r.market || r.stat || r.statKey || "").toLowerCase().includes("fantasy")
  );

  const actuals = await buildActuals(DATE);

  const graded = fantasy.map(r => {
    const key = `${r.team}|${normName(r.player)}`;
    const a = actuals.get(key);
    const statText = String(r.stat || r.market || r.statKey || "").toLowerCase();
    const isPitcher = statText.includes("pitcher");
    const actual = a ? (isPitcher ? a.pitcherFantasy : a.hitterFantasy) : NaN;
    const side = sideFor(r);
    const line = Number(r.line);

    return {
      player: r.player,
      team: r.team,
      game: r.game,
      stat: r.stat,
      statKey: r.statKey,
      tier: r.oddsTier,
      side,
      line,
      actual,
      result: grade(actual, line, side)
    };
  });

  fs.writeFileSync("outputs/fantasy-graded.json", JSON.stringify(graded, null, 2));

  console.log(`Fantasy raw rows: ${fantasy.length}`);
  stat("FANTASY ALL", graded);
  stat("FANTASY MORE", graded.filter(r=>r.side==="MORE"));
  stat("FANTASY LESS", graded.filter(r=>r.side==="LESS"));
  stat("PITCHER FANTASY", graded.filter(r=>String(r.stat||"").toLowerCase().includes("pitcher")));
  stat("HITTER FANTASY", graded.filter(r=>String(r.stat||"").toLowerCase().includes("hitter")));

  console.log("Wrote outputs/fantasy-graded.json");
})();
