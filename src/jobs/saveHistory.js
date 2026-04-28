import fs from 'fs';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyIfExists(src, destDir, prefix) {
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(destDir, { recursive: true });

  const dest = `${destDir}/${prefix}-${stamp()}.json`;
  fs.copyFileSync(src, dest);

  console.log(`Saved ${dest}`);
}

copyIfExists('data/prizepicks-latest.json', 'history/prizepicks', 'prizepicks');
copyIfExists('data/ballpark-latest.json', 'history/ballpark', 'ballpark');
copyIfExists('outputs/merged-board.json', 'history/merged', 'merged');
copyIfExists('outputs/slips.json', 'history/slips', 'slips');
