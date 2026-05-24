const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function poissonGE1(lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  return 1 - Math.exp(-lambda);
}

const board = readJson("outputs/priced-board.json", []);
const form = readJson("data/context/player-game-log-form.json", {});
const formRows = Array.isArray(form) ? form : Object.values(form || {});
const formByPlayer = new Map();

for (const r of formRows) {
  const k = norm(r.player || r.name);
  if (k) formByPlayer.set(k, r);
}

const byPlayer = new Map();
for (const r of board) {
  const player = r.player || r.player_name;
  const k = norm(player);
  if (!k) continue;
  if (!byPlayer.has(k)) byPlayer.set(k, { player, rows: [] });
  byPlayer.get(k).rows.push(r);
}

function findMarket(rows, market) {
  return rows.find(r => String(r.market || "").toLowerCase() === market);
}

function projection(r) {
  if (!r) return null;
  return num(
    r.contextAdjustedProjection ??
    r.contextBaseProjection ??
    r.projection ??
    r.projected ??
    r.mean ??
    null
  );
}

const out = [];

for (const [, group] of byPlayer.entries()) {
  const rows = group.rows;
  const fantasy = findMarket(rows, "hitter_fantasy_score");
  if (!fantasy) continue;

  const k = norm(group.player);
  const f = formByPlayer.get(k) || {};

  const line = num(fantasy.line);
  const direct = projection(fantasy);

  const hits = projection(findMarket(rows, "hits"));
  const bases = projection(findMarket(rows, "bases"));
  const runs = projection(findMarket(rows, "runs"));
  const rbis = projection(findMarket(rows, "rbis"));
  const walks = projection(findMarket(rows, "walks"));

  const sbMarket = projection(findMarket(rows, "stolen_bases"));
  const seasonHRR = num(f.hSeasonHRR);
  const last15TB = num(f.hLast15TB);
  const last15Hits = num(f.hLast15Hits);

  // 1. Stolen base projection.
  // Conservative: use board SB if present, otherwise tiny baseline from speed-style players only.
  const stolenBases =
    sbMarket != null
      ? clamp(sbMarket, 0, 0.45)
      : 0.03;

  // 2. HR distribution proxy.
  // Estimate HR probability from excess total bases over hits and recent TB profile.
  const extraBasePower = Math.max(0, (bases ?? 0) - (hits ?? 0));
  const recentPower = last15TB != null && last15Hits != null
    ? Math.max(0, last15TB - last15Hits)
    : 0;

  const hrLambda = clamp(
    0.055 + extraBasePower * 0.11 + recentPower * 0.035,
    0.015,
    0.32
  );
  const hrProb = poissonGE1(hrLambda);

  // Split total bases into approximate event buckets.
  const singlePts = 3;
  const doublePts = 5;
  const triplePts = 8;
  const hrPts = 10;

  const hitVolume = hits ?? Math.max((bases ?? 0) / 1.6, 0);
  const expectedHR = hrProb;
  const expectedTriples = 0.01;
  const expectedDoubles = clamp(extraBasePower * 0.35, 0, 0.45);
  const expectedSingles = Math.max(0, hitVolume - expectedHR - expectedTriples - expectedDoubles);

  // 5. Correlation fix:
  // HR already creates bases + run + RBI, so do not blindly double-count.
  const hrRunRbiCredit = expectedHR * 4; // expected run + RBI points attached to HR
  const nonHrRuns = Math.max(0, (runs ?? 0) * 2 - expectedHR * 2);
  const nonHrRbis = Math.max(0, (rbis ?? 0) * 2 - expectedHR * 2);

  const component =
    expectedSingles * singlePts +
    expectedDoubles * doublePts +
    expectedTriples * triplePts +
    expectedHR * hrPts +
    nonHrRuns +
    nonHrRbis +
    (walks ?? 0) * 2 +
    stolenBases * 5 +
    hrRunRbiCredit;

  // 3. Variance model.
  const variance =
    2.5 +
    hitVolume * 5 +
    hrProb * 28 +
    stolenBases * 12 +
    Math.max(0, component - 8) * 0.8;

  const sd = Math.sqrt(variance);

  // Normal approximation for LESS/MORE probability.
  const z = line != null && sd > 0 ? (line - component) / sd : 0;
  const lessProb = clamp(0.5 + 0.1915 * z - 0.0046 * Math.pow(z, 3), 0.05, 0.95);
  const moreProb = 1 - lessProb;

  // 4. Volatility penalty.
  let volatility = "LOW";
  let penalty = 0;
  if (sd >= 5.5 || hrProb >= 0.22) {
    volatility = "HIGH";
    penalty = -0.04;
  } else if (sd >= 4.25 || hrProb >= 0.16) {
    volatility = "MEDIUM";
    penalty = -0.02;
  }

  const lessEdge = line != null ? lessProb - 0.5 + penalty : null;
  const moreEdge = line != null ? moreProb - 0.5 + penalty : null;

  out.push({
    player: group.player,
    team: fantasy.team,
    market: "hitter_fantasy_score",
    line,
    directProjection: direct,
    advancedProjection: Number(component.toFixed(3)),
    sd: Number(sd.toFixed(3)),
    volatility,
    volatilityPenalty: penalty,
    lessProb: Number(lessProb.toFixed(4)),
    moreProb: Number(moreProb.toFixed(4)),
    lessEdge: lessEdge == null ? null : Number(lessEdge.toFixed(4)),
    moreEdge: moreEdge == null ? null : Number(moreEdge.toFixed(4)),
    components: {
      hits,
      bases,
      singles: Number(expectedSingles.toFixed(3)),
      doubles: Number(expectedDoubles.toFixed(3)),
      triples: Number(expectedTriples.toFixed(3)),
      hrProb: Number(hrProb.toFixed(4)),
      runs,
      rbis,
      walks,
      stolenBases: Number(stolenBases.toFixed(3))
    },
    flags: {
      lessCandidate:
        line >= 7.5 &&
        direct != null &&
        direct > 3 &&
        component > 3 &&
        direct <= line - 0.75 &&
        component <= line - 0.75 &&
        lessProb >= 0.58,
      moreCandidate:
        false
    }
  });
}

out.sort((a, b) => (b.lessEdge ?? -9) - (a.lessEdge ?? -9));

writeJson("outputs/hitter-fantasy-advanced-model.json", out);

console.log("HITTER FANTASY ADVANCED MODEL");
console.log("=============================");
console.log({
  rows: out.length,
  lessCandidates: out.filter(r => r.flags.lessCandidate).length,
  moreCandidates: out.filter(r => r.flags.moreCandidate).length
});

console.table(out.slice(0, 30).map(r => ({
  player: r.player,
  line: r.line,
  direct: r.directProjection,
  advanced: r.advancedProjection,
  sd: r.sd,
  lessProb: r.lessProb,
  lessEdge: r.lessEdge,
  vol: r.volatility,
  less: r.flags.lessCandidate
})));
