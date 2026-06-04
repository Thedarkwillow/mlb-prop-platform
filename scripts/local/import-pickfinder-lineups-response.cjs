const fs = require("fs");

const IN_FILE = "data/private/pickfinder-lineups-response.json";
const OUT_FILE = "data/context/pickfinder-lineups.json";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("PICKFINDER LINEUP IMPORT FAILED");
    console.error("==============================");
    console.error(`file=${file}`);
    console.error(`error=${err.message}`);
    console.error("");
    console.error("This file must be raw JSON from Chrome Network -> Response, not Preview text.");
    process.exit(1);
  }
}

function val(...xs) {
  for (const x of xs) {
    if (x !== undefined && x !== null && x !== "") return x;
  }
  return null;
}

function collectBatters(batters) {
  const out = [];
  if (!batters || typeof batters !== "object") return out;

  for (const [slot, b] of Object.entries(batters)) {
    if (!b || typeof b !== "object") continue;
    out.push({
      slot,
      pickfinderId: val(b.id),
      srId: val(b.srId),
      mlbId: val(b.mlbId),
      espnId: val(b.espnId),
      fullName: val(b.fullName, b.name),
      name: val(b.name, b.fullName),
      hand: val(b.hand, b.batHand),
      position: val(b.position, b.primaryPosition),
      battingOrder: val(b.battingOrder, b.order, b.lineupOrder),
      team: b.team ? {
        srId: val(b.team.srId),
        abbreviation: val(b.team.abbreviation),
        displayName: val(b.team.displayName),
        isHome: val(b.team.isHome)
      } : null
    });
  }

  return out;
}

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Missing ${IN_FILE}`);
    console.error("Paste the real PickFinder Network -> Response JSON there first.");
    process.exit(1);
  }

  const raw = readJson(IN_FILE);
  const teams = [];

  for (const [teamSrId, teamData] of Object.entries(raw || {})) {
    const pitcher = teamData?.pitcher || null;
    const batters = collectBatters(teamData?.batters || {});
    const team =
      pitcher?.team ||
      batters.find(x => x.team)?.team ||
      {};

    teams.push({
      teamSrId,
      abbreviation: val(team.abbreviation),
      displayName: val(team.displayName),
      isHome: val(team.isHome),
      pitcher: pitcher ? {
        pickfinderId: val(pitcher.id),
        srId: val(pitcher.srId),
        mlbId: val(pitcher.mlbId),
        espnId: val(pitcher.espnId),
        fullName: val(pitcher.fullName, pitcher.name),
        name: val(pitcher.name, pitcher.fullName),
        hand: val(pitcher.hand),
        image: val(pitcher.image)
      } : null,
      batters
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "PickFinder /api/mlb/matches/:matchId/lineups response",
    inputFile: IN_FILE,
    teamCount: teams.length,
    playerCount: teams.reduce((n, t) => n + (t.pitcher ? 1 : 0) + t.batters.length, 0),
    teams
  };

  fs.mkdirSync("data/context", { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");

  console.log("PICKFINDER LINEUP IMPORT OK");
  console.log("===========================");
  console.log(`teams=${out.teamCount}`);
  console.log(`players=${out.playerCount}`);
  console.log(`saved=${OUT_FILE}`);

  for (const t of teams) {
    console.log("");
    console.log(`${t.abbreviation || t.teamSrId} | ${t.displayName || ""}`);
    console.log(`pitcher=${t.pitcher?.fullName || t.pitcher?.name || "none"} | hand=${t.pitcher?.hand || "n/a"} | mlbId=${t.pitcher?.mlbId || "n/a"}`);
    console.log(`batters=${t.batters.length}`);
  }
}

main();
