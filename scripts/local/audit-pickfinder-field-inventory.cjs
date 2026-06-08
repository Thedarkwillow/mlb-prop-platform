const fs = require("fs");
const path = require("path");

const SOURCES = {
  props: "outputs/pickfinder-mlb-props.json",
  popular: "outputs/pickfinder-mlb-popular.json",
  discrepancies: "outputs/pickfinder-mlb-discrepancies.json",
  odds: "outputs/pickfinder-mlb-odds.json",
  playerDetails: "outputs/pickfinder-mlb-player-details.json",
  lineups: "data/context/pickfinder-lineups.json",
  fullCapture: "outputs/pickfinder-mlb-full-capture.json"
};

const OUT_JSON = "outputs/pickfinder-field-inventory.json";
const OUT_TXT = "outputs/pickfinder-field-inventory.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function flattenRows(v, out = []) {
  if (!v) return out;

  if (Array.isArray(v)) {
    for (const x of v) flattenRows(x, out);
    return out;
  }

  if (typeof v !== "object") return out;

  const keys = Object.keys(v);
  const looksLikeRow =
    keys.some(k => /player|name|team|stat|market|line|projection|fixture|game|odds|hitRate|difference|consensus|lineup|batting|position/i.test(k)) &&
    keys.length >= 2;

  if (looksLikeRow) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flattenRows(val, out);
  }

  return out;
}

function collectFields(rows) {
  const fields = new Map();

  function addField(pathKey, value) {
    if (!fields.has(pathKey)) {
      fields.set(pathKey, {
        field: pathKey,
        count: 0,
        types: {},
        examples: []
      });
    }

    const rec = fields.get(pathKey);
    rec.count++;
    const t = typeOf(value);
    rec.types[t] = (rec.types[t] || 0) + 1;

    if (
      rec.examples.length < 5 &&
      value !== undefined &&
      value !== null &&
      typeof value !== "object"
    ) {
      const ex = String(value);
      if (!rec.examples.includes(ex)) rec.examples.push(ex.slice(0, 120));
    }
  }

  function walk(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return;

    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      addField(p, v);

      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v, p);
      }

      if (Array.isArray(v)) {
        addField(`${p}[]`, v.length);
        for (const item of v.slice(0, 5)) {
          if (item && typeof item === "object") walk(item, `${p}[]`);
        }
      }
    }
  }

  for (const row of rows) walk(row);

  return Array.from(fields.values()).sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

function topLevelShape(data) {
  if (!data) return { type: "missing" };
  if (Array.isArray(data)) return { type: "array", length: data.length };
  if (typeof data === "object") {
    return {
      type: "object",
      keys: Object.keys(data).slice(0, 80),
      keyCount: Object.keys(data).length
    };
  }
  return { type: typeof data };
}

const result = {
  generatedAt: new Date().toISOString(),
  sources: {},
  recommendedModelFields: {}
};

for (const [name, file] of Object.entries(SOURCES)) {
  const data = readJson(file, null);
  let stat = { exists: false, file };

  try {
    const st = fs.statSync(file);
    stat = {
      exists: true,
      file,
      size: st.size,
      mtime: st.mtime.toISOString()
    };
  } catch {}

  const rows = flattenRows(data);
  const fields = collectFields(rows);

  result.sources[name] = {
    ...stat,
    shape: topLevelShape(data),
    rowCount: rows.length,
    fieldCount: fields.length,
    fields
  };
}

const usefulHints = [
  "hitRateLast5",
  "hitRateLast10",
  "hitRateLast15",
  "hitRateH2H",
  "averageLast10",
  "differenceLast10",
  "differencePercent",
  "streak",
  "defenseRank",
  "consensus_over_ip",
  "consensus_under_ip",
  "favorite_count_over",
  "favorite_count_under",
  "best_over_odds",
  "best_under_odds",
  "line",
  "stat",
  "projection",
  "player",
  "team",
  "opponent",
  "fixture",
  "battingOrder",
  "position",
  "status",
  "homeAway",
  "moneyline",
  "spread",
  "total"
];

for (const [source, info] of Object.entries(result.sources)) {
  const matched = [];
  for (const f of info.fields || []) {
    const low = f.field.toLowerCase();
    if (usefulHints.some(h => low.includes(h.toLowerCase()))) {
      matched.push(f);
    }
  }
  result.recommendedModelFields[source] = matched.slice(0, 80);
}

writeJson(OUT_JSON, result);

const lines = [];
lines.push("PICKFINDER FIELD INVENTORY");
lines.push("==========================");
lines.push(`generatedAt=${result.generatedAt}`);
lines.push("");

for (const [name, info] of Object.entries(result.sources)) {
  lines.push(name.toUpperCase());
  lines.push("-".repeat(name.length));
  lines.push(`file: ${info.file}`);
  lines.push(`exists: ${info.exists}`);
  if (info.exists) {
    lines.push(`size: ${info.size}`);
    lines.push(`mtime: ${info.mtime}`);
  }
  lines.push(`shape: ${info.shape.type}`);
  if (info.shape.keyCount !== undefined) lines.push(`topLevelKeys: ${info.shape.keyCount}`);
  if (info.shape.keys) lines.push(`keys: ${info.shape.keys.join(", ")}`);
  lines.push(`rowCount: ${info.rowCount}`);
  lines.push(`fieldCount: ${info.fieldCount}`);
  lines.push("");

  lines.push("Top fields:");
  for (const f of (info.fields || []).slice(0, 60)) {
    lines.push(`- ${f.field} | count=${f.count} | types=${JSON.stringify(f.types)} | examples=${f.examples.join(" / ")}`);
  }

  lines.push("");
  lines.push("Recommended/model-relevant fields:");
  for (const f of (result.recommendedModelFields[name] || []).slice(0, 50)) {
    lines.push(`- ${f.field} | count=${f.count} | examples=${f.examples.join(" / ")}`);
  }
  lines.push("");
}

lines.push("SUMMARY");
lines.push("-------");
lines.push("Use props for trend fields: hit rates, average, difference, consensus, favorites, best odds.");
lines.push("Use lineups for batting order, position, confirmed status, opponent/game context.");
lines.push("Use popular/discrepancies as public-interest and market-movement signals, not official plays by themselves.");
lines.push("Use odds only after parser/index fix, because current coverage audit matched 0 board players.");
lines.push("Use playerDetails only after schema/name/team parser fix, because current coverage audit matched low despite many rows.");
lines.push("");
lines.push(`saved: ${OUT_JSON}`);
lines.push(`saved: ${OUT_TXT}`);

writeText(OUT_TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: result.generatedAt,
  sources: Object.fromEntries(Object.entries(result.sources).map(([k, v]) => [k, {
    exists: v.exists,
    rowCount: v.rowCount,
    fieldCount: v.fieldCount,
    file: v.file
  }])),
  outJson: OUT_JSON,
  outTxt: OUT_TXT
});
