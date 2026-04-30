import fs from 'fs';

// --- FILES ---
const SLIPS = 'outputs/slips.json';
const HISTORY = 'outputs/pp_history.json';
const RESULTS = 'outputs/graded_results.json';
const REPORT = 'outputs/performance-report.txt';

// --- HELPERS ---
function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function write(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function key(r) {
  return [
    r.player,
    (r.stat || '').toLowerCase(),
    (r.side || '').toUpperCase()
  ].join('|');
}

// --- MAP STAT FROM MLB BOX (adjust if needed) ---
function getStatValue(playerStats, stat) {
  if (!playerStats) return null;

  switch (stat) {
    case 'strikeouts': return playerStats.strikeOuts;
    case 'hits': return playerStats.hits;
    case 'bases': return playerStats.totalBases;
    case 'runs': return playerStats.runs;
    case 'rbis': return playerStats.rbi;
    case 'hrr': return (playerStats.hits || 0) + (playerStats.runs || 0) + (playerStats.rbi || 0);
    default: return null;
  }
}

// --- MAIN ---
function main() {
  const slips = read(SLIPS);
  const history = read(HISTORY);
  const graded = read(RESULTS);

  // --- BUILD LATEST MARKET ---
  const latestMap = {};
  for (const h of history) {
    latestMap[key(h)] = h;
  }

  const rows = [];

  for (const slip of slips) {
    for (const leg of slip.legs || []) {

      const k = key(leg);
      const latest = latestMap[k];

      if (!latest) continue;

      const openLine = Number(leg.line);
      const closeLine = Number(latest.line);

      // --- PREVENT FAKE CLV ---
      if (Math.abs(closeLine - openLine) > 1.5) continue;

      let clv = 0;
      if (leg.side === 'OVER') {
        clv = closeLine - openLine;
      } else {
        clv = openLine - closeLine;
      }

      // --- RESULT (REQUIRES stats injected earlier) ---
      const actual = leg.actual ?? null;

      let result = 'PENDING';

      if (actual !== null) {
        if (actual === openLine) result = 'PUSH';
        else if (leg.side === 'OVER') {
          result = actual > openLine ? 'HIT' : 'MISS';
        } else {
          result = actual < openLine ? 'HIT' : 'MISS';
        }
      }

      rows.push({
        player: leg.player,
        stat: leg.stat,
        side: leg.side,
        openLine,
        closeLine,
        clv,
        actual,
        result
      });
    }
  }

  write(RESULTS, rows);

  // --- SUMMARY ---
  const gradedRows = rows.filter(r => r.result !== 'PENDING');

  const hitRate =
    gradedRows.length > 0
      ? gradedRows.filter(r => r.result === 'HIT').length / gradedRows.length
      : 0;

  const avgClv =
    rows.length > 0
      ? rows.reduce((a, b) => a + b.clv, 0) / rows.length
      : 0;

  const positiveClv =
    rows.length > 0
      ? rows.filter(r => r.clv > 0).length / rows.length
      : 0;

  const report = [
    `CLV + GRADING REPORT`,
    `Legs: ${rows.length}`,
    `Graded: ${gradedRows.length}`,
    `Hit Rate: ${(hitRate * 100).toFixed(1)}%`,
    `Avg CLV: ${avgClv.toFixed(3)}`,
    `Positive CLV: ${(positiveClv * 100).toFixed(1)}%`
  ].join('\n');

  fs.writeFileSync(REPORT, report);

  console.log(report);
}

main();
