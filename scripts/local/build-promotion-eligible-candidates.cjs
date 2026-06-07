const fs = require("fs");
const { canonicalPropRow } = require("../../src/shared/canonical-prop-row.cjs");

const ROLLING = "outputs/rolling-lane-promotion-review.json";
const REVERSE_GATE = "outputs/reverse-hitter-promotion-gate.json";

const SOURCES = [
  {
    lane: "standard_hitter_bridge_watchlist",
    file: "outputs/standard-hitter-bridge-watchlist.json",
    allowedDecision: "PROMOTION_REVIEW"
  },
  {
    lane: "less_batter_watchlist",
    file: "outputs/less-batter-watchlist.json",
    allowedDecision: "PROMOTION_REVIEW"
  },
  {
    lane: "reverse_hitter_signal",
    file: "outputs/manual/auto-reverse-hitter-signal.json",
    allowedDecision: "PROMOTION_REVIEW"
  },
  {
    lane: "goblin_hrr_controlled",
    file: "outputs/goblin-recommended-card.json",
    allowedDecision: "PROMOTION_REVIEW"
  }
];

const OUT = "outputs/promotion-eligible-candidates.json";
const TXT = "outputs/promotion-eligible-candidates.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function arr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

function isPropLike(v) {
  return v && typeof v === "object" &&
    (v.player || v.playerName || v.athleteName) &&
    (
      v.market || v.statType || v.projectionType || v.stat ||
      v.side || v.pick || v.direction ||
      v.line !== undefined || v.statValue !== undefined
    );
}

function flatten(v, out = [], path = "") {
  if (!v) return out;

  if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, out, `${path}[${i}]`));
    return out;
  }

  if (typeof v !== "object") return out;

  const containers = ["legs", "picks", "topLegs", "candidates", "graded", "rows", "plays", "watchlist", "primary", "alternates"];

  for (const key of containers) {
    if (Array.isArray(v[key])) flatten(v[key], out, path ? `${path}.${key}` : key);
  }

  if (isPropLike(v)) {
    out.push({ path, row: v });
  }

  for (const [key, val] of Object.entries(v)) {
    if ([...containers, "canonical", "original"].includes(key)) continue;
    if (val && typeof val === "object") flatten(val, out, path ? `${path}.${key}` : key);
  }

  return out;
}

function newestMatchingFile(pattern) {
  const dir = "outputs/history";
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(name => pattern.test(name))
    .map(name => `${dir}/${name}`)
    .filter(file => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

function addLaneDecision(map, lane, decision, reasons = [], dates = [], raw = null) {
  if (!lane) return;
  map.set(s(lane), {
    decision: s(decision || "RESEARCH_ONLY"),
    reasons: arr(reasons).map(String),
    dates: arr(dates).map(String),
    raw
  });
}

function rollingDecisionMap() {
  const map = new Map();

  const rollingFiles = [
    ROLLING,
    newestMatchingFile(/^\d{4}-\d{2}-\d{2}-lane-promotion-review\.json$/)
  ].filter(Boolean);

  for (const file of rollingFiles) {
    const rolling = readJson(file, {});
    const recs = [
      ...arr(rolling.recommendations),
      ...arr(rolling.lanes),
      ...arr(rolling.reviews)
    ];

    for (const r of recs) {
      addLaneDecision(
        map,
        r.lane || r.name,
        r.decision || r.status,
        r.reasons || r.decisionReasons,
        r.dates,
        { sourceFile: file, ...r }
      );
    }
  }

  const suppressionFiles = [
    newestMatchingFile(/^\d{4}-\d{2}-\d{2}-goblin-hrr-controlled-suppression\.json$/)
  ].filter(Boolean);

  for (const file of suppressionFiles) {
    const sup = readJson(file, null);
    if (sup) {
      addLaneDecision(
        map,
        "goblin_hrr_controlled",
        sup.status === "SUPPRESS_GOBLIN_HRR_CONTROLLED" ? "SUPPRESS" : sup.status,
        sup.reasons,
        [sup.date].filter(Boolean),
        { sourceFile: file, ...sup }
      );
    }
  }

  const reverse = readJson(REVERSE_GATE, null);
  if (reverse) {
    addLaneDecision(
      map,
      "reverse_hitter_signal",
      reverse.status || "RESEARCH_ONLY",
      reverse.reasons,
      reverse.dates,
      { sourceFile: REVERSE_GATE, ...reverse }
    );
  }

  return map;
}

function canonicalGate(c) {
  const reasons = [];
  const risk = s(c.riskStatus);
  const sample = s(c.sampleStatus);
  const lineup = s(c.lineupStatus);
  const prob = n(c.probability);

  if (/RESEARCH_ONLY|WATCHLIST|PENDING|REVIEW|UNKNOWN|BLOCKED/.test(risk)) {
    reasons.push(`riskStatus:${risk}`);
  }

  if (/PENDING|UNKNOWN|LOW_SAMPLE/.test(sample)) {
    reasons.push(`sampleStatus:${sample}`);
  }

  if (/UNKNOWN|PARTIAL/.test(lineup)) {
    reasons.push(`lineupStatus:${lineup}`);
  }

  if (prob !== null && prob >= 0.75 && reasons.length) {
    reasons.push("high_probability_requires_clean_context");
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

const decisions = rollingDecisionMap();

const report = {
  generatedAt: new Date().toISOString(),
  sourceReview: ROLLING,
  lanes: [],
  eligible: [],
  blocked: []
};

for (const src of SOURCES) {
  const decisionInfo = decisions.get(src.lane) || {
    decision: "RESEARCH_ONLY",
    reasons: ["missing_lane_review"],
    dates: []
  };

  const data = readJson(src.file, null);
  const rows = data ? flatten(data) : [];

  const laneSummary = {
    lane: src.lane,
    file: src.file,
    exists: !!data,
    decision: decisionInfo.decision,
    decisionReasons: decisionInfo.reasons,
    rows: rows.length,
    eligible: 0,
    blocked: 0
  };

  const laneCanPromote = decisionInfo.decision === src.allowedDecision;

  for (const item of rows) {
    const c = item.row.canonical && typeof item.row.canonical === "object"
      ? item.row.canonical
      : canonicalPropRow(item.row, { source: src.file, modelVersion: "canonical_v1" });

    const gate = canonicalGate(c);
    const reasons = [];

    if (!laneCanPromote) {
      reasons.push(`lane_not_promoted:${decisionInfo.decision}`);
      for (const r of decisionInfo.reasons) reasons.push(`lane_reason:${r}`);
    }

    if (!gate.allowed) {
      reasons.push(...gate.reasons);
    }

    const payload = {
      lane: src.lane,
      sourceFile: src.file,
      path: item.path,
      player: c.player,
      team: c.team,
      game: c.game,
      market: c.market,
      side: c.side,
      line: c.line,
      projection: c.projection,
      probability: c.probability,
      overProb: c.overProb,
      underProb: c.underProb,
      sampleStatus: c.sampleStatus,
      lineupStatus: c.lineupStatus,
      riskStatus: c.riskStatus,
      finalScore: c.finalScore,
      reasonCodes: c.reasonCodes,
      canonical: c
    };

    if (reasons.length) {
      laneSummary.blocked++;
      report.blocked.push({ ...payload, blockedReasons: reasons });
    } else {
      laneSummary.eligible++;
      report.eligible.push({
        ...payload,
        promotionStatus: "PROMOTION_ELIGIBLE_REQUIRES_FINAL_SLIP_GATES"
      });
    }
  }

  report.lanes.push(laneSummary);
}

const lines = [];
lines.push("PROMOTION-ELIGIBLE CANDIDATES");
lines.push("=============================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`eligible=${report.eligible.length}`);
lines.push(`blocked=${report.blocked.length}`);
lines.push("");

lines.push("LANES");
lines.push("-----");
for (const l of report.lanes) {
  lines.push(`${l.lane}: decision=${l.decision} rows=${l.rows} eligible=${l.eligible} blocked=${l.blocked}`);
  if (l.decisionReasons.length) lines.push(`  reasons=${l.decisionReasons.join(", ")}`);
}

lines.push("");
lines.push("ELIGIBLE");
lines.push("--------");
if (!report.eligible.length) {
  lines.push("none");
} else {
  for (const r of report.eligible.slice(0, 50)) {
    lines.push(`${r.player} | ${r.market} ${r.side} ${r.line} | prob=${r.probability ?? "?"} | lane=${r.lane}`);
  }
}

lines.push("");
lines.push("TOP BLOCKED");
lines.push("-----------");
for (const r of report.blocked.slice(0, 50)) {
  lines.push(`${r.player} | ${r.market} ${r.side} ${r.line} | lane=${r.lane} | ${r.blockedReasons.join(", ")}`);
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: report.generatedAt,
  eligible: report.eligible.length,
  blocked: report.blocked.length,
  lanes: report.lanes
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
