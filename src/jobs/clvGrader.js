import fs from 'fs';
import fetch from 'node-fetch';

const INPUT = 'outputs/priced-board.json';
const HISTORY = 'outputs/history_raw.json';
const OUT = 'outputs/clv-results.json';
const REPORT = 'outputs/clv-report.txt';

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function key(r) {
  return `${r.player}|${r.stat}|${r.side}`;
}

// ---- MLB API ----
async function fetchGames(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.dates?.[0]?.games || [];
}

async function fetchBoxscore(gamePk) {
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  const res = await fetch(url);
  return await res.json();
}

// ---- Stat mapping ----
function getStat(player, market) {
  const s = player?.stats;
  if (!s) return null;

  const b = s.batting || {};
  const p = s.pitching || {};
  const m = market.toLowerCase();

  if (m.includes('bases')) {
    return (
      (b.hits || 0) +
      (b.doubles || 0) +
      (b.triples || 0) * 2 +
      (b.homeRuns || 0) * 3
    );
  }

  if (m.includes('hits+runs+rbis') || m.includes('hrr')) {
    return (b.hits || 0) + (b.runs || 0) + (b.rbi || 0);
  }

  if (m.includes('hits')) return b.hits || 0;
  if (m.includes('runs')) return b.runs || 0;
  if (m.includes('rbis')) return b.rbi || 0;

  if (m.includes('strikeouts')) return p.strikeOuts || 0;

  return null;
}

function grade(actual, line, side) {
  if (actual == null) return 'PENDING';
  if (actual === line) return 'PUSH';

  if (side === 'OVER') return actual > line ? 'HIT' : 'MISS';
  return actual < line ? 'HIT' : 'MISS';
}

// ---- Main ----
async function main() {
  if (!fs.existsSync(INPUT)) {
    console.log('No board');
    return;
  }

  const board = readJson(INPUT);
  const history = readJson(HISTORY);
  const results = readJson(OUT);

  const ts = new Date().toISOString();
  const date = ts.slice(0, 10);

  // --- Save snapshot ---
  const snapshot = board.map(r => ({
    ts,
    player: r.player,
    stat: r.stat,
    side: r.side,
    line: r.line,
    vegasLine: r.vegasLine
  }));

  history.push(...snapshot);
  writeJson(HISTORY, history);

  // --- First seen (open line) ---
  const firstSeen = {};
  for (const h of history) {
    const k = key(h);
    if (!firstSeen[k]) firstSeen[k] = h;
  }

  // --- Fetch MLB results ---
  const games = await fetchGames(date);
  const playerMap = {};

  for (const g of games) {
    const box = await fetchBoxscore(g.gamePk);

    for (const side of ['home', 'away']) {
      const players = box.teams[side].players;
      for (const id in players) {
        const p = players[id];
        playerMap[p.person.fullName] = p;
      }
    }
  }

  // --- Compute CLV + Results ---
  const rows = [];

  for (const r of board) {
    const k = key(r);
    const first = firstSeen[k];
    if (!first) continue;

    const openLine = first.vegasLine ?? first.line;
    const closeLine = r.vegasLine ?? r.line;

    if (openLine == null || closeLine == null) continue;

    let clv =
      r.side === 'OVER'
        ? closeLine - openLine
        : openLine - closeLine;

    const player = playerMap[r.player];
    const actual = getStat(player, r.stat);
    const result = grade(actual, r.line, r.side);

    rows.push({
      ts,
      player: r.player,
      stat: r.stat,
      side: r.side,
      openLine,
      closeLine,
      clv,
      actual,
      result
    });
  }

  results.push(...rows);
  writeJson(OUT, results);

  // --- Summary ---
  const graded = rows.filter(r => r.result !== 'PENDING');

  const hits = graded.filter(r => r.result === 'HIT').length;
  const total = graded.length;

  const avgClv =
    graded.reduce((a, b) => a + b.clv, 0) / (graded.length || 1);

  const report = [
    `CLV + RESULTS`,
    `Date: ${date}`,
    `Picks: ${total}`,
    `Hits: ${hits}`,
    `Hit Rate: ${(hits / (total || 1) * 100).toFixed(1)}%`,
    `Avg CLV: ${avgClv.toFixed(3)}`
  ].join('\n');

  fs.writeFileSync(REPORT, report);

  console.log(report);
}

main();
