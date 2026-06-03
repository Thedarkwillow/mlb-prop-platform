const fs = require("fs");

const FINAL = "outputs/final-slips.json";
const BACKUP = "outputs/final-slips-pre-official-hardening.json";
const BLOCKED = "outputs/blocked-official-filter-slips.json";
const AUDIT = "outputs/official-filter-hardening-audit.json";
const LINE_BUCKET = "outputs/line-bucket-roi-report.json";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function normMarket(market) {
  const m = String(market || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (m === "total_bases") return "bases";
  if (m === "rbis" || m === "rbi") return "rbis";
  if (m === "earned_runs") return "earned_runs_allowed";
  if (m === "hits_allowed") return "hits";
  if (m === "walks_allowed") return "walks";
  if (m === "runs_allowed") return "runs";
  return m;
}

function normSide(side) {
  return String(side || "").toUpperCase();
}

function lineBucket(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 0.5) return "<=0.5";
  if (n <= 1.5) return "1.0-1.5";
  if (n <= 3.5) return "2.0-3.5";
  if (n <= 5.5) return "4.0-5.5";
  if (n <= 7.5) return "6.0-7.5";
  return "8.0+";
}

function readLineBucketRows() {
  const raw = readJson(LINE_BUCKET, []);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.groups)) return raw.groups;
  if (Array.isArray(raw.summary)) return raw.summary;
  if (raw && typeof raw === "object") {
    return Object.values(raw).flatMap(v => Array.isArray(v) ? v : []);
  }
  return [];
}

function buildLineBucketIndex() {
  const rows = readLineBucketRows();
  const map = new Map();

  for (const r of rows) {
    const key = r.key || r.bucket || r.name;
    if (!key) continue;
    map.set(String(key), {
      key: String(key),
      total: Number(r.total ?? r.count ?? r.picks ?? 0),
      wins: Number(r.wins ?? r.hits ?? 0),
      losses: Number(r.losses ?? r.misses ?? 0),
      pushes: Number(r.pushes ?? 0),
      hitRate: Number(r.hitRate ?? r.hit_rate ?? 0),
      roi: Number(r.roi ?? r.roiProxy ?? 0),
      avgProb: Number(r.avgProb ?? r.prob ?? 0)
    });
  }

  return map;
}

function looksLikeLeg(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const hasPlayer = !!(v.player || v.playerName || v.name);
  const hasMarket = !!(v.market || v.stat || v.type);
  const hasSide = !!(v.side || v.direction || v.recommendedSide || v.playableSide);
  const hasLine = v.line != null || v.target != null || v.projectionLine != null;
  return hasPlayer && hasMarket && hasSide && hasLine;
}

function collectLegs(v, out = [], seen = new Set()) {
  if (!v || typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (looksLikeLeg(v)) out.push(v);

  if (Array.isArray(v)) {
    for (const x of v) collectLegs(x, out, seen);
    return out;
  }

  for (const value of Object.values(v)) {
    if (value && typeof value === "object") collectLegs(value, out, seen);
  }

  return out;
}

function extractSlips(payload) {
  if (Array.isArray(payload)) return { kind: "array", slips: payload };

  for (const key of ["slips", "finalSlips", "playableSlips", "entries"]) {
    if (Array.isArray(payload?.[key])) return { kind: key, slips: payload[key] };
  }

  return { kind: "single", slips: [payload] };
}

function rebuildPayload(original, kind, slips) {
  if (kind === "array") return slips;
  if (kind === "single") return slips[0] || null;
  const copy = JSON.parse(JSON.stringify(original));
  copy[kind] = slips;
  return copy;
}

function legPlayer(leg) {
  return leg.player || leg.playerName || leg.name || "";
}

function legTeam(leg) {
  return leg.team || leg.teamAbbr || leg.playerTeam || leg.resolvedTeam || "";
}

function legMarket(leg) {
  return leg.market || leg.stat || leg.type || "";
}

function legSide(leg) {
  return leg.side || leg.direction || leg.recommendedSide || leg.playableSide || "";
}

function legLine(leg) {
  return leg.line ?? leg.target ?? leg.projectionLine;
}

function legBooks(leg) {
  const vals = [
    leg.books,
    leg.bookCount,
    leg.supportBooks,
    leg.vegasBookCount,
    leg.pricing?.books,
    leg.pricing?.bookCount
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function legGrade(leg) {
  return String(leg.grade || leg.marketGrade || leg.validationGrade || "").toUpperCase();
}

function legSideBias(leg) {
  return String(leg.sideBias || leg.marketSideBias || leg.bias || "").toUpperCase();
}

function isBadGrade(grade) {
  return ["FADE", "RED", "BAD", "AVOID"].includes(grade);
}

function isNegativeBias(sideBias) {
  return sideBias.includes("NEGATIVE") || sideBias.includes("AVOID");
}

function getBucketStats(idx, market, side, line) {
  const m = normMarket(market);
  const s = normSide(side);
  const b = lineBucket(line);

  const keys = [
    `market_side_line:${m}_${s}_${b}`,
    `market_side:${m}_${s}`,
    `market_line:${m}_${b}`,
    `market:${m}`
  ];

  for (const key of keys) {
    if (idx.has(key)) return idx.get(key);
  }

  return null;
}

function isOfficialHardBlock(leg, idx) {
  const market = normMarket(legMarket(leg));
  const side = normSide(legSide(leg));
  const line = Number(legLine(leg));
  const grade = legGrade(leg);
  const sideBias = legSideBias(leg);
  const books = legBooks(leg);
  const stats = getBucketStats(idx, market, side, line);

  const reasons = [];

  if (!market || !side || !Number.isFinite(line)) {
    reasons.push("missing_market_side_or_line");
  }

  if (isBadGrade(grade)) reasons.push(`bad_grade_${grade}`);
  if (isNegativeBias(sideBias)) reasons.push(`negative_side_bias_${sideBias}`);
  if (books !== null && books < 2) reasons.push(`books_below_2_${books}`);

  if (side === "LESS") {
    if (!stats) {
      reasons.push("less_market_missing_validated_line_bucket");
    } else {
      if (stats.total < 20) reasons.push(`less_bucket_sample_below_20_${stats.total}`);
      if (stats.hitRate < 0.58) reasons.push(`less_bucket_hitrate_below_58_${stats.hitRate}`);
      if (stats.roi < 0.10) reasons.push(`less_bucket_roi_below_10_${stats.roi}`);
    }
  }

  if (side === "MORE") {
    const isPreferredBases = market === "bases" && line <= 0.5;

    if (!isPreferredBases) {
      if (!stats) {
        reasons.push("more_market_not_preferred_and_missing_validated_bucket");
      } else {
        if (stats.total < 30) reasons.push(`more_bucket_sample_below_30_${stats.total}`);
        if (stats.hitRate < 0.60) reasons.push(`more_bucket_hitrate_below_60_${stats.hitRate}`);
        if (stats.roi < 0.10) reasons.push(`more_bucket_roi_below_10_${stats.roi}`);
      }
    }

    if (isPreferredBases && stats) {
      if (stats.total < 30) reasons.push(`bases_more_bucket_sample_below_30_${stats.total}`);
      if (stats.hitRate < 0.60) reasons.push(`bases_more_bucket_hitrate_below_60_${stats.hitRate}`);
      if (stats.roi < 0.10) reasons.push(`bases_more_bucket_roi_below_10_${stats.roi}`);
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    stats,
    normalized: { market, side, line, grade, sideBias, books }
  };
}

function main() {
  const payload = readJson(FINAL);
  if (!payload) {
    console.error(`Missing ${FINAL}`);
    process.exit(1);
  }

  const idx = buildLineBucketIndex();
  const { kind, slips } = extractSlips(payload);

  if (!fs.existsSync(BACKUP)) writeJson(BACKUP, payload);

  const kept = [];
  const blocked = [];
  const blockedLegs = [];

  for (const slip of slips) {
    const legs = collectLegs(slip);
    const audits = legs.map(leg => ({
      player: legPlayer(leg),
      team: legTeam(leg),
      market: legMarket(leg),
      side: legSide(leg),
      line: legLine(leg),
      audit: isOfficialHardBlock(leg, idx)
    }));

    const failing = audits.filter(x => x.audit.blocked);

    if (failing.length) {
      const copy = JSON.parse(JSON.stringify(slip));
      copy.status = "OFFICIAL_FILTER_BLOCKED";
      copy.isPlayable = false;
      copy.officialFiltered = true;
      copy.officialFilterReasons = failing.flatMap(x =>
        x.audit.reasons.map(r => `${x.player || "unknown"}:${r}`)
      );
      blocked.push(copy);
      blockedLegs.push(...failing);
    } else {
      kept.push(slip);
    }
  }

  writeJson(FINAL, rebuildPayload(payload, kind, kept));
  writeJson(BLOCKED, blocked);

  const audit = {
    generatedAt: new Date().toISOString(),
    mode: "official_filter_hardening",
    source: FINAL,
    backup: BACKUP,
    inputSlips: slips.length,
    keptSlips: kept.length,
    blockedSlips: blocked.length,
    blockedLegs: blockedLegs.map(x => ({
      player: x.player,
      team: x.team,
      market: x.market,
      side: x.side,
      line: x.line,
      normalized: x.audit.normalized,
      bucketStats: x.audit.stats,
      reasons: x.audit.reasons
    }))
  };

  writeJson(AUDIT, audit);

  console.log("OFFICIAL FILTER HARDENING");
  console.log("=========================");
  console.log(`inputSlips=${slips.length}`);
  console.log(`keptSlips=${kept.length}`);
  console.log(`blockedSlips=${blocked.length}`);
  console.log(`audit=${AUDIT}`);
  console.log(`blocked=${BLOCKED}`);

  console.table(blockedLegs.map(x => ({
    player: x.player,
    market: x.market,
    side: x.side,
    line: x.line,
    reasons: x.audit.reasons.join(",")
  })));
}

main();
