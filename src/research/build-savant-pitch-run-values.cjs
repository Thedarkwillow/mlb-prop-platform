const fs = require("fs");

const OUT = "data/savant/pitch-type-run-values.json";
const YEAR = process.env.SEASON || new Date().getFullYear();

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizePlayerName(v) {
  const raw = String(v || "").trim();
  if (raw.includes(",")) {
    const [last, first] = raw.split(",").map(x => x.trim());
    if (first && last) return `${first} ${last}`;
  }
  return raw;
}

function keyName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function n(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const x = Number(String(v).replace("%", "").replace(",", ""));
  return Number.isFinite(x) ? x : fallback;
}

function csvParse(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const parseLine = line => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], nx = line[i + 1];
      if (c === '"' && q && nx === '"') { cur += '"'; i++; }
      else if (c === '"') q = !q;
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ""));
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i]);
    return row;
  });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 MLB prop context bot",
      "accept": "text/csv,text/plain,*/*"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

function getAny(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
  }
  return null;
}

function normalizePitchType(v) {
  const s = String(v || "").toUpperCase();
  if (["FF", "FA", "4-SEAMER", "4-SEAM", "FOUR-SEAMER", "FOUR-SEAM"].includes(s)) return "FB";
  if (["SI", "SINKER"].includes(s)) return "SI";
  if (["FC", "CT", "CUTTER"].includes(s)) return "CT";
  if (["SL", "SLIDER", "ST"].includes(s)) return "SL";
  if (["CU", "KC", "CB", "CURVE", "CURVEBALL", "KNUCKLE-CURVE"].includes(s)) return s === "KC" ? "KC" : "CU";
  if (["CH", "CHANGEUP"].includes(s)) return "CH";
  if (["FS", "SPLITTER", "SPLIT-FINGER"].includes(s)) return "SP";
  return s || null;
}

function buildFromRows(rows, type) {
  const byName = {};

  for (const row of rows) {
    const name = normalizePlayerName(getAny(row, ["player_name", "last_name, first_name", "Player", "Name", "player"]));
    const pitch = normalizePitchType(getAny(row, ["pitch_type", "Pitch Type", "pitchType", "pitch_name", "Pitch"]));
    if (!name || !pitch) continue;

    const k = keyName(name);
    byName[k] ||= {
      name,
      type,
      pitchTypeRunValues: {},
      pitchTypeXwoba: {},
      pitchTypeWhiff: {},
      pitchTypeHardHit: {},
      rawPitchTypes: {}
    };

    const runValue = n(getAny(row, ["run_value", "Run Value", "rv", "RV", "runValue"]));
    const xwoba = n(getAny(row, ["xwoba", "xwOBA", "est_woba", "estimated_woba_using_speedangle"]));
    const whiff = n(getAny(row, ["whiff_percent", "Whiff%", "whiffRate"]));
    const hardHit = n(getAny(row, ["hard_hit_percent", "Hard Hit%", "hardHitRate"]));

    if (runValue !== null) byName[k].pitchTypeRunValues[pitch] = runValue;
    if (xwoba !== null) byName[k].pitchTypeXwoba[pitch] = xwoba;
    if (whiff !== null) byName[k].pitchTypeWhiff[pitch] = whiff;
    if (hardHit !== null) byName[k].pitchTypeHardHit[pitch] = hardHit;
    byName[k].rawPitchTypes[pitch] = row;
  }

  return byName;
}

async function main() {
  const sources = [];
  const errors = [];
  const local = read("data/savant/pitch-type-matchups.json", {});
  let hitterRows = [];
  let pitcherRows = [];

  // Try known public CSV-style endpoints defensively.
  const urls = [
    {
      type: "batter",
      url: `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=batter&year=${YEAR}&csv=true`
    },
    {
      type: "pitcher",
      url: `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&year=${YEAR}&csv=true`
    }
  ];

  for (const src of urls) {
    try {
      const txt = await fetchText(src.url);
      const rows = csvParse(txt);
      if (src.type === "batter") hitterRows = rows;
      if (src.type === "pitcher") pitcherRows = rows;
      sources.push({ ...src, ok: true, rows: rows.length });
    } catch (e) {
      errors.push({ source: src.type, error: String(e.message || e) });
      sources.push({ ...src, ok: false, rows: 0 });
    }
  }

  const byBatter = buildFromRows(hitterRows, "batter");
  const byPitcher = buildFromRows(pitcherRows, "pitcher");

  // Preserve local existing matchup file as fallback metadata.
  const out = {
    generatedAt: new Date().toISOString(),
    season: YEAR,
    recordType: "savant_pitch_type_run_values_v1",
    sources,
    errors,
    byBatter,
    byPitcher,
    coverage: {
      batterRows: hitterRows.length,
      pitcherRows: pitcherRows.length,
      battersWithRunValues: Object.values(byBatter).filter(x => Object.keys(x.pitchTypeRunValues).length).length,
      pitchersWithRunValues: Object.values(byPitcher).filter(x => Object.keys(x.pitchTypeRunValues).length).length,
      localPitchMatchupsPresent: Boolean(local.matchups || local.rows)
    },
    notes: [
      "Uses Baseball Savant pitch arsenal stats when CSV endpoint is available.",
      "Run values are normalized to FB/SI/CT/SL/CU/KC/CH/SP.",
      "Fail-soft: if Savant endpoint shape changes, the file writes with errors and does not break the main pipeline."
    ]
  };

  write(OUT, out);

  console.log("SAVANT PITCH-TYPE RUN VALUES");
  console.log("============================");
  console.log("Wrote", OUT);
  console.table([out.coverage]);
  console.table(sources);
  if (errors.length) console.table(errors);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
