const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const CONTROLLED = "outputs/controlled-line-unlocks-latest.json";
const LEAN_LATEST = "outputs/lean-final-slips.json";
const LEAN_DATED = `outputs/lean-final-slips-${date}.json`;

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function keyOf(r) {
  const player = String(r.player || r.playerName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const market = String(r.market || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  const side = String(r.side || "").toUpperCase();
  const line = Number(r.line);
  return `${player}|${market}|${side}|${Number.isFinite(line) ? line : ""}`;
}

function normalizeControlledRow(r) {
  return {
    date,
    player: r.player,
    team: r.team || null,
    game: r.game || null,
    market: r.market,
    side: r.side,
    line: r.line,
    tier: r.tier || null,
    prob: r.prob,
    edge: r.edge,
    score: r.score ?? null,

    leanStatus: "CONTROLLED_UNLOCK_WATCHLIST",
    candidateClass: "CONTROLLED_UNLOCK_WATCHLIST",
    status: "WATCHLIST_ONLY",

    playable: false,
    officialEligible: false,
    manualReviewOnly: true,
    trackOnly: true,
    controlledUnlock: true,
    stake: 0,
    unitSize: 0,

    reason: r.blockedReason || "controlled_unlock_watchlist",
    leanNotes: [
      "controlled_unlock_from_line_specific_audit",
      "manual_review_only",
      "not_official_playable",
      "track_before_core_promotion"
    ],

    unlockRule: r.unlock?.rule || null,
    unlockReason: r.unlock?.reason || null,
    source: "controlled-line-unlocks"
  };
}

function patchLeanFile(file, controlledRows) {
  const report = readJson(file, null);
  if (!report || typeof report !== "object") {
    return { file, patched: false, reason: "missing_or_invalid_lean_report" };
  }

  report.leans = Array.isArray(report.leans) ? report.leans : [];
  report.trackOnly = Array.isArray(report.trackOnly) ? report.trackOnly : [];
  report.blocked = Array.isArray(report.blocked) ? report.blocked : [];

  const existingLeans = new Set(report.leans.map(keyOf));
  const existingBlocked = new Set(report.blocked.map(keyOf));

  const added = [];
  const promoted = [];

  for (const row of controlledRows) {
    const k = keyOf(row);
    if (!k || existingLeans.has(k) || existingBlocked.has(k)) continue;

    const lean = normalizeControlledRow(row);

    const beforeTrackOnly = report.trackOnly.length;
    report.trackOnly = report.trackOnly.filter(r => keyOf(r) !== k);
    const wasTrackOnly = report.trackOnly.length !== beforeTrackOnly;

    report.leans.push(lean);
    existingLeans.add(k);

    if (wasTrackOnly) promoted.push(lean);
    else added.push(lean);
  }

  report.controlledUnlockManualReviewInjected = {
    date,
    generatedAt: new Date().toISOString(),
    source: CONTROLLED,
    added: added.length,
    promotedFromTrackOnly: promoted.length
  };

  report.counts = {
    ...(report.counts || {}),
    leans: report.leans.length,
    trackOnly: report.trackOnly.length,
    blocked: report.blocked.length,
    controlledUnlockManualReview: report.leans.filter(r => r.controlledUnlock === true).length
  };

  writeJson(file, report);
  return { file, patched: true, added: added.length, promotedFromTrackOnly: promoted.length };
}

const controlled = readJson(CONTROLLED, {});
const controlledRows = Array.isArray(controlled.candidates) ? controlled.candidates : [];

const results = [
  patchLeanFile(LEAN_LATEST, controlledRows),
  patchLeanFile(LEAN_DATED, controlledRows)
];

console.log("CONTROLLED UNLOCK LEAN INJECTION");
console.log("--------------------------------");
console.log({ date, controlledUnlocks: controlledRows.length });
console.table(results);
