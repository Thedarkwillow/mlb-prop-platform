import fs from 'fs';
import path from 'path';

const CURRENT_FILE = 'data/prizepicks-latest.json';
const HISTORY_DIR = 'history/prizepicks';
const OUT_JSON = 'outputs/clv-report.json';
const OUT_TXT = 'outputs/clv-report.txt';

function clean(v) {
  return String(v ?? '').trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getLine(row) {
  return num(row.line ?? row.projectionLine ?? row.boardLine ?? row.value);
}

function getPlayer(row) {
  return clean(row.player ?? row.playerName ?? row.name);
}

function getStat(row) {
  return clean(row.stat ?? row.market ?? row.statType);
}

function getTier(row) {
  return clean(row.oddsTier ?? row.tier ?? 'standard');
}

function getKey(row) {
  return [
    norm(getPlayer(row)),
    norm(getStat(row)),
    norm(getTier(row)),
  ].join('|');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listHistoryFiles() {
  if (!fs.existsSync(HISTORY_DIR)) return [];

  return fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(HISTORY_DIR, f))
    .sort();
}

function loadRows(file) {
  const raw = readJson(file);
  return Array.isArray(raw) ? raw : [];
}

function main() {
  if (!fs.existsSync(CURRENT_FILE)) {
    throw new Error(`Missing ${CURRENT_FILE}`);
  }

  const historyFiles = listHistoryFiles();
  const currentRows = loadRows(CURRENT_FILE);

  const firstSeen = new Map();

  for (const file of historyFiles) {
    const rows = loadRows(file);

    for (const row of rows) {
      const key = getKey(row);
      const line = getLine(row);

      if (!key || line === null) continue;

      if (!firstSeen.has(key)) {
        firstSeen.set(key, {
          file,
          player: getPlayer(row),
          stat: getStat(row),
          oddsTier: getTier(row),
          openingLine: line,
        });
      }
    }
  }

  const movements = [];

  for (const row of currentRows) {
    const key = getKey(row);
    const currentLine = getLine(row);
    const opening = firstSeen.get(key);

    if (!opening || currentLine === null) continue;

    const lineMove = currentLine - opening.openingLine;

    movements.push({
      recordType: 'clv_line_movement',
      player: getPlayer(row),
      stat: getStat(row),
      oddsTier: getTier(row),
      openingLine: opening.openingLine,
      currentLine,
      lineMove,
      absMove: Math.abs(lineMove),
      direction:
        lineMove > 0 ? 'line_up' :
        lineMove < 0 ? 'line_down' :
        'unchanged',
      openingSnapshot: opening.file,
      checkedAt: new Date().toISOString(),
    });
  }

  movements.sort((a, b) => b.absMove - a.absMove);

  const summary = {
    recordType: 'clv_summary',
    createdAt: new Date().toISOString(),
    historyFiles: historyFiles.length,
    currentRows: currentRows.length,
    trackedRows: movements.length,
    movedRows: movements.filter(r => r.lineMove !== 0).length,
    lineUp: movements.filter(r => r.lineMove > 0).length,
    lineDown: movements.filter(r => r.lineMove < 0).length,
    avgAbsMove: movements.length
      ? Number((movements.reduce((s, r) => s + r.absMove, 0) / movements.length).toFixed(3))
      : 0,
  };

  fs.mkdirSync('outputs', { recursive: true });

  fs.writeFileSync(OUT_JSON, JSON.stringify([summary, ...movements], null, 2));

  const top = movements.slice(0, 40);

  const txt = [
    'MLB CLV / LINE MOVEMENT REPORT',
    `Generated: ${summary.createdAt}`,
    '',
    `Tracked rows: ${summary.trackedRows}`,
    `Moved rows: ${summary.movedRows}`,
    `Line up: ${summary.lineUp}`,
    `Line down: ${summary.lineDown}`,
    `Avg abs move: ${summary.avgAbsMove}`,
    '',
    'TOP MOVES',
    '',
    ...top.map((r, i) =>
      `${i + 1}. ${r.player} — ${r.stat} (${r.oddsTier})
   Open: ${r.openingLine} | Current: ${r.currentLine} | Move: ${r.lineMove > 0 ? '+' : ''}${r.lineMove}`
    ),
    '',
  ].join('\n');

  fs.writeFileSync(OUT_TXT, txt);

  console.log(summary);
  console.log(`Saved ${OUT_JSON}`);
  console.log(`Saved ${OUT_TXT}`);
}

main();
