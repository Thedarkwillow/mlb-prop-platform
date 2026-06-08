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
  "outputs/fantasy-less-watchlist-latest.json"
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
  return s(r.market || r.statType || r.projectionType || r.stat)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function side(r) {
  return s(r.side || r.pick || r.direction || r.selection).toUpperCase();
}

function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}

function line(r) {
  return n(r.line ?? r.statValue ?? r.value ?? r.projectionLine);
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (player(v) || market(v) || v.result || v.actual !== undefined || v.actualValue !== undefined) {
    out.push(v);
  }

  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flat(x, out);
  }
  return out;
}

function key(r) {
  return [
    norm(player(r)),
    norm(market(r)),
    side(r),
    String(line(r))
  ].join("|");
}

function isUnknownGame(v) {
  const x = s(v);
  return !x || x === "UNKNOWN_GAME" || /^null\s*@\s*null$/i.test(x);
}

function bestProb(r) {
  return n(
    r.probability ??
    r.prob ??
    r.winProbability ??
    r.modelProbability ??
    r.underProb ??
    r.overProb
  );
}

function buildMetaMap() {
  const map = new Map();

  for (const file of META_SOURCES) {
    const data = readJson(file, null);
    if (!data) continue;

    for (const r of flat(data)) {
      if (market(r) !== "hitter_fantasy_score") continue;
      if (side(r) !== "LESS") continue;

      const k = key(r);
      if (!k || k.includes("||")) continue;

      const existing = map.get(k);
      const candidate = {
        player: player(r),
        team: s(r.team || r.teamAbbr || r.playerTeam),
        game: s(r.game || r.matchup || r.gameLabel),
        probability: bestProb(r),
        overProb: n(r.overProb),
        underProb: n(r.underProb),
        sampleStatus: s(r.sampleStatus),
        lineupStatus: s(r.lineupStatus),
        riskStatus: s(r.riskStatus),
        reasonCodes: Array.isArray(r.reasonCodes) ? r.reasonCodes : [],
        sourceFile: file
      };

      if (!existing) {
        map.set(k, candidate);
        continue;
      }

      const existingScore =
        (existing.team ? 1 : 0) +
        (!isUnknownGame(existing.game) ? 1 : 0) +
        (existing.probability !== null ? 1 : 0);

      const candidateScore =
        (candidate.team ? 1 : 0) +
        (!isUnknownGame(candidate.game) ? 1 : 0) +
        (candidate.probability !== null ? 1 : 0);

      if (candidateScore > existingScore) map.set(k, candidate);
    }
  }

  return map;
}

function enrichRow(row, meta) {
  if (!row || typeof row !== "object") return row;
  if (market(row) !== "hitter_fantasy_score" || side(row) !== "LESS") return row;

  const m = meta.get(key(row));
  if (!m) return row;

  const mergedReasons = Array.from(new Set([
    ...(Array.isArray(row.reasonCodes) ? row.reasonCodes : []),
    ...(Array.isArray(m.reasonCodes) ? m.reasonCodes : [])
  ]));

  return {
    ...row,
    team: s(row.team) || m.team || "",
    game: isUnknownGame(row.game) ? (m.game || row.game || "UNKNOWN_GAME") : row.game,
    probability: n(row.probability) ?? m.probability ?? null,
    prob: n(row.prob) ?? m.probability ?? null,
    overProb: n(row.overProb) ?? m.overProb ?? null,
    underProb: n(row.underProb) ?? m.underProb ?? null,
    sampleStatus: s(row.sampleStatus) || m.sampleStatus || "",
    lineupStatus: s(row.lineupStatus) || m.lineupStatus || "",
    riskStatus: s(row.riskStatus) || m.riskStatus || "",
    reasonCodes: mergedReasons,
    metadataSource: m.sourceFile
  };
}

function enrichDeep(v, meta) {
  if (Array.isArray(v)) return v.map(x => enrichDeep(x, meta));
  if (!v || typeof v !== "object") return v;

  let out = { ...v };
  if (player(out) && market(out)) out = enrichRow(out, meta);

  for (const [k, val] of Object.entries(out)) {
    if (val && typeof val === "object") out[k] = enrichDeep(val, meta);
  }

  return out;
}

function pct(v) {
  const x = n(v);
  return x === null ? "?" : `${(x * 100).toFixed(1)}%`;
}

function rowLine(r) {
  const prob = n(r.probability ?? r.prob);
  return [
    `${player(r)} | ${s(r.team) || "?"} | ${s(r.game) || "UNKNOWN_GAME"}`,
    `${market(r)} ${side(r)} ${line(r)}`,
    `prob=${prob === null ? "?" : pct(prob)}`,
    `actual=${r.actual ?? r.actualValue ?? "?"}`,
    `result=${s(r.result || "ungraded")}`
  ].join(" | ");
}

const data = readJson(FILE, null);
if (!data) {
  console.error(`missing ${FILE}`);
  process.exit(1);
}

const meta = buildMetaMap();
const enriched = enrichDeep(data, meta);

const eligible = Array.isArray(enriched.eligible) ? enriched.eligible : [];
const beforeUnknown = flat(data).filter(r => market(r) === "hitter_fantasy_score" && side(r) === "LESS" && isUnknownGame(r.game)).length;
const afterUnknown = flat(enriched).filter(r => market(r) === "hitter_fantasy_score" && side(r) === "LESS" && isUnknownGame(r.game)).length;
const filled = Math.max(0, beforeUnknown - afterUnknown);

enriched.metadataEnrichment = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  metaSources: META_SOURCES,
  metaKeys: meta.size,
  beforeUnknownGameRows: beforeUnknown,
  afterUnknownGameRows: afterUnknown,
  filledGameRows: filled
};

const lines = [];
lines.push("FANTASY LESS PROMOTION CANDIDATES");
lines.push("=================================");
lines.push(`generatedAt=${enriched.generatedAt || enriched.metadataEnrichment.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`gateDecision=${enriched.gateDecision || "UNKNOWN"}`);
lines.push(`sourceFile=${enriched.sourceFile || "unknown"}`);
lines.push(`eligible=${eligible.length || enriched.eligible || 0}`);
lines.push(`metadataFilledGames=${filled}`);
lines.push(`unknownGamesRemaining=${afterUnknown}`);
lines.push("");
lines.push("ELIGIBLE SAMPLE");
lines.push("---------------");
for (const r of eligible.slice(0, 40)) lines.push(rowLine(r));

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
  eligible: eligible.length
});
