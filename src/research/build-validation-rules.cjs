const fs = require("fs");

const CAL = "outputs/warehouse-calibration-report.json";
const OUT = "data/results/validation-rules.json";
const MIN_SAMPLE_MAJOR = 30;
const MIN_SAMPLE_NORMAL = 15;
const MIN_SAMPLE_LIGHT = 8;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function ruleFromRow(type, row) {
  const count = Number(row.count || 0);
  const predicted = Number(row.avgProb || 0);
  const actual = Number(row.actualHitRate || 0);
  const edge = actual - predicted;

  let action = "neutral";
  let adjustment = 0;

  if (count < MIN_SAMPLE_LIGHT) {
    action = "sample-too-small";
    adjustment = 0;
  } else if (count < MIN_SAMPLE_NORMAL) {
    action = "light-sample";
    if (edge <= -0.20) adjustment = -0.02;
    else if (edge >= 0.20) adjustment = 0.015;
  } else if (count < MIN_SAMPLE_MAJOR) {
    action = "medium-sample";
    if (edge <= -0.20) adjustment = -0.04;
    else if (edge <= -0.10) adjustment = -0.025;
    else if (edge >= 0.15) adjustment = 0.02;
    else if (edge >= 0.08) adjustment = 0.01;
  } else if (edge <= -0.20) {
    action = "major-downgrade";
    adjustment = -0.08;
  } else if (edge <= -0.10) {
    action = "downgrade";
    adjustment = -0.04;
  } else if (edge >= 0.15) {
    action = "upgrade";
    adjustment = 0.03;
  } else if (edge >= 0.08) {
    action = "small-upgrade";
    adjustment = 0.015;
  }

  return {
    type,
    bucket: row.bucket,
    count,
    predicted,
    actual,
    calibrationEdge: Number(edge.toFixed(4)),
    action,
    adjustment
  };
}

const cal = read(CAL, null);
if (!cal) throw new Error(`Missing ${CAL}. Run npm run warehouse:calibration first.`);

const rules = {
  createdAt: new Date().toISOString(),
  source: CAL,
  minSampleLight: MIN_SAMPLE_LIGHT,
  minSampleNormal: MIN_SAMPLE_NORMAL,
  minSampleMajor: MIN_SAMPLE_MAJOR,
  byProb: (cal.byProb || []).map(r => ruleFromRow("probability", r)),
  byMarket: (cal.byMarket || []).map(r => ruleFromRow("market", r)),
  byBooks: (cal.byBooks || []).map(r => ruleFromRow("books", r))
};

fs.mkdirSync("data/results", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(rules, null, 2));

console.log("VALIDATION RULES");
console.log("BY PROB");
console.table(rules.byProb);
console.log("BY MARKET");
console.table(rules.byMarket);
console.log("BY BOOKS");
console.table(rules.byBooks);
console.log(`Wrote ${OUT}`);
