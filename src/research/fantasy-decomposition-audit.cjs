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

const board = readJson("outputs/priced-board.json", []);
const priced = readJson("outputs/sportsbook-enriched-board.json", []);

const byPlayer = new Map();

for (const r of board) {
  const player = r.player || r.player_name;
  const key = norm(player);
  if (!key) continue;
  if (!byPlayer.has(key)) byPlayer.set(key, { player, rows: [] });
  byPlayer.get(key).rows.push(r);
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
    r.line
  );
}

const out = [];

for (const [key, group] of byPlayer.entries()) {
  const rows = group.rows;

  const pitcherFantasy = findMarket(rows, "pitcher_fantasy_score");
  const hitterFantasy = findMarket(rows, "hitter_fantasy_score");

  if (pitcherFantasy) {
    const outs = projection(findMarket(rows, "pitching_outs"));
    const ks = projection(findMarket(rows, "strikeouts"));
    const er = projection(findMarket(rows, "earned_runs_allowed"));

    const componentScore =
      (outs ?? 0) * 1 +
      (ks ?? 0) * 3 -
      (er ?? 0) * 3;

    out.push({
      player: group.player,
      team: pitcherFantasy.team,
      type: "pitcher",
      fantasyLine: pitcherFantasy.line,
      directProjection: projection(pitcherFantasy),
      componentProjection: Number(componentScore.toFixed(3)),
      components: { outs, strikeouts: ks, earnedRuns: er },
      notes: [
        "Win and quality-start bonuses not included yet",
        "This is conservative base component score"
      ]
    });
  }

  if (hitterFantasy) {
    const hits = projection(findMarket(rows, "hits"));
    const bases = projection(findMarket(rows, "bases"));
    const runs = projection(findMarket(rows, "runs"));
    const rbis = projection(findMarket(rows, "rbis"));
    const walks = projection(findMarket(rows, "walks"));

    const componentScore =
      (bases ?? 0) * 2.5 +
      (runs ?? 0) * 2 +
      (rbis ?? 0) * 2 +
      (walks ?? 0) * 2;

    out.push({
      player: group.player,
      team: hitterFantasy.team,
      type: "hitter",
      fantasyLine: hitterFantasy.line,
      directProjection: projection(hitterFantasy),
      componentProjection: Number(componentScore.toFixed(3)),
      components: { hits, bases, runs, rbis, walks },
      notes: [
        "Component model approximates fantasy from available board markets",
        "Needs singles/doubles/triples/HR split later"
      ]
    });
  }
}

writeJson("outputs/fantasy-decomposition.json", out);

console.log("FANTASY DECOMPOSITION AUDIT");
console.log("===========================");
console.log({ rows: out.length });
console.table(out.slice(0, 25).map(r => ({
  player: r.player,
  type: r.type,
  line: r.fantasyLine,
  direct: r.directProjection,
  component: r.componentProjection,
  diff: Number((num(r.componentProjection,0) - num(r.directProjection,0)).toFixed(3))
})));
