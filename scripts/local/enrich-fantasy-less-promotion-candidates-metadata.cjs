const fs = require("fs");
const path = require("path");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const FILE = "outputs/fantasy-less-promotion-candidates.json";
const TXT = "outputs/fantasy-less-promotion-candidates.txt";
const HIST_OUT = `outputs/history/${DATE}-fantasy-less-promotion-candidates.json`;
const HIST_TXT = `outputs/history/${DATE}-fantasy-less-promotion-candidates.txt`;

const META_SOURCES = [
  `outputs/history/${DATE}-fantasy-less-watchlist.json`,
  "outputs/fantasy-less-watchlist.json",
  "outputs/fantasy-less-watchlist-latest.json",
  `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.json`
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function norm(v) {
  return s(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function market(r) {
  return s(r.market || r.statType || r.projectionType || r.stat || r.type)
    .toLowerCase()
    .replace(/hitter fantasy score/g, "hitter_fantasy_score")
    .replace(/pitcher fantasy score/g, "pitcher_fantasy_score")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function side(r) {
  return s(r.side || r.pick || r.direction || r.selection || r.recommendation).toUpperCase();
}

function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName || r.displayName);
}

function team(r) {
  return s(r.team || r.teamAbbr || r.playerTeam || r.awayTeam || r.homeTeam);
}

function game(r) {
  return s(r.game || r.matchup || r.gameLabel || r.event || r.eventName);
}

function line(r) {
  return n(r.line ?? r.statValue ?? r.value ?? r.projectionLine ?? r.threshold);
}

function prob(r) {
  return n(
    r.probability ??
    r.prob ??
    r.winProbability ??
    r.modelProbability ??
    r.underProb ??
    r.overProb
  );
}

function actual(r) {
  return n(r.actual ?? r.actualValue ?? r.final ?? r.score ?? r.fantasyScore ?? r.points);
}

function result(r) {
  return s(r.result || r.grade || r.outcome).toLowerCase();
}

function isPropLike(v) {
  if (!v || typeof v !== "object") return false;
  return Boolean(player(v) || market(v) || v.result || v.actual !== undefined || v.actualValue !== undefined);
}

function flat(v, out = [], seen = new Set()) {
  if (!v) return out;
  if (typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (Array.isArray(v)) {
    for (const x of v) flat(x, out, seen);
    return out;
  }

  if (isPropLike(v)) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flat(val, out, seen);
  }

  return out;
}

function key(r) {
  return [
    norm(player(r)),
    norm(market(r)),
    side(r) || "LESS",
    String(line(r))
  ].join("|");
}

function bucketOf(r) {
  const m = market(r);
  const l = line(r);
  if (!m || l === null) return "";
  if (m !== "hitter_fantasy_score") return `${m}|other`;

  if (l >= 4.5 && l <= 5.5) return "hitter_fantasy_score|4.5_5.5";
  if (l >= 6.5 && l <= 8.5) return "hitter_fantasy_score|6.5_8.5";
  if (l >= 9.5 && l <= 12.5) return "hitter_fantasy_score|9.5_12.5";
  if (l >= 13.5 && l <= 20.5) return "hitter_fantasy_score|13.5_20.5";
  return "hitter_fantasy_score|other";
}

function isUnknownGame(v) {
  const x = s(v);
  return !x || x === "UNKNOWN_GAME" || /^null\s*@\s*null$/i.test(x);
}

function betterMeta(a, b) {
  const score = x =>
    (player(x) ? 1 : 0) +
    (team(x) ? 1 : 0) +
    (!isUnknownGame(game(x)) ? 1 : 0) +
    (prob(x) !== null ? 1 : 0) +
    (actual(x) !== null ? 1 : 0) +
    (result(x) ? 1 : 0);

  return score(b) > score(a) ? b : a;
}

function buildMetaMap() {
  const map = new Map();
  const counts = [];

  for (const file of META_SOURCES) {
    const data = readJson(file, null);
    const rows = flat(data);
    let used = 0;

    for (const r of rows) {
      const m = market(r);
      const p = player(r);
      const l = line(r);
      if (!p || !m || l === null) continue;
      if (m !== "hitter_fantasy_score") continue;

      const k = key({ ...r, side: side(r) || "LESS" });
      const old = map.get(k);
      map.set(k, old ? betterMeta(old, r) : r);
      used++;
    }

    counts.push({ file, rows: rows.length, used });
  }

  return { map, counts };
}

function mergeRow(row, meta) {
  if (!row || typeof row !== "object") return row;
  if (market(row) !== "hitter_fantasy_score") return row;

  const k = key({ ...row, side: side(row) || "LESS" });
  const m = meta.get(k);
  if (!m) return row;

  const merged = {
    ...row,
    player: player(row) || player(m),
    team: team(row) || team(m),
    game: isUnknownGame(game(row)) ? (game(m) || game(row) || "UNKNOWN_GAME") : game(row),
    market: market(row) || market(m),
    side: side(row) || side(m) || "LESS",
    line: line(row) ?? line(m),
    probability: prob(row) ?? prob(m),
    prob: prob(row) ?? prob(m),
    actual: actual(row) ?? actual(m),
    result: result(row) || result(m) || row.result,
    bucket: row.bucket || bucketOf(row),
    metadataSourceFound: true
  };

  for (const f of ["sampleStatus", "lineupStatus", "riskStatus"]) {
    if (!s(merged[f]) && s(m[f])) merged[f] = s(m[f]);
  }

  return merged;
}

function enrichList(list, meta) {
  if (!Array.isArray(list)) return [];
  return list.map(r => mergeRow(r, meta));
}

function pct(v) {
  const x = n(v);
  return x === null ? "?" : `${(x * 100).toFixed(1)}%`;
}

function rowLine(r) {
  return `${player(r)} | ${team(r) || "?"} | ${game(r) || "UNKNOWN_GAME"} | ${market(r)} ${side(r) || "LESS"} ${line(r)} | prob=${prob(r) === null ? "?" : pct(prob(r))} | actual=${actual(r) === null ? "?" : actual(r)} | result=${result(r) || "ungraded"}`;
}

const data = readJson(FILE, null);
if (!data) {
  console.error(`missing ${FILE}`);
  process.exit(1);
}

const { map: meta, counts } = buildMetaMap();

const rawEligible = Array.isArray(data.eligibleRows) ? data.eligibleRows :
  Array.isArray(data.eligible) ? data.eligible :
  Array.isArray(data.rows) ? data.rows.filter(r => bucketOf(r) === "hitter_fantasy_score|9.5_12.5") :
  [];

const rawBlocked = Array.isArray(data.blockedRows) ? data.blockedRows :
  Array.isArray(data.blocked) ? data.blocked :
  [];

const eligibleRows = enrichList(rawEligible, meta);
const blockedRows = enrichList(rawBlocked, meta);

const allCandidateRows = [...eligibleRows, ...blockedRows];
const beforeUnknown = [...rawEligible, ...rawBlocked].filter(r => market(r) === "hitter_fantasy_score" && isUnknownGame(game(r))).length;
const afterUnknown = allCandidateRows.filter(r => market(r) === "hitter_fantasy_score" && isUnknownGame(game(r))).length;
const filled = Math.max(0, beforeUnknown - afterUnknown);

const enriched = {
  ...data,
  eligibleRows,
  blockedRows,
  eligible: eligibleRows.length,
  blocked: blockedRows.length,
  metadataEnrichment: {
    generatedAt: new Date().toISOString(),
    date: DATE,
    metaSources: counts,
    metaKeys: meta.size,
    beforeUnknownGameRows: beforeUnknown,
    afterUnknownGameRows: afterUnknown,
    filledGameRows: filled
  }
};

const lines = [];
lines.push("FANTASY LESS PROMOTION CANDIDATES");
lines.push("=================================");
lines.push(`generatedAt=${enriched.generatedAt || enriched.metadataEnrichment.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`gateDecision=${enriched.gateDecision || "UNKNOWN"}`);
lines.push(`sourceFile=${enriched.sourceFile || "unknown"}`);
lines.push(`targetBucket=${enriched.targetBucket || "hitter_fantasy_score|9.5_12.5"}`);
lines.push(`eligible=${eligibleRows.length}`);
lines.push(`blocked=${blockedRows.length}`);
lines.push(`metaKeys=${meta.size}`);
lines.push(`metadataFilledGames=${filled}`);
lines.push(`unknownGamesRemaining=${afterUnknown}`);
lines.push("");
lines.push("META SOURCES");
lines.push("------------");
for (const c of counts) lines.push(`${c.file}: rows=${c.rows} used=${c.used}`);
lines.push("");
lines.push("ELIGIBLE SAMPLE");
lines.push("---------------");
for (const r of eligibleRows.slice(0, 40)) lines.push(rowLine(r));
lines.push("");
lines.push("TOP BLOCKED");
lines.push("-----------");
for (const r of blockedRows.slice(0, 25)) lines.push(rowLine(r));

writeJson(FILE, enriched);
writeJson(HIST_OUT, enriched);
writeText(TXT, lines.join("\n") + "\n");
writeText(HIST_TXT, lines.join("\n") + "\n");

console.log({
  date: DATE,
  metaKeys: meta.size,
  beforeUnknown,
  afterUnknown,
  filled,
  eligible: eligibleRows.length,
  blocked: blockedRows.length,
  counts
});
