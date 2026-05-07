import fs from 'fs';

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

const IN = `outputs/history/${DATE}-graded-slips.json`;
const OUT_TXT = `outputs/history/${DATE}-performance-breakdown.txt`;
const OUT_JSON = `outputs/history/${DATE}-performance-breakdown.json`;

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pct(hit, graded) {
  return graded ? `${((hit / graded) * 100).toFixed(1)}%` : '0.0%';
}

function bucketProb(p) {
  const x = n(p);
  if (x >= 0.75) return '75%+';
  if (x >= 0.70) return '70-74.9%';
  if (x >= 0.65) return '65-69.9%';
  if (x >= 0.60) return '60-64.9%';
  return '<60%';
}

function bucketEV(ev) {
  const x = n(ev);
  if (x >= 1.40) return '1.40+';
  if (x >= 1.30) return '1.30-1.39';
  if (x >= 1.20) return '1.20-1.29';
  if (x >= 1.10) return '1.10-1.19';
  return '<1.10';
}

function key(v) {
  return String(v || 'unknown').toLowerCase();
}

function display(v) {
  return String(v || 'unknown');
}

function gradeRows(legs) {
  return legs.filter(x => ['HIT', 'MISS', 'PUSH'].includes(String(x.result || '').toUpperCase()));
}

function summarize(rows, groupFn) {
  const map = new Map();

  for (const r of rows) {
    const k = groupFn(r);
    if (!map.has(k)) {
      map.set(k, {
        key: k,
        graded: 0,
        hits: 0,
        misses: 0,
        pushes: 0,
        hitRate: '0.0%'
      });
    }

    const o = map.get(k);
    const result = String(r.result || '').toUpperCase();

    if (result === 'PUSH') {
      o.pushes++;
      continue;
    }

    o.graded++;

    if (result === 'HIT') o.hits++;
    if (result === 'MISS') o.misses++;
  }

  return [...map.values()]
    .map(x => ({
      ...x,
      hitRate: pct(x.hits, x.graded)
    }))
    .sort((a, b) => b.graded - a.graded || b.hits - a.hits);
}

function section(title, rows) {
  const lines = ['', title, '-'.repeat(title.length)];

  if (!rows.length) {
    lines.push('No data.');
    return lines.join('\n');
  }

  for (const r of rows) {
    lines.push(
      `${r.key}: ${r.hits}-${r.misses}-${r.pushes} | Graded: ${r.graded} | Hit Rate: ${r.hitRate}`
    );
  }

  return lines.join('\n');
}

function main() {
  const slips = read(IN, []);
  const legs = slips.flatMap(s => s.legs || []);
  const graded = gradeRows(legs);

  const hits = graded.filter(x => x.result === 'HIT').length;
  const misses = graded.filter(x => x.result === 'MISS').length;
  const pushes = graded.filter(x => x.result === 'PUSH').length;
  const gradedNoPush = graded.filter(x => x.result !== 'PUSH').length;

  const dnpLegs = graded.filter(x =>
    String(x.gradeReason || '').toLowerCase().includes('no appearance')
  );

  const trueStatLegs = graded.filter(x =>
    !String(x.gradeReason || '').toLowerCase().includes('no appearance')
  );

  const trueStatHits = trueStatLegs.filter(x => x.result === 'HIT').length;
  const trueStatMisses = trueStatLegs.filter(x => x.result === 'MISS').length;
  const trueStatPushes = trueStatLegs.filter(x => x.result === 'PUSH').length;
  const trueStatGraded = trueStatLegs.filter(x => x.result !== 'PUSH').length;

  const byMarket = summarize(graded, x => display(x.market || x.stat));
  const byProb = summarize(graded, x => bucketProb(x.recommendedProb));
  const byEV = summarize(graded, x => bucketEV(x.expectedValue));
  const byTier = summarize(graded, x => display(x.oddsTier));
  const byConfidence = summarize(graded, x => display(x.confidenceBucket));
  const byVegas = summarize(graded, x => x.vegasDriven ? 'vegas-backed' : 'non-vegas');
  const bySavant = summarize(graded, x => x.savantMatched ? 'savant-backed' : 'non-savant');
  const bySide = summarize(graded, x => display(x.side || x.recommendedSide));
  const byTeam = summarize(graded, x => display(x.team));
  const byGame = summarize(graded, x => display(x.matchedGame || x.game));
  const byPlayer = summarize(graded, x => display(x.player)).filter(x => x.graded >= 2);

  const missesList = graded
    .filter(x => x.result === 'MISS')
    .map(x => ({
      player: x.player,
      team: x.team,
      game: x.matchedGame || x.game,
      market: x.market,
      stat: x.stat,
      side: x.side || x.recommendedSide,
      line: x.line,
      actual: x.actual,
      prob: x.recommendedProb,
      ev: x.expectedValue,
      tier: x.oddsTier
    }));

  const output = {
    date: DATE,
    createdAt: new Date().toISOString(),
    summary: {
      slips: slips.length,
      totalLegs: legs.length,
      graded: gradedNoPush,
      hits,
      misses,
      pushes,
      hitRate: pct(hits, gradedNoPush),
      dnpTreatedAsZero: dnpLegs.length,
      trueStatGraded,
      trueStatHits,
      trueStatMisses,
      trueStatPushes,
      trueStatHitRate: pct(trueStatHits, trueStatGraded)
    },
    byMarket,
    byProb,
    byEV,
    byTier,
    byConfidence,
    byVegas,
    bySavant,
    bySide,
    byTeam,
    byGame,
    byPlayer,
    dnpTreatedAsZero: dnpLegs.map(x => ({
      player: x.player,
      team: x.team,
      game: x.matchedGame || x.game,
      market: x.market,
      stat: x.stat,
      side: x.side || x.recommendedSide,
      line: x.line,
      actual: x.actual,
      result: x.result,
      gradeReason: x.gradeReason
    })),
    misses: missesList
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));

  const report = [
    'PERFORMANCE BREAKDOWN ENGINE',
    `Date: ${DATE}`,
    `Generated: ${output.createdAt}`,
    '',
    `Slips: ${output.summary.slips}`,
    `Total Legs: ${output.summary.totalLegs}`,
    `Graded Legs: ${output.summary.graded}`,
    `Hits: ${hits}`,
    `Misses: ${misses}`,
    `Pushes: ${pushes}`,
    `Hit Rate: ${output.summary.hitRate}`,
    `DNP / No Appearance Treated As 0: ${output.summary.dnpTreatedAsZero}`,
    `True Stat Legs: ${output.summary.trueStatGraded}`,
    `True Stat Hits: ${output.summary.trueStatHits}`,
    `True Stat Misses: ${output.summary.trueStatMisses}`,
    `True Stat Hit Rate: ${output.summary.trueStatHitRate}`,
    section('BY MARKET', byMarket),
    section('BY PROBABILITY BUCKET', byProb),
    section('BY EV BUCKET', byEV),
    section('BY ODDS TIER', byTier),
    section('BY CONFIDENCE', byConfidence),
    section('BY VEGAS', byVegas),
    section('BY SAVANT', bySavant),
    section('BY SIDE', bySide),
    section('BY TEAM', byTeam),
    section('BY GAME', byGame),
    section('REPEATED PLAYERS', byPlayer),
    '',
    'DNP / NO APPEARANCE TREATED AS 0',
    '--------------------------------',
    ...output.dnpTreatedAsZero.map(x =>
      `${x.player} | ${x.team} | ${x.game} | ${x.stat || x.market} ${x.side} ${x.line} | Actual: ${x.actual} | Result: ${x.result} | ${x.gradeReason}`
    ),
    '',
    'MISSES',
    '------',
    ...missesList.map(x =>
      `${x.player} | ${x.team} | ${x.game} | ${x.stat || x.market} ${x.side} ${x.line} | Actual: ${x.actual} | Prob: ${n(x.prob).toFixed(3)} | EV: ${n(x.ev).toFixed(3)} | Tier: ${x.tier}`
    ),
    '',
    `Saved JSON: ${OUT_JSON}`,
    `Saved TXT: ${OUT_TXT}`
  ].join('\n');

  fs.writeFileSync(OUT_TXT, report);
  console.log(report);
}

main();
