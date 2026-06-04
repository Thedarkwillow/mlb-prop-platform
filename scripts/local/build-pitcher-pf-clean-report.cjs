const fs = require("fs");
const cp = require("child_process");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  cp.execSync("node scripts/local/board-slate-date.cjs").toString().trim();

const PF_FILE = `data/pickfinder/pickfinder-style-pitcher-backfill-${DATE}.json`;
const HARDENING_FILE = `outputs/production-candidate-hardening-${DATE}.json`;
const PRODUCTION_FILE = "outputs/production-candidates.json";
const BOARD_FILE = "outputs/priced-board.json";

const OUT_JSON = `outputs/pitcher-pf-clean-report-${DATE}.json`;
const OUT_TXT = `outputs/pitcher-pf-clean-report-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/pitcher-pf-clean-report-latest.json";
const OUT_LATEST_TXT = "outputs/pitcher-pf-clean-report-latest.txt";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const hasPropShape =
    v.player || v.playerName || v.name || v.participantName ||
    v.market || v.statType || v.stat || v.projectionType ||
    v.side || v.pick || v.direction ||
    v.line || v.lineScore || v.target ||
    v.prob || v.probability || v.modelProb || v.modelProbability;

  if (hasPropShape) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }

  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const raw = norm(v).replace(/\s+/g, "_");
  const aliases = {
    pitcher_strikeouts: "strikeouts",
    strikeouts: "strikeouts",
    hits_allowed: "hits_allowed",
    pitcher_hits_allowed: "hits_allowed",
    walks_allowed: "walks_allowed",
    pitcher_walks_allowed: "walks_allowed",
    earned_runs_allowed: "earned_runs_allowed",
    pitcher_earned_runs_allowed: "earned_runs_allowed",
    runs_allowed: "runs_allowed",
    pitcher_runs_allowed: "runs_allowed",
    pitching_outs: "pitching_outs",
    outs: "pitching_outs",
    pitches_thrown: "pitches_thrown",
    pitcher_fantasy_score: "pitcher_fantasy_score"
  };
  return aliases[raw] || raw;
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase();
  if (s.includes("MORE") || s === "OVER") return "MORE";
  if (s.includes("LESS") || s === "UNDER") return "LESS";
  return s || "NA";
}

function lineNorm(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "NA";
  return String(n);
}

function propKey(row) {
  const player = norm(row.player || row.playerName || row.name || row.participantName || row.displayName);
  const market = marketNorm(row.market || row.statType || row.stat || row.projectionType || row.type);
  const side = sideNorm(row.side || row.pick || row.direction || row.recommendation);
  const line = lineNorm(row.line ?? row.lineScore ?? row.target ?? row.value);
  return `${player}|${market}|${side}|${line}`;
}

function loosePropKey(row) {
  const player = norm(row.player || row.playerName || row.name || row.participantName || row.displayName);
  const market = marketNorm(row.market || row.statType || row.stat || row.projectionType || row.type);
  const line = lineNorm(row.line ?? row.lineScore ?? row.target ?? row.value);
  return `${player}|${market}|${line}`;
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return null;
}

function extractModelProb(row, side) {
  if (!row || typeof row !== "object") return null;

  const direct = firstFinite(
    row.modelProb,
    row.modelProbability,
    row.adjustedProb,
    row.adjustedProbability,
    row.finalProb,
    row.finalProbability,
    row.prob,
    row.probability,
    row.winProbability,
    row.hitProbability
  );

  if (direct != null) return direct;

  const s = sideNorm(side);
  if (s === "MORE") {
    return firstFinite(
      row.moreProb,
      row.moreProbability,
      row.overProb,
      row.overProbability,
      row.probMore,
      row.probOver
    );
  }

  if (s === "LESS") {
    return firstFinite(
      row.lessProb,
      row.lessProbability,
      row.underProb,
      row.underProbability,
      row.probLess,
      row.probUnder
    );
  }

  return null;
}

function buildModelIndex(...sources) {
  const exact = new Map();
  const loose = new Map();

  for (const source of sources) {
    for (const row of flatten(source)) {
      const k = propKey(row);
      const lk = loosePropKey(row);
      if (k.replace(/\|/g, "")) {
        const existing = exact.get(k) || {};
        exact.set(k, { ...existing, ...row });
      }
      if (lk.replace(/\|/g, "")) {
        const existing = loose.get(lk) || {};
        loose.set(lk, { ...existing, ...row });
      }
    }
  }

  return { exact, loose };
}


function actionablePitcherPfBucket(row) {
  const market = String(row.market || "").toLowerCase();
  const tier = String(row.tier || "").toLowerCase();
  const modelProb = Number(row.modelProb);
  const pfScore = Number(row.pfScore);
  const pfStatus = row.pfStatus || row.pickfinderStatus || row.status;

  if (market === "pitcher_fantasy_score") return "FANTASY_TRACK_ONLY";
  if (market === "pitches_thrown") return "PITCH_COUNT_SECONDARY";
  if (tier === "demon") return "DEMON_RESEARCH_ONLY";
  if (pfStatus !== "PF_CONFIRMED") return "NOT_PF_CONFIRMED";
  if (!Number.isFinite(modelProb)) return "PF_CONFIRMED_MODEL_PROB_MISSING";
  if (!Number.isFinite(pfScore)) return "PF_CONFIRMED_PF_SCORE_MISSING";

  if (modelProb >= 0.65 && pfScore >= 0.65) return "PITCHER_PF_ACTIONABLE_WATCH";
  if (modelProb >= 0.60 && pfScore >= 0.65) return "PITCHER_PF_REVIEW_WATCH";
  if (modelProb < 0.55) return "MODEL_DISAGREES";
  return "PF_CONFIRMED_WITH_MODEL_PROB";
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "NA";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function nVal(split) {
  return Number(split?.n || 0);
}

function rateVal(split) {
  const n = Number(split?.rate);
  return Number.isFinite(n) ? n : null;
}

function avgVal(split) {
  const n = Number(split?.avg);
  return Number.isFinite(n) ? n : null;
}

function pfScore(row) {
  const l10 = rateVal(row.l10);
  const season = rateVal(row.season);
  if (l10 == null && season == null) return 0;
  if (l10 == null) return season;
  if (season == null) return l10;
  return (l10 * 0.6) + (season * 0.4);
}

function bucketFor(row, modelProb) {
  const market = String(row.market || "").toLowerCase();
  const tier = String(row.tier || "").toLowerCase();
  const pfStatus = row.pfStatus || "PF_CONFIRMED";
  const pf = Number(row.pfScore ?? pfScore(row));
  const mp = Number(modelProb);

  if (market === "pitcher_fantasy_score") return "FANTASY_TRACK_ONLY";
  if (market === "pitches_thrown") return "PITCH_COUNT_SECONDARY";
  if (tier === "demon") return "DEMON_RESEARCH_ONLY";
  if (pfStatus !== "PF_CONFIRMED") return "NOT_PF_CONFIRMED";
  if (!Number.isFinite(mp)) return "PF_CONFIRMED_MODEL_PROB_MISSING";
  if (!Number.isFinite(pf)) return "PF_CONFIRMED_PF_SCORE_MISSING";

  if (mp >= 0.65 && pf >= 0.65) return "PITCHER_PF_ACTIONABLE_WATCH";
  if (mp >= 0.60 && pf >= 0.65) return "PITCHER_PF_REVIEW_WATCH";
  if (mp < 0.55) return "MODEL_DISAGREES";

  return "PF_CONFIRMED_WITH_MODEL_PROB";
}

function formatRow(row, i = null) {
  const prefix = i == null ? "" : `${i}. `;
  const modelProbText = row.modelProb == null ? "modelProb=NA" : `modelProb=${pct(row.modelProb)}`;
  return (
    `${prefix}${row.player} | ${row.team || "NA"} | ${row.market} ${row.side} ${row.line} | ` +
    `${modelProbText} | pfScore=${pct(row.pfScore)} | ` +
    `L10=${pct(row.l10?.rate)} n=${nVal(row.l10)} | ` +
    `Season=${pct(row.season?.rate)} n=${nVal(row.season)} | ` +
    `avg=${avgVal(row.season) == null ? "NA" : avgVal(row.season).toFixed(2)} | ` +
    `tier=${row.tier || "NA"} | bucket=${row.bucket}`
  );
}

fs.mkdirSync("outputs", { recursive: true });

const pf = readJson(PF_FILE, {});
const hardening = readJson(HARDENING_FILE, {});
const production = readJson(PRODUCTION_FILE, {});
const board = readJson(BOARD_FILE, []);

const modelIndex = buildModelIndex(hardening, production, board);
const pfRows = Array.isArray(pf.rows) ? pf.rows : [];

const confirmed = pfRows
  .filter(r => r.pfStatus === "PF_CONFIRMED")
  .map(r => {
    const exact = modelIndex.exact.get(propKey(r));
    const loose = modelIndex.loose.get(loosePropKey(r));
    const modelRow = exact || loose || null;
    const modelProb = extractModelProb(modelRow, r.side);
    const enriched = {
      ...r,
      modelProb,
      modelProbSource: exact ? "exact_prop_match" : loose ? "loose_side_agnostic_match" : "missing",
      pfScore: pfScore(r),
      bucket: bucketFor(r, modelProb)
    };
    return enriched;
  })
  .sort((a, b) => {
    const ap = a.modelProb == null ? -1 : a.modelProb;
    const bp = b.modelProb == null ? -1 : b.modelProb;
    if (bp !== ap) return bp - ap;
    return b.pfScore - a.pfScore;
  });

const primary = confirmed.filter(r =>
  r.bucket === "PF_CONFIRMED_WITH_MODEL_PROB" ||
  r.bucket === "PF_CONFIRMED_MODEL_PROB_MISSING"
).filter(r => !["pitcher_fantasy_score", "pitches_thrown"].includes(marketNorm(r.market)));

const withModelProb = confirmed.filter(r => r.bucket === "PF_CONFIRMED_WITH_MODEL_PROB");
const missingModelProb = confirmed.filter(r => r.bucket === "PF_CONFIRMED_MODEL_PROB_MISSING");
const pitchCountSecondary = confirmed.filter(r => r.bucket === "PITCH_COUNT_SECONDARY");
const fantasyTrackOnly = confirmed.filter(r => r.bucket === "FANTASY_TRACK_ONLY");

const summary = {
  date: DATE,
  source: PF_FILE,
  totalPitcherBackfillRows: pfRows.length,
  pfConfirmedRows: confirmed.length,
  withModelProb: withModelProb.length,
  missingModelProb: missingModelProb.length,
  primaryRows: primary.length,
  pitchCountSecondary: pitchCountSecondary.length,
  fantasyTrackOnly: fantasyTrackOnly.length,
  policy: {
    official: false,
    note: "Pitcher PF confirmation is research/confirmation only until model probability is present and market-specific validation clears.",
    excludedFromPrimary: ["pitcher_fantasy_score"],
    secondaryOnly: ["pitches_thrown"]
  }
};

const out = {
  ...summary,
  rows: confirmed,
  sections: {
    primary,
    withModelProb,
    missingModelProb,
    pitchCountSecondary,
    fantasyTrackOnly
  }
};

const lines = [];
lines.push("CLEAN PITCHER PICKFINDER CONFIRMATION REPORT");
lines.push("============================================");
lines.push(`date=${DATE}`);
lines.push(`source=${PF_FILE}`);
lines.push(`pfConfirmedRows=${summary.pfConfirmedRows}`);
lines.push(`withModelProb=${summary.withModelProb}`);
lines.push(`missingModelProb=${summary.missingModelProb}`);
lines.push(`primaryRows=${summary.primaryRows}`);
lines.push(`pitchCountSecondary=${summary.pitchCountSecondary}`);
lines.push(`fantasyTrackOnly=${summary.fantasyTrackOnly}`);
lines.push("");
lines.push("POLICY");
lines.push("------");
lines.push("Pitcher PF confirmation is research/confirmation only.");
lines.push("Do not treat PF_CONFIRMED alone as an official play.");
lines.push("Pitcher fantasy is track-only, separate from primary/actionable.");
lines.push("Pitches thrown is secondary only.");
lines.push("modelProb=NA means no clean production model probability was matched.");
lines.push("");

lines.push("PRIMARY PF_CONFIRMED PITCHER PROPS");
lines.push("----------------------------------");
if (!primary.length) {
  lines.push("none");
} else {
  primary.forEach((r, i) => lines.push(formatRow(r, i + 1)));
}

lines.push("");
lines.push("WITH MODEL PROBABILITY");
lines.push("----------------------");
if (!withModelProb.length) {
  lines.push("none");
} else {
  withModelProb.forEach((r, i) => lines.push(formatRow(r, i + 1)));
}

lines.push("");
lines.push("MISSING MODEL PROBABILITY");
lines.push("-------------------------");
if (!missingModelProb.length) {
  lines.push("none");
} else {
  missingModelProb.forEach((r, i) => lines.push(formatRow(r, i + 1)));
}

lines.push("");
lines.push("PITCHES THROWN SECONDARY ONLY");
lines.push("-----------------------------");
if (!pitchCountSecondary.length) {
  lines.push("none");
} else {
  pitchCountSecondary.forEach((r, i) => lines.push(formatRow(r, i + 1)));
}

lines.push("");
lines.push("PITCHER FANTASY TRACK ONLY");
lines.push("------------------------");
if (!fantasyTrackOnly.length) {
  lines.push("none");
} else {
  fantasyTrackOnly.forEach((r, i) => lines.push(formatRow(r, i + 1)));
}

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");
fs.writeFileSync(OUT_LATEST_JSON, JSON.stringify(out, null, 2) + "\n");
fs.writeFileSync(OUT_LATEST_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved: ${OUT_LATEST_JSON}`);
console.log(`saved: ${OUT_LATEST_TXT}`);
