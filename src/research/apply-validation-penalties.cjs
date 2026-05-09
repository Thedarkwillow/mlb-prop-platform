const fs = require("fs");

const IN = "outputs/final-slips-modeled.json";
const FALLBACK_IN = "outputs/final-slips.json";
const OUT = "outputs/final-slips-validated.json";
const MARKET_INTEL = "outputs/market-intelligence.json";
const CLV_FILE = `outputs/clv-report-${new Date().toISOString().slice(0,10)}.json`;
const VALIDATION_RULES = "data/results/validation-rules.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function key(player, market, side, line) {
  return [player, market, side, line].map(x => String(x ?? "").toLowerCase().trim()).join("|");
}

function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x));
}

const raw = read(IN, read(FALLBACK_IN, []));
const slips = Array.isArray(raw) ? raw : (raw.slips || []);

const intel = read(MARKET_INTEL, {});
const marketRows = intel.byMarketSide || [];
const marketRoi = new Map(
  marketRows.map(r => [String(r.bucket || "").toLowerCase(), Number(r.roi || 0)])
);

const rules = read(VALIDATION_RULES, {});
const marketRuleMap = new Map((rules.byMarket || []).map(r => [String(r.bucket || "").toLowerCase(), r]));
const booksRuleMap = new Map((rules.byBooks || []).map(r => [String(r.bucket || "").toLowerCase(), r]));
const probRuleMap = new Map((rules.byProb || []).map(r => [String(r.bucket || "").toLowerCase(), r]));

function probBucket(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  const low = Math.floor(p * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function booksBucket(b) {
  b = Number(b || 0);
  if (b >= 4) return "4+ books";
  if (b === 3) return "3 books";
  if (b === 2) return "2 books";
  return "0-1 books";
}

function applyRuleAdjustment(rule, notes) {
  if (!rule || !Number.isFinite(Number(rule.adjustment))) return 0;
  const adj = Number(rule.adjustment);
  if (adj < 0) notes.push(`${rule.type || "rule"} ${rule.bucket} ${rule.action} ${adj}`);
  if (adj > 0) notes.push(`${rule.type || "rule"} ${rule.bucket} ${rule.action} +${adj}`);
  return adj;
}

const clvRows = read(CLV_FILE, []);
const clvMap = new Map(
  clvRows.map(r => [key(r.player, r.market, r.side, r.line), Number(r.clv || 0)])
);

function validateLeg(leg) {
  const notes = [];
  let penalty = 0;
  let boost = 0;

  const marketSide = `${String(leg.market || "").toLowerCase()} ${String(leg.side || "").toUpperCase()}`;
  const roi = marketRoi.get(marketSide.toLowerCase());

  if (Number.isFinite(roi)) {
    if (roi <= -0.25) {
      penalty += 0.08;
      notes.push(`market ROI bad ${roi.toFixed(2)}`);
    } else if (roi >= 0.25) {
      boost += 0.03;
      notes.push(`market ROI strong ${roi.toFixed(2)}`);
    }
  }

  if (String(leg.market || "").toLowerCase() === "runs") {
    penalty += 0.07;
    notes.push("runs market downgrade");
  }

  const clv = clvMap.get(key(leg.player, leg.market, leg.side, leg.line));
  if (Number.isFinite(clv)) {
    if (clv <= -15) {
      penalty += 0.06;
      notes.push(`bad CLV ${clv}`);
    } else if (clv < 0) {
      penalty += 0.025;
      notes.push(`negative CLV ${clv}`);
    } else if (clv >= 5) {
      boost += 0.02;
      notes.push(`positive CLV ${clv}`);
    }
  }

  const prob = Number(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const probRule = probRuleMap.get(probBucket(prob).toLowerCase());
  const bookRule = booksRuleMap.get(booksBucket(leg.books ?? leg.sportsbookBookCount).toLowerCase());
  const marketRule = marketRuleMap.get(marketSide.toLowerCase());

  const ruleAdj = 
    applyRuleAdjustment(probRule, notes) +
    applyRuleAdjustment(bookRule, notes) +
    applyRuleAdjustment(marketRule, notes);

  if (ruleAdj < 0) penalty += Math.abs(ruleAdj);
  if (ruleAdj > 0) boost += ruleAdj;
  if (ruleAdj !== 0) notes.push("warehouse validation rules");

  const books = Number(leg.books ?? leg.sportsbookBookCount ?? 0);
  if (books < 2) {
    penalty += 0.10;
    notes.push("below 2-book support");
  }

  const baseScore = Number(leg.modelScore ?? leg.score ?? 0);
  const validationScore = clamp(baseScore + boost - penalty);

  let validationGrade = leg.modelGrade || leg.grade || "UNKNOWN";
  if (penalty >= 0.10) validationGrade = "WATCHLIST";
  else if (validationScore >= 0.25) validationGrade = "GREEN";
  else if (validationScore >= 0.16) validationGrade = "NEUTRAL";
  else validationGrade = "WATCHLIST";

  return {
    ...leg,
    validationScore,
    validationPenalty: Number(penalty.toFixed(4)),
    validationBoost: Number(boost.toFixed(4)),
    validationGrade,
    validationNotes: notes
  };
}

const validated = slips.map(slip => ({
  ...slip,
  legs: (slip.legs || []).map(validateLeg)
}));

fs.writeFileSync(OUT, JSON.stringify(validated, null, 2));

const legs = validated.flatMap(s => s.legs || []);
console.log("VALIDATION PENALTIES APPLIED");
console.table(
  legs
    .slice()
    .sort((a,b) => Number(b.validationPenalty || 0) - Number(a.validationPenalty || 0))
    .slice(0, 20)
    .map(l => ({
      player: l.player,
      market: l.market,
      side: l.side,
      line: l.line,
      model: l.marketModel,
      score: Number(l.validationScore || 0).toFixed(4),
      penalty: l.validationPenalty,
      boost: l.validationBoost,
      grade: l.validationGrade,
      notes: (l.validationNotes || []).join("; ")
    }))
);
console.log(`Wrote ${OUT}`);
