import fs from 'fs';

const IN_PATH = 'outputs/priced-board.json';
const OUT_PATH = 'outputs/priced-board.json';

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sideOf(row) {
  return row.recommendedSide || row.side || row.pick || row.direction || null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function bucketFromProb(prob) {
  if (prob >= 0.64) return 'elite';
  if (prob >= 0.60) return 'strong';
  if (prob >= 0.56) return 'playable';
  if (prob >= 0.52) return 'lean';
  return 'pass';
}

const rows = readJson(IN_PATH, []);

let adjusted = 0;
let vegasDriven = 0;
let modelOnly = 0;
let unsupported = 0;
let skipped = 0;

const out = rows.map(row => {
  if (row.recordType !== 'merged_prop') return row;

  const side = sideOf(row);
  const modelProb = num(row.recommendedProb);
  const modelEV = num(row.expectedValue);
  const ppLine = num(row.line);
  const vegasLine = num(row.vegasLine);

  if (!side || modelProb === null) {
    skipped++;
    return row;
  }

  const vegasPickProb =
    side === 'MORE' ? num(row.vegasOverProb) :
    side === 'LESS' ? num(row.vegasUnderProb) :
    null;

  let finalProb = modelProb;
  let probabilitySource = 'model_only';

  if (row.vegasSkip === 'unsupported_market') {
    unsupported++;
    finalProb = clamp(modelProb, 0.40, 0.60);
    probabilitySource = 'unsupported_model_only';
  } else if (vegasPickProb !== null) {
    finalProb = (vegasPickProb * 0.75) + (modelProb * 0.25);
    probabilitySource = 'vegas_blend';
    vegasDriven++;
  } else {
    modelOnly++;
    finalProb = clamp(modelProb, 0.40, 0.62);
  }

  if (vegasPickProb !== null && ppLine !== null && vegasLine !== null && ppLine !== 0) {
    const rawLineEdge = (ppLine - vegasLine) / Math.abs(ppLine);
    const sideLineEdge = side === 'LESS' ? rawLineEdge : -rawLineEdge;

    let lineAdj = 0;

    if (sideLineEdge >= 0.35) lineAdj += 0.010;
    else if (sideLineEdge >= 0.20) lineAdj += 0.006;
    else if (sideLineEdge >= 0.10) lineAdj += 0.003;
    else if (sideLineEdge <= -0.35) lineAdj -= 0.015;
    else if (sideLineEdge <= -0.20) lineAdj -= 0.010;
    else if (sideLineEdge <= -0.10) lineAdj -= 0.005;

    finalProb += lineAdj;
  }

  finalProb = clamp(finalProb, 0.40, 0.68);

  const finalEV = modelEV === null
    ? null
    : Number((modelEV * (finalProb / modelProb)).toFixed(3));

  adjusted++;

  return {
    ...row,
    preVegasProb: modelProb,
    preVegasEV: modelEV,
    vegasPickProb: vegasPickProb === null ? null : Number(vegasPickProb.toFixed(3)),
    vegasDriven: vegasPickProb !== null,
    probabilitySource,
    recommendedProb: Number(finalProb.toFixed(3)),
    expectedValue: finalEV,
    confidenceBucket: bucketFromProb(finalProb),
    vegasAdjusted: true,
  };
});

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

console.log({
  recordType: 'vegas_adjust_summary',
  adjusted,
  vegasDriven,
  modelOnly,
  unsupported,
  skipped,
  saved: OUT_PATH,
});
