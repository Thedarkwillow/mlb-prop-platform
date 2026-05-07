import fs from 'fs';

const BOARD = 'outputs/priced-board.json';
const OUT_JSON = 'outputs/top-plays-engine.json';
const OUT_TXT = 'outputs/top-plays-engine.txt';

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function side(r) {
  return r.recommendedSide || r.side || r.pick || r.direction || '';
}

function gameValid(r) {
  if (!r.game || !r.team) return false;
  if (String(r.game).includes('null')) return false;
  return String(r.game).includes(r.team);
}

function market(r) {
  return String(r.market || r.stat || '').toLowerCase();
}

function tier(r) {
  if (r.confidenceBucket) return r.confidenceBucket;
  if (n(r.recommendedProb) >= 0.70 && n(r.expectedValue) >= 1.25) return 'elite';
  if (n(r.recommendedProb) >= 0.65 && n(r.expectedValue) >= 1.15) return 'strong';
  if (n(r.recommendedProb) >= 0.60) return 'playable';
  return 'pass';
}

function score(r) {
  return (
    n(r.expectedValue) * 2 +
    n(r.recommendedProb) +
    n(r.vegasPickProb) +
    (r.vegasDriven ? 0.05 : 0) +
    (r.savantMatched ? 0.025 : 0) +
    n(r.savantBoost)
  );
}

function playable(r) {
  const m = market(r);

  if (r.recordType !== 'merged_prop') return false;
  if (!r.player || !r.team || !r.game || !r.stat || !side(r)) return false;
  if (!gameValid(r)) return false;
  if (r.rankEligible === false) return false;
  if (String(r.pricingStatus || '').toUpperCase() === 'UNPRICED') return false;
  if (m.includes('fantasy')) return false;
  if (r.oddsTier === 'goblin') return false;

  return n(r.recommendedProb) >= 0.60 && n(r.expectedValue) >= 1.10;
}

function clean(r, rank) {
  return {
    rank,
    player: r.player,
    team: r.team,
    game: r.game,
    market: r.market,
    stat: r.stat,
    side: side(r),
    line: r.line,
    projection: r.projection,
    recommendedProb: n(r.recommendedProb),
    expectedValue: n(r.expectedValue),
    vegasDriven: !!r.vegasDriven,
    vegasLine: r.vegasLine ?? null,
    vegasPickProb: r.vegasPickProb ?? null,
    oddsTier: r.oddsTier,
    confidenceBucket: tier(r),
    savantMatched: !!r.savantMatched,
    savantBoost: r.savantBoost ?? 0,
    score: Number(score(r).toFixed(4)),
    explanation: explain(r)
  };
}

function explain(r) {
  const parts = [];

  if (r.vegasDriven) parts.push('Vegas-backed');
  if (r.savantMatched) parts.push('Savant match');
  if (n(r.expectedValue) >= 1.30) parts.push('high EV');
  if (n(r.recommendedProb) >= 0.70) parts.push('high probability');
  if (r.oddsTier === 'demon') parts.push('demon payout');

  return parts.join(' + ') || 'model-qualified';
}

function section(title, rows) {
  const lines = [`\n${title}`, '-'.repeat(title.length)];

  rows.forEach(r => {
    lines.push(
      `${r.rank}. ${r.player} — ${r.stat} ${r.side} ${r.line}`,
      `   ${r.team} | ${r.game}`,
      `   Prob: ${(r.recommendedProb * 100).toFixed(1)}% | EV: ${r.expectedValue.toFixed(3)} | Tier: ${r.oddsTier}`,
      `   Vegas: ${r.vegasDriven ? 'YES' : 'NO'} | Savant: ${r.savantMatched ? 'YES' : 'NO'}`,
      `   Why: ${r.explanation}`
    );
  });

  return lines.join('\n');
}

function main() {
  const board = read(BOARD, []);

  const rows = board
    .filter(playable)
    .sort((a, b) => score(b) - score(a))
    .map((r, i) => clean(r, i + 1));

  const top = rows.slice(0, 30);
  const safe = rows
    .filter(r => r.recommendedProb >= 0.70 && r.oddsTier !== 'demon')
    .slice(0, 20);

  const demons = rows
    .filter(r => r.oddsTier === 'demon')
    .slice(0, 20);

  const hitters = rows
    .filter(r => !String(r.market).includes('strikeout') && !String(r.market).includes('outs'))
    .slice(0, 20);

  const pitchers = rows
    .filter(r => String(r.market).includes('strikeout') || String(r.market).includes('outs'))
    .slice(0, 20);

  const output = {
    createdAt: new Date().toISOString(),
    totalPlayable: rows.length,
    top,
    safe,
    demons,
    hitters,
    pitchers
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));

  const report = [
    'PHASE 6 TOP PLAYS ENGINE',
    `Generated: ${output.createdAt}`,
    `Playable rows: ${rows.length}`,
    section('TOP 30 PLAYS', top),
    section('SAFE PLAYS', safe),
    section('DEMON VALUE', demons),
    section('HITTER PLAYS', hitters),
    section('PITCHER PLAYS', pitchers)
  ].join('\n');

  fs.writeFileSync(OUT_TXT, report);
  console.log(report);
}

main();
