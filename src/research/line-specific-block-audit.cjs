const fs = require("fs");
const path = require("path");

const date = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const INPUTS = [
  "outputs/blocked-final-candidates.json",
  "outputs/final-slips.json",
  `outputs/final-slips-${date}.json`
];

const OUT = `outputs/line-specific-block-audit-${date}.json`;
const LATEST = "outputs/line-specific-block-audit-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function asRows(x) {
  if (Array.isArray(x)) return x;
  const rows = [];
  if (Array.isArray(x?.topLegs)) rows.push(...x.topLegs);
  if (Array.isArray(x?.blockedCandidates)) rows.push(...x.blockedCandidates);
  if (Array.isArray(x?.candidates)) rows.push(...x.candidates);
  if (Array.isArray(x?.rows)) rows.push(...x.rows);
  if (Array.isArray(x?.slips)) {
    for (const s of x.slips) {
      if (Array.isArray(s.legs)) rows.push(...s.legs);
    }
  }
  return rows;
}

function normMarket(x) {
  return String(x || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[()]/g, "")
    .trim();
}

function normSide(x) {
  return String(x || "").toUpperCase().trim();
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function lineBucket(line) {
  const n = num(line);
  if (n === null) return "unknown_line";
  if (n === 0.5) return "0.5";
  if (n === 1.5) return "1.5";
  if (n === 2.5) return "2.5";
  if (n === 3.5) return "3.5";
  if (n === 4.5) return "4.5";
  if (n === 5.5) return "5.5";
  if (n === 6.5) return "6.5";
  if (n === 7.5) return "7.5";
  if (n < 1) return "<1";
  if (n < 3) return "1-2.5";
  if (n < 6) return "3-5.5";
  if (n < 10) return "6-9.5";
  if (n < 20) return "10-19.5";
  return "20+";
}

function getProb(r) {
  return num(
    r.calibratedDistributionProb ??
    r.recommendedProb ??
    r.prob ??
    r.probability ??
    r.twoSidedPricing?.selectedProb
  );
}

function getEdge(r) {
  return num(
    r.adjustedEdge ??
    r.adjEdge ??
    r.edge ??
    r.twoSidedPricing?.modelOnlyEdge
  );
}

function getReason(r) {
  const reason = r.reason ?? r.disabledReason ?? r.blockedReason ?? null;
  if (reason) return String(reason);

  if (Array.isArray(r.finalExecutionGate?.reasons)) {
    return r.finalExecutionGate.reasons.join(",");
  }

  if (r.fullBoardPromotion?.action === "TIGHTEN") {
    return `full_board_tighten:${r.fullBoardPromotion.reason || "unknown"}`;
  }

  return null;
}

function isBlockedByGenericMarketPenalty(r) {
  const fb = r.fullBoardPromotion;
  if (!fb) return false;
  return fb.action === "TIGHTEN" || fb.rawAction === "TIGHTEN";
}

function candidateClass(r) {
  const prob = getProb(r);
  const edge = getEdge(r);
  const market = normMarket(r.market);
  const side = normSide(r.side);
  const line = num(r.line);

  if (market === "bases" && side === "MORE" && line === 0.5 && prob >= 0.70 && edge >= 0.15) {
    return "ELITE_BASES_MORE_0.5_AUDIT";
  }

  if (line === 0.5 && prob >= 0.70 && edge >= 0.15) {
    return "ELITE_0.5_AUDIT";
  }

  if (prob >= 0.65 && edge >= 0.10) {
    return "HIGH_PROB_HIGH_EDGE_AUDIT";
  }

  if (prob >= 0.60 && edge >= 0.05) {
    return "STANDARD_AUDIT";
  }

  return "LOW_PRIORITY";
}

const rows = [];

for (const input of INPUTS) {
  const raw = read(input, null);
  for (const r of asRows(raw)) {
    if (!r || typeof r !== "object") continue;

    const market = normMarket(r.market);
    const side = normSide(r.side);
    const line = num(r.line);
    const prob = getProb(r);
    const edge = getEdge(r);

    if (!market || !side || line === null) continue;

    const genericBucket = `${market}_${side}`;
    const specificBucket = `${market}_${side}_${lineBucket(line)}`;

    rows.push({
      date,
      sourceFile: input,
      player: r.player || r.name || r.playerName || null,
      team: r.team || null,
      game: r.game || r.resolvedGame || null,
      market,
      side,
      line,
      tier: r.oddsTier || r.specialTier || r.tier || null,
      prob,
      edge,
      grade: r.grade || null,
      books: r.books ?? null,
      genericBucket,
      specificBucket,
      candidateClass: candidateClass(r),
      blockedReason: getReason(r),
      genericMarketPenalty: isBlockedByGenericMarketPenalty(r),
      fullBoardPromotion: r.fullBoardPromotion || null
    });
  }
}

const deduped = [];
const seen = new Set();

for (const r of rows) {
  const key = [
    r.player,
    r.team,
    r.game,
    r.market,
    r.side,
    r.line,
    r.tier,
    r.prob,
    r.edge
  ].join("|");

  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(r);
}

const interesting = deduped.filter(r =>
  r.candidateClass !== "LOW_PRIORITY" ||
  r.genericMarketPenalty ||
  r.blockedReason
);

const bucketMap = new Map();

for (const r of interesting) {
  const key = r.specificBucket;
  if (!bucketMap.has(key)) {
    bucketMap.set(key, {
      bucket: key,
      genericBucket: r.genericBucket,
      rows: 0,
      genericPenaltyRows: 0,
      blockedRows: 0,
      eliteAuditRows: 0,
      avgProb: 0,
      avgEdge: 0,
      examples: []
    });
  }

  const b = bucketMap.get(key);
  b.rows++;
  if (r.genericMarketPenalty) b.genericPenaltyRows++;
  if (r.blockedReason) b.blockedRows++;
  if (r.candidateClass.includes("ELITE")) b.eliteAuditRows++;
  b.avgProb += Number(r.prob || 0);
  b.avgEdge += Number(r.edge || 0);
  if (b.examples.length < 10) {
    b.examples.push({
      player: r.player,
      market: r.market,
      side: r.side,
      line: r.line,
      prob: r.prob,
      edge: r.edge,
      reason: r.blockedReason,
      class: r.candidateClass
    });
  }
}

const buckets = [...bucketMap.values()]
  .map(b => ({
    ...b,
    avgProb: b.rows ? Number((b.avgProb / b.rows).toFixed(4)) : null,
    avgEdge: b.rows ? Number((b.avgEdge / b.rows).toFixed(4)) : null
  }))
  .sort((a, b) =>
    b.eliteAuditRows - a.eliteAuditRows ||
    b.genericPenaltyRows - a.genericPenaltyRows ||
    b.avgProb - a.avgProb
  );

const elite05 = interesting.filter(r => r.candidateClass.includes("0.5"));
const genericPenaltyElite = interesting.filter(r =>
  r.genericMarketPenalty &&
  (r.candidateClass === "ELITE_BASES_MORE_0.5_AUDIT" || r.candidateClass === "ELITE_0.5_AUDIT")
);

const report = {
  date,
  generatedAt: new Date().toISOString(),
  inputFiles: INPUTS,
  totalRows: deduped.length,
  interestingRows: interesting.length,
  elite05Rows: elite05.length,
  genericPenaltyEliteRows: genericPenaltyElite.length,
  summary: {
    byCandidateClass: Object.entries(
      interesting.reduce((acc, r) => {
        acc[r.candidateClass] = (acc[r.candidateClass] || 0) + 1;
        return acc;
      }, {})
    ).map(([candidateClass, count]) => ({ candidateClass, count }))
      .sort((a, b) => b.count - a.count),
    topBuckets: buckets.slice(0, 30)
  },
  elite05,
  genericPenaltyElite,
  buckets,
  rows: interesting
};

write(OUT, report);
write(LATEST, report);

console.log("LINE-SPECIFIC BLOCK AUDIT");
console.log("-------------------------");
console.log("date:", date);
console.log("total rows:", deduped.length);
console.log("interesting rows:", interesting.length);
console.log("elite 0.5 rows:", elite05.length);
console.log("generic penalty elite rows:", genericPenaltyElite.length);
console.table(report.summary.byCandidateClass);
console.table(buckets.slice(0, 20).map(b => ({
  bucket: b.bucket,
  rows: b.rows,
  genericPenaltyRows: b.genericPenaltyRows,
  eliteAuditRows: b.eliteAuditRows,
  avgProb: b.avgProb,
  avgEdge: b.avgEdge
})));
console.log("saved:", OUT);
console.log("saved:", LATEST);
