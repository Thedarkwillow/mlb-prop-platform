const fs = require('fs');
const path = require('path');

const BOARD_PATH = path.join(__dirname, '../../outputs/prizepicks-board.json');
const HISTORY_PATH = path.join(__dirname, '../../outputs/pp_history.json');

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function loadBoard() {
  if (!fs.existsSync(BOARD_PATH)) {
    console.log('No board found');
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(BOARD_PATH, 'utf8'));
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function main() {
  const board = loadBoard();
  const history = loadHistory();

  const timestamp = new Date().toISOString();

  const snapshot = board.map(p => ({
    key: normalize(p.player) + '_' + normalize(p.statType),
    player: p.player,
    statType: p.statType,
    line: p.line,
    timestamp
  }));

  history.push({
    timestamp,
    snapshot
  });

  saveHistory(history);

  console.log(`Saved snapshot: ${snapshot.length} props`);
  console.log(`Total snapshots: ${history.length}`);
}

main();
