import fs from 'fs';
import path from 'path';

const HISTORY_DIR = 'outputs/history';
const OUT_JSON = 'outputs/multi-day-performance.json';
const OUT_TXT = 'outputs/multi-day-performance.txt';

const DAYS = Number(process.argv[2] || 30);

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function pct(a, b) {
  if (!b) return '0.0%';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function dateFromFile(file) {
  const m = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

function bucketProb(p) {
  const x = Number(p);
  if (!Number.isFinite(x)) return 'unknown';
  if (x < 0.50) return '<50%';
  if (x < 0.55) return '50-54.9%';
  if (x < 0.60) return '55-59.9%';
  if (x < 0.65) return '60-64.9%';
  if (x < 0.70) return '65-69.9%';
  if (x < 0.75) return '70-74.9%';
  return '75%+';
}

function key(v) {
  return String(v || 'unknown').toLowerCase();
}

function initGroup() {
  return {
    legs: 0,
    graded: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    pending: 0,
    dnp: 0
  };
}

function addLeg(group, leg) {
  group.legs += 1;

  const result = String(leg.result || 'PENDING').toUpperCase();

  if (result === 'HIT') {
    group.graded += 1;
    group.hits += 1;
  } else if (result === 'MISS') {
    group.graded += 1;
    group.misses += 1;
  } else if (result === 'PUSH') {
    group.pushes += 1;
  } else {
    group.pending += 1;
  }

  if (String(leg.gradeReason || '').toLowerCase().includes('no appearance')) {
    group.dnp += 1;
  }
}

function finalizeGroup(g) {
  return {
    ...g,
    hitRate: pct(g.hits, g.graded),
    missRate: pct(g.misses, g.graded)
  };
}

function addToMap(map, mapKey, leg) {
  const k = key(mapKey);
  if (!map[k]) map[k] = initGroup();
  addLeg(map[k], leg);
}

function finalizeMap(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = finalizeGroup(v);
  }
  return out;
}

function getRecentDates(files, days) {
  const dates = [...new Set(files.map(dateFromFile).filter(Boolean))].sort();
  return dates.slice(Math.max(0, dates.length - days));
}

function loadGradedSlips(date) {
  const file = `${HISTORY_DIR}/${date}-graded-slips.json`;
  return readJson(file, []);
}

function loadClvReport(date) {
  const file = `${HISTORY_DIR}/${date}-clv-report.json`;
  return readJson(file, null);
}

if (!fs.existsSync(HISTORY_DIR)) {
  console.error(`Missing history directory: ${HISTORY_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(HISTORY_DIR);
const gradedFiles = files.filter(f => f.endsWith('-graded-slips.json'));
const dates = getRecentDates(gradedFiles, DAYS);

const summary = initGroup();
const byDate = {};
const byMarket = {};
const byTier = {};
const byConfidence = {};
const byProbabilityBucket = {};
const bySide = {};
const byTeam = {};
const byGame = {};

let totalSlips = 0;
let totalClvLegs = 0;
let positiveClv = 0;
let negativeClv = 0;
let zeroClv = 0;
let missingClvHistory = 0;

for (const date of dates) {
  const slips = loadGradedSlips(date);
  const clv = loadClvReport(date);

  totalSlips += slips.length;

  const dayGroup = initGroup();

  for (const slip of slips) {
    for (const leg of slip.legs || []) {
      addLeg(summary, leg);
      addLeg(dayGroup, leg);

      addToMap(byMarket, leg.market || leg.stat, leg);
      addToMap(byTier, leg.oddsTier || leg.tier, leg);
      addToMap(byConfidence, leg.confidenceBucket, leg);
      addToMap(byProbabilityBucket, bucketProb(leg.recommendedProb), leg);
      addToMap(bySide, leg.side || leg.recommendedSide, leg);
      addToMap(byTeam, leg.team, leg);
      addToMap(byGame, leg.game || leg.matchedGame, leg);
    }
  }

  byDate[date] = finalizeGroup(dayGroup);

  if (clv?.summary) {
    totalClvLegs += Number(clv.summary.legsAnalyzed || 0);
    positiveClv += Number(clv.summary.positiveCLV || 0);
    negativeClv += Number(clv.summary.negativeCLV || 0);
    zeroClv += Number(clv.summary.zeroCLV || 0);
    missingClvHistory += Number(clv.summary.missingHistory || 0);
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  windowDays: DAYS,
  dates,
  totalSlips,
  summary: finalizeGroup(summary),
  clv: {
    legsAnalyzed: totalClvLegs,
    positiveCLV: positiveClv,
    negativeCLV: negativeClv,
    zeroCLV: zeroClv,
    missingHistory: missingClvHistory,
    positiveRate: pct(positiveClv, totalClvLegs)
  },
  byDate,
  byMarket: finalizeMap(byMarket),
  byTier: finalizeMap(byTier),
  byConfidence: finalizeMap(byConfidence),
  byProbabilityBucket: finalizeMap(byProbabilityBucket),
  bySide: finalizeMap(bySide),
  byTeam: finalizeMap(byTeam),
  byGame: finalizeMap(byGame)
};

fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));

function section(title, obj) {
  const lines = ['', title, '-'.repeat(title.length)];
  const entries = Object.entries(obj || {})
    .sort((a, b) => (b[1].graded || 0) - (a[1].graded || 0));

  if (!entries.length) {
    lines.push('No data');
    return lines.join('\n');
  }

  for (const [k, v] of entries) {
    lines.push(
      `${k}: ${v.hits}-${v.misses}-${v.pushes} | Graded: ${v.graded} | Pending: ${v.pending} | DNP: ${v.dnp} | Hit Rate: ${v.hitRate}`
    );
  }

  return lines.join('\n');
}

const txt = [
  'MULTI-DAY PERFORMANCE ENGINE',
  `Generated: ${output.generatedAt}`,
  `Window Days: ${DAYS}`,
  `Dates: ${dates.join(', ') || 'none'}`,
  '',
  `Total Slips: ${totalSlips}`,
  `Total Legs: ${output.summary.legs}`,
  `Graded Legs: ${output.summary.graded}`,
  `Hits: ${output.summary.hits}`,
  `Misses: ${output.summary.misses}`,
  `Pushes: ${output.summary.pushes}`,
  `Pending: ${output.summary.pending}`,
  `DNP / No Appearance: ${output.summary.dnp}`,
  `Hit Rate: ${output.summary.hitRate}`,
  '',
  'CLV SUMMARY',
  '-----------',
  `CLV Legs Analyzed: ${output.clv.legsAnalyzed}`,
  `Positive CLV: ${output.clv.positiveCLV}`,
  `Negative CLV: ${output.clv.negativeCLV}`,
  `Zero CLV: ${output.clv.zeroCLV}`,
  `Missing CLV History: ${output.clv.missingHistory}`,
  `Positive CLV Rate: ${output.clv.positiveRate}`,
  section('BY DATE', output.byDate),
  section('BY MARKET', output.byMarket),
  section('BY TIER', output.byTier),
  section('BY CONFIDENCE', output.byConfidence),
  section('BY PROBABILITY BUCKET', output.byProbabilityBucket),
  section('BY SIDE', output.bySide),
  section('BY TEAM', output.byTeam),
  section('BY GAME', output.byGame),
  '',
  `Saved JSON: ${OUT_JSON}`,
  `Saved TXT: ${OUT_TXT}`
].join('\n');

fs.writeFileSync(OUT_TXT, txt);
console.log(txt);
