const fs = require("fs");

const ROLLING = "outputs/rolling-lane-promotion-review.json";
const REVERSE_GATE = "outputs/reverse-hitter-promotion-gate.json";
const OUT = "outputs/lane-status-summary.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function pct(v) {
  return v === null || v === undefined ? "?" : `${(Number(v) * 100).toFixed(1)}%`;
}

function laneEmoji(decision) {
  if (decision === "PROMOTION_REVIEW") return "🟢";
  if (decision === "WATCH") return "🟡";
  if (decision === "SUPPRESS") return "🔴";
  if (decision === "KEEP_GUARD_ACTIVE") return "🛡️";
  return "⚪";
}

function shortDecision(decision) {
  if (decision === "PROMOTION_REVIEW") return "PROMOTION REVIEW";
  if (decision === "RESEARCH_ONLY") return "RESEARCH ONLY";
  if (decision === "KEEP_GUARD_ACTIVE") return "GUARD ACTIVE";
  return decision || "UNKNOWN";
}

const data = readJson(ROLLING, {});
const lanes = Array.isArray(data.lanes) ? data.lanes : [];

const lines = [];
lines.push("");
lines.push("LANE STATUS");
lines.push("===========");

if (!lanes.length) {
  lines.push("No rolling lane review found yet.");
  lines.push(`Expected: ${ROLLING}`);
} else {
  for (const lane of lanes) {
    const emoji = laneEmoji(lane.decision);
    const decision = shortDecision(lane.decision);
    const reasons = Array.isArray(lane.reasons) ? lane.reasons.join(", ") : "";

    lines.push(`${emoji} ${lane.lane}: ${decision}`);

    if (lane.windows?.all?.bucket) {
      const b = lane.windows.all.bucket;
      lines.push(`   all: ${b.hit || 0}/${b.graded || 0} = ${pct(b.hitRate)} | unmatched=${b.unmatched || 0}`);
    }

    if (lane.summary?.hrrAnchors) {
      const h = lane.summary.hrrAnchors;
      const f = lane.summary.fullSlips;
      const er = lane.summary.pitcherEarnedRunsFiller;
      lines.push(`   HRR anchors: ${h.hit || 0}/${h.graded || 0} = ${pct(h.hitRate)}`);
      lines.push(`   Pitcher ER filler: ${er.hit || 0}/${er.graded || 0} = ${pct(er.hitRate)} | unmatched=${er.unmatched || 0}`);
      lines.push(`   Full slips: ${f.hit || 0}/${f.graded || 0} = ${pct(f.hitRate)}`);
    }

    if (reasons) lines.push(`   reason: ${reasons}`);
  }
}


const reverseGate = readJson(REVERSE_GATE, null);
if (reverseGate && reverseGate.lane) {
  const emoji = laneEmoji(reverseGate.status);
  lines.push(`${emoji} ${reverseGate.lane}: ${shortDecision(reverseGate.status)}`);
  const b = reverseGate.summary?.total || {};
  lines.push(`   all: ${b.hit || 0}/${b.graded || 0} = ${pct(b.hitRate)} | unmatched=${b.unmatched || 0}`);
  if (Array.isArray(reverseGate.reasons) && reverseGate.reasons.length) {
    lines.push(`   reason: ${reverseGate.reasons.join(", ")}`);
  }
}

lines.push("");
lines.push("NOTE");
lines.push("----");
lines.push("Research-only lanes are tracked but not promoted. Suppressed lanes are blocked from official use until rolling results recover.");

fs.writeFileSync(OUT, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`saved: ${OUT}`);
