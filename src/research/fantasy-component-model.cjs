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
    null
  );
}

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return null;
  return Math.max(lo, Math.min(hi, v));
}

const out = [];

for (const [, group] of byPlayer.entries()) {
  const rows = group.rows;

  const pf = findMarket(rows, "pitcher_fantasy_score");
  const hf = findMarket(rows, "hitter_fantasy_score");

  if (pf) {
    const outs = projection(findMarket(rows, "pitching_outs"));
    const ks = projection(findMarket(rows, "strikeouts"));
    const er = projection(findMarket(rows, "earned_runs_allowed"));

    const qsProb =
      outs == null || er == null
        ? null
        : clamp(((outs - 17.5) / 4) + ((3.25 - er) / 3), 0, 1);

    const winProb = num(pf.teamWinProb ?? pf.winProb ?? pf.moneylineWinProb, 0.5);

    const base =
      (outs ?? 0) * 1 +
      (ks ?? 0) * 3 -
      (er ?? 0) * 3;

    const bonus =
      (winProb ?? 0.5) * 6 +
      (qsProb ?? 0) * 4;

    const componentProjection = base + bonus;

    out.push({
      player: group.player,
      team: pf.team,
      type: "pitcher",
      fantasyLine: num(pf.line),
      directProjection: projection(pf),
      componentProjection: Number(componentProjection.toFixed(3)),
      componentBase: Number(base.toFixed(3)),
      componentBonus: Number(bonus.toFixed(3)),
      components: {
        outs,
        strikeouts: ks,
        earnedRuns: er,
        winProb,
        qsProb
      },
      modelStatus:
        outs == null || ks == null || er == null
          ? "INCOMPLETE_COMPONENTS"
          : "COMPONENT_READY"
    });
  }

  if (hf) {
    const bases = projection(findMarket(rows, "bases"));
    const runs = projection(findMarket(rows, "runs"));
    const rbis = projection(findMarket(rows, "rbis"));
    const walks = projection(findMarket(rows, "walks"));

    const componentProjection =
      (bases ?? 0) * 2.5 +
      (runs ?? 0) * 2 +
      (rbis ?? 0) * 2 +
      (walks ?? 0) * 2;

    out.push({
      player: group.player,
      team: hf.team,
      type: "hitter",
      fantasyLine: num(hf.line),
      directProjection: projection(hf),
      componentProjection: Number(componentProjection.toFixed(3)),
      components: { bases, runs, rbis, walks },
      modelStatus:
        bases == null
          ? "INCOMPLETE_COMPONENTS"
          : "COMPONENT_READY"
    });
  }
}

writeJson("outputs/fantasy-component-model.json", out);

console.log("FANTASY COMPONENT MODEL");
console.log("=======================");
console.log({
  rows: out.length,
  pitchers: out.filter(r => r.type === "pitcher").length,
  hitters: out.filter(r => r.type === "hitter").length,
  ready: out.filter(r => r.modelStatus === "COMPONENT_READY").length
});

console.table(out.slice(0, 30).map(r => ({
  player: r.player,
  type: r.type,
  line: r.fantasyLine,
  direct: r.directProjection,
  component: r.componentProjection,
  diff: Number((num(r.componentProjection, 0) - num(r.directProjection, 0)).toFixed(3)),
  status: r.modelStatus
})));
