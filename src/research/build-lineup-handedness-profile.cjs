const fs = require("fs");

const LINEUPS = "data/context/lineups.json";
const HAND = "data/savant/handedness-splits.json";
const OUT = "data/context/lineup-handedness-profile.json";

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function playerName(x) {
  if (typeof x === "string") return x;
  return x?.player || x?.name || x?.playerName || x?.fullName || x?.person?.fullName || null;
}

function batterHand(x) {
  if (!x || typeof x === "string") return null;

  const raw = String(
    x.bats ||
    x.batterHand ||
    x.stand ||
    x.hand ||
    x.battingHand ||
    x.person?.batSide?.code ||
    x.person?.batSide?.description ||
    ""
  ).toUpperCase();

  if (raw.startsWith("L")) return "L";
  if (raw.startsWith("R")) return "R";
  if (raw.startsWith("S")) return "S";
  return null;
}

function extractTeams(lineups) {
  const teams = {};

  if (lineups?.teams && Object.keys(lineups.teams).length) {
    for (const [team, data] of Object.entries(lineups.teams)) {
      const players =
        data.players ||
        data.lineup ||
        data.batters ||
        data.expectedLineup ||
        data.startingLineup ||
        [];
      teams[String(team).toUpperCase()] = Array.isArray(players) ? players : [];
    }
  }

  if (lineups?.players && Object.keys(lineups.players).length) {
    for (const row of Object.values(lineups.players)) {
      const team = String(row.team || row.teamAbbr || row.resolvedTeam || "").toUpperCase();
      if (!team) continue;
      if (!teams[team]) teams[team] = [];
      teams[team].push(row);
    }
  }

  if (Array.isArray(lineups)) {
    for (const row of lineups) {
      const team = String(row.team || row.teamAbbr || row.resolvedTeam || "").toUpperCase();
      if (!team) continue;
      if (!teams[team]) teams[team] = [];
      teams[team].push(row);
    }
  }

  return teams;
}

function emptyGameTeams(lineups) {
  const teams = {};

  for (const g of Object.values(lineups?.games || {})) {
    const game = g.game || "";
    const parts = game.split("@").map(x => x.trim());

    for (const teamName of parts) {
      if (!teamName) continue;
      const key = teamName
        .split(/\s+/)
        .map(w => w[0])
        .join("")
        .toUpperCase();

      teams[key] = {
        team: key,
        sourceName: teamName,
        total: 0,
        knownHands: 0,
        L: 0,
        R: 0,
        S: 0,
        unknown: 0,
        leftLike: 0,
        rightLike: 0,
        leftShare: null,
        rightShare: null,
        quality: "missing",
        lineupStatus: g.lineupStatus || "UNAVAILABLE",
        note: g.note || "Lineup unavailable",
        players: []
      };
    }
  }

  return teams;
}

const lineups = read(LINEUPS, {});
const hand = read(HAND, { batters: {}, pitchers: {} });

const rawTeams = extractTeams(lineups);
let teams = {};

for (const [team, players] of Object.entries(rawTeams)) {
  let L = 0, R = 0, S = 0, unknown = 0;
  const rows = [];

  for (const p of players) {
    const name = playerName(p);
    if (!name) continue;

    const h = batterHand(p);
    if (h === "L") L++;
    else if (h === "R") R++;
    else if (h === "S") S++;
    else unknown++;

    rows.push({
      player: name,
      batterHand: h,
      hasHandednessSplits: Boolean(hand.batters?.[norm(name)]),
      lineupSlot: p.battingOrder || p.slot || p.order || null
    });
  }

  const totalKnown = L + R + S;

  teams[team] = {
    team,
    total: rows.length,
    knownHands: totalKnown,
    L,
    R,
    S,
    unknown,
    leftLike: L + S,
    rightLike: R + S,
    leftShare: totalKnown ? Number(((L + S) / totalKnown).toFixed(4)) : null,
    rightShare: totalKnown ? Number(((R + S) / totalKnown).toFixed(4)) : null,
    quality:
      totalKnown >= 8 ? "strong" :
      totalKnown >= 5 ? "usable" :
      totalKnown > 0 ? "thin" :
      "missing",
    lineupStatus: rows.length ? "AVAILABLE" : "UNAVAILABLE",
    players: rows
  };
}

if (!Object.keys(teams).length) {
  teams = emptyGameTeams(lineups);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: [LINEUPS, HAND].filter(fs.existsSync),
  teamCount: Object.keys(teams).length,
  strongTeams: Object.values(teams).filter(t => t.quality === "strong").length,
  usableTeams: Object.values(teams).filter(t => t.quality === "usable").length,
  thinTeams: Object.values(teams).filter(t => t.quality === "thin").length,
  missingTeams: Object.values(teams).filter(t => t.quality === "missing").length,
  ready: Object.values(teams).some(t => ["strong", "usable"].includes(t.quality)),
  note: "Harmless cache. If official lineups are unavailable, teams are marked missing. Once lineups populate, this automatically builds L/R/S profile.",
  teams
};

fs.mkdirSync("data/context", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("LINEUP HANDEDNESS PROFILE");
console.log("=========================");
console.log(`Teams: ${out.teamCount}`);
console.log(`Strong: ${out.strongTeams}`);
console.log(`Usable: ${out.usableTeams}`);
console.log(`Thin: ${out.thinTeams}`);
console.log(`Missing: ${out.missingTeams}`);
console.log(`Ready: ${out.ready}`);
console.log(`Wrote ${OUT}`);

console.table(Object.values(teams).slice(0, 20).map(t => ({
  team: t.team,
  total: t.total,
  known: t.knownHands,
  L: t.L,
  R: t.R,
  S: t.S,
  unknown: t.unknown,
  leftShare: t.leftShare,
  quality: t.quality,
  status: t.lineupStatus
})));
