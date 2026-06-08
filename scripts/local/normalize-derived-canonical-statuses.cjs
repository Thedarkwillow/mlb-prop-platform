const fs = require("fs");

const FILES = [
  {
    file: "outputs/less-batter-watchlist.json",
    defaultRisk: "RESEARCH_ONLY_WATCHLIST",
    defaultSample: "WATCHLIST_SAMPLE_PENDING",
    defaultLineup: "LINEUP_CONTEXT_PARTIAL"
  },
  {
    file: "outputs/standard-hitter-bridge-watchlist.json",
    defaultRisk: "BLOCKED_OR_REVIEW",
    defaultSample: "WATCHLIST_SAMPLE_PENDING",
    defaultLineup: "LINEUP_CONTEXT_PARTIAL"
  },
  {
    file: "outputs/manual/auto-reverse-hitter-signal.json",
    defaultRisk: "RESEARCH_ONLY_NO_OFFICIAL_PROMOTION",
    defaultSample: "REVERSE_SIGNAL_SAMPLE_PENDING",
    defaultLineup: "LINEUP_CONTEXT_UNKNOWN"
  },
  {
    file: "outputs/goblin-recommended-card.json",
    defaultRisk: "GOBLIN_GATE_REVIEW",
    defaultSample: "GOBLIN_SAMPLE_PENDING",
    defaultLineup: "LINEUP_CONTEXT_NOT_REQUIRED_FOR_PITCHER"
  },
  {
    file: "outputs/final-slips.json",
    defaultRisk: "FINAL_SLIP_CANONICAL_REVIEW",
    defaultSample: "FINAL_SLIP_SAMPLE_PENDING",
    defaultLineup: "FINAL_SLIP_LINEUP_PENDING"
  },
  {
    file: "outputs/playable-final-slips.json",
    defaultRisk: "PLAYABLE_FINAL_CANONICAL_REVIEW",
    defaultSample: "PLAYABLE_FINAL_SAMPLE_PENDING",
    defaultLineup: "PLAYABLE_FINAL_LINEUP_PENDING"
  },
  {
    file: "outputs/official-slip.json",
    defaultRisk: "OFFICIAL_CANONICAL_REVIEW",
    defaultSample: "OFFICIAL_SAMPLE_PENDING",
    defaultLineup: "OFFICIAL_LINEUP_PENDING"
  }
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function isPitcherMarket(market) {
  return /strikeouts|pitching_outs|earned_runs_allowed|hits_allowed|walks_allowed|pitcher_fantasy/i.test(s(market));
}

function isConfirmedLineup(row) {
  const raw = JSON.stringify({
    lineupStatus: row.lineupStatus,
    confirmed: row.confirmed,
    lineupConfirmed: row.lineupConfirmed,
    confirmedLineup: row.confirmedLineup,
    status: row.status,
    lessWatchStatus: row.lessWatchStatus,
    bridgeStatus: row.bridgeStatus
  }).toUpperCase();

  return /CONFIRMED/.test(raw) && !/UNCONFIRMED/.test(raw);
}

function sampleStatus(row, fallback) {
  const c = row.canonical || {};
  const sample =
    n(row.sample) ??
    n(row.sampleSize) ??
    n(row.seasonSample) ??
    n(row.lastSample) ??
    n(row.n) ??
    n(row.games) ??
    n(c.sample);

  if (sample !== null && sample >= 25) return "TRUSTED_SAMPLE";
  if (sample !== null && sample > 0) return "LOW_SAMPLE";
  if (c.sampleStatus && c.sampleStatus !== "UNKNOWN_SAMPLE") return c.sampleStatus;
  return fallback;
}

function lineupStatus(row, fallback) {
  const c = row.canonical || {};
  if (isPitcherMarket(row.market || c.market)) return "LINEUP_NOT_REQUIRED_PITCHER_MARKET";
  if (isConfirmedLineup(row)) return "CONFIRMED";
  if (c.lineupStatus && c.lineupStatus !== "UNKNOWN_LINEUP") return c.lineupStatus;
  return fallback;
}

function riskStatus(row, fallback) {
  const c = row.canonical || {};
  const existing = s(row.riskStatus || c.riskStatus);

  if (existing && existing !== "UNKNOWN_RISK") return existing;

  const reasons = [
    ...Array.isArray(row.reasonCodes) ? row.reasonCodes : [],
    ...Array.isArray(row.reasons) ? row.reasons : [],
    ...Array.isArray(c.reasonCodes) ? c.reasonCodes : []
  ].map(String).join(" ").toLowerCase();

  if (/rookie|debut|missing_sample|unknown_sample|fallback_projection/.test(reasons)) {
    return "SAMPLE_RISK_REVIEW";
  }

  if (/reverse/i.test(fallback)) return "RESEARCH_ONLY_NO_OFFICIAL_PROMOTION";
  if (/watchlist/i.test(fallback)) return fallback;
  if (/goblin/i.test(fallback)) return fallback;

  return fallback;
}

function visit(v, cfg) {
  if (!v || typeof v !== "object") return 0;

  let count = 0;

  if (Array.isArray(v)) {
    for (const x of v) count += visit(x, cfg);
    return count;
  }

  if (v.canonical && typeof v.canonical === "object") {
    const ss = sampleStatus(v, cfg.defaultSample);
    const ls = lineupStatus(v, cfg.defaultLineup);
    const rs = riskStatus(v, cfg.defaultRisk);

    v.sampleStatus = v.sampleStatus || ss;
    v.lineupStatus = v.lineupStatus || ls;
    v.riskStatus = v.riskStatus || rs;

    v.canonical.sampleStatus = ss;
    v.canonical.lineupStatus = ls;
    v.canonical.riskStatus = rs;

    if (!Array.isArray(v.canonical.reasonCodes)) v.canonical.reasonCodes = [];
    if (!v.canonical.reasonCodes.includes(`risk:${rs}`)) {
      v.canonical.reasonCodes.push(`risk:${rs}`);
    }
    if (!v.canonical.reasonCodes.includes(`sample:${ss}`)) {
      v.canonical.reasonCodes.push(`sample:${ss}`);
    }
    if (!v.canonical.reasonCodes.includes(`lineup:${ls}`)) {
      v.canonical.reasonCodes.push(`lineup:${ls}`);
    }

    count++;
  }

  for (const [key, val] of Object.entries(v)) {
    if (key === "canonical") continue;
    if (val && typeof val === "object") count += visit(val, cfg);
  }

  return count;
}

const report = {
  generatedAt: new Date().toISOString(),
  files: []
};

for (const cfg of FILES) {
  const data = readJson(cfg.file);
  if (!data) {
    report.files.push({ file: cfg.file, exists: false, updatedRows: 0 });
    continue;
  }

  const updatedRows = visit(data, cfg);
  data.canonicalStatusNormalizedAt = new Date().toISOString();
  data.canonicalStatusVersion = "canonical_status_v1";

  writeJson(cfg.file, data);
  report.files.push({ file: cfg.file, exists: true, updatedRows });
}

fs.writeFileSync("outputs/canonical-status-normalization-report.json", JSON.stringify(report, null, 2) + "\n");
console.log(report);
