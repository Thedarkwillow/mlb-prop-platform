import fs from 'fs';

const INPUT = 'outputs/priced-board.json';
const HISTORY = 'outputs/pp_history.json';
const OUT = 'outputs/clv-results.json';
const REPORT = 'outputs/clv-report.txt';

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// --- KEY (critical for correct matching) ---
function key(r) {
  return [
    r.player,
    (r.stat || '').toLowerCase(),
    (r.side || '').toUpperCase(),
    (r.line ?? '').toString() // keep line bucket (goblin/demon separation)
  ].join('|');
}

// --- MAIN ---
function main() {
  if (!fs.existsSync(INPUT)) {
    console.log('No priced board');
    return;
  }

  const board = readJson(INPUT);
  const history = readJson(HISTORY);
  const results = readJson(OUT);

  const ts = new Date().toISOString();

  // --- 1. SAVE SNAPSHOT (PRIZEPICKS ONLY) ---
  const snapshot = board.map(r => ({
    ts,
    player: r.player,
    stat: (r.stat || '').toLowerCase(),
    side: (r.side || '').toUpperCase(),
    line: r.line
  }));

  history.push(...snapshot);
  writeJson(HISTORY, history);

  // --- 2. BUILD FIRST SEEN (OPEN LINE) ---
  const firstSeen = {};
  const lastSeen = {};

  for (const h of history) {
    const k = key(h);

    if (!firstSeen[k]) {
      firstSeen[k] = h;
    }

    lastSeen[k] = h; // always overwrite → latest line
  }

  // --- 3. CALCULATE CLV ---
  const rows = [];

  for (const r of board) {
    const current = {
      player: r.player,
      stat: (r.stat || '').toLowerCase(),
      side: (r.side || '').toUpperCase(),
      line: r.line
    };

    const k = key(current);

    const open = firstSeen[k];
    const latest = lastSeen[k];

    if (!open || !latest) continue;
    if (open.line == null || latest.line == null) continue;

    let clv = 0;

    // --- TRUE CLV LOGIC ---
    if (current.side === 'OVER') {
      clv = latest.line - open.line;
    } else {
      clv = open.line - latest.line;
    }

    rows.push({
      ts,
      player: current.player,
      stat: current.stat,
      side: current.side,
      openLine: open.line,
      latestLine: latest.line,
      clv
    });
  }

  results.push(...rows);
  writeJson(OUT, results);

  // --- 4. SUMMARY ---
  const valid = rows.filter(r => Number.isFinite(r.clv));

  const avgClv =
    valid.length > 0
      ? valid.reduce((a, b) => a + b.clv, 0) / valid.length
      : 0;

  const positive = valid.filter(r => r.clv > 0).length;
  const pct = valid.length > 0 ? (positive / valid.length) * 100 : 0;

  const report = [
    `CLEAN CLV TRACKER`,
    `Timestamp: ${ts}`,
    `Tracked picks: ${valid.length}`,
    `Avg CLV: ${avgClv.toFixed(3)}`,
    `Positive CLV %: ${pct.toFixed(1)}%`
  ].join('\n');

  fs.writeFileSync(REPORT, report);

  console.log(report);
}

main();
