// src/utils/canonical-game-key.js

const TEAM_ALIASES = {
  ARI: "ARI", ATL: "ATL", BAL: "BAL", BOS: "BOS", CHC: "CHC", CWS: "CWS",
  CIN: "CIN", CLE: "CLE", COL: "COL", DET: "DET", HOU: "HOU", KC: "KC",
  LAA: "LAA", LAD: "LAD", MIA: "MIA", MIL: "MIL", MIN: "MIN", NYM: "NYM",
  NYY: "NYY", ATH: "ATH", OAK: "ATH", PHI: "PHI", PIT: "PIT", SD: "SD",
  SEA: "SEA", SF: "SF", STL: "STL", TB: "TB", TEX: "TEX", TOR: "TOR",
  WSH: "WSH", WAS: "WSH"
};

export function normTeam(t) {
  if (!t) return null;
  const x = String(t).trim().toUpperCase();
  return TEAM_ALIASES[x] || x;
}

export function parseGameKey(raw) {
  if (!raw) return null;

  const text = String(raw).trim().toUpperCase();
  const m = text.match(/\b([A-Z]{2,3})\s*@\s*([A-Z]{2,3})\b/);

  if (!m) return null;

  const away = normTeam(m[1]);
  const home = normTeam(m[2]);

  if (!away || !home || away === "NULL" || home === "NULL") return null;

  return { away, home, key: `${away} @ ${home}` };
}

export function canonicalGameKey(row = {}) {
  const existing =
    row.canonicalGameKey ||
    row.gameKey ||
    row.game ||
    row.matchup ||
    row.event ||
    row.prizepicksGame ||
    row.ballparkGame;

  const parsed = parseGameKey(existing);
  if (parsed) return parsed.key;

  const away =
    normTeam(row.awayTeam) ||
    normTeam(row.away) ||
    normTeam(row.opponentAway);

  const home =
    normTeam(row.homeTeam) ||
    normTeam(row.home) ||
    normTeam(row.opponentHome);

  if (away && home && away !== "NULL" && home !== "NULL") {
    return `${away} @ ${home}`;
  }

  return null;
}

export function isValidCanonicalGameKey(key) {
  if (!key) return false;
  if (String(key).toLowerCase().includes("null")) return false;
  return /^[A-Z]{2,3} @ [A-Z]{2,3}$/.test(String(key).trim());
}

export function isValidHrrRow(row = {}) {
  const market = String(row.market || row.stat || "").toUpperCase();
  const direction = String(row.direction || row.side || "").toUpperCase();
  const line = Number(row.line);
  const prob = Number(row.prob ?? row.probability ?? row.recommendedProb);
  const ev = Number(row.ev ?? row.expectedValue);
  const key = canonicalGameKey(row);

  return (
    market === "HRR" &&
    row.player &&
    row.team &&
    isValidCanonicalGameKey(key) &&
    Number.isFinite(line) &&
    Number.isFinite(prob) &&
    Number.isFinite(ev) &&
    prob > 0 &&
    ev > 0 &&
    ["MORE", "LESS", "OVER", "UNDER"].includes(direction)
  );
}
