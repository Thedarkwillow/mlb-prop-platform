const fs = require("fs");
const https = require("https");

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  new Date().toISOString().slice(0, 10);

const YEAR = Number(DATE.slice(0, 4));
const SEASON_START = `${YEAR}-03-01`;

const PROBABLES = "data/context/probable-pitcher-hands.json";
const OUT = "data/savant/pitcher-velocity-trends.json";
const RAW_DIR = "data/savant/velocity-raw";

const FASTBALL_TYPES = new Set(["4-Seamer", "Sinker", "Cutter", "FF", "SI", "FC"]);
const PRIMARY_FB_ORDER = ["4-Seamer", "FF", "Sinker", "SI", "Cutter", "FC"];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function dateMinus(date, days) {
  const t = Date.parse(date + "T00:00:00Z");
  return new Date(t - days * 86400000).toISOString().slice(0, 10);
}

function csvUrl({ pitcherId, startDate, endDate }) {
  const params = new URLSearchParams({
    all: "true",
    player_type: "pitcher",
    group_by: "pitch-type",
    game_date_gt: startDate,
    game_date_lt: endDate,
    min_pitches: "0",
    min_results: "0",
    min_pas: "0",
    sort_col: "pitches",
    sort_order: "desc"
  });

  params.append("pitchers_lookup[]", String(pitcherId));
  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "mlb-prop-platform/1.0",
        "Accept": "text/csv,*/*"
      }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        resolve(body);
      });
    }).on("error", reject);
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];

    if (c === '"' && q && n === '"') {
      cur += '"';
      i++;
    } else if (c === '"') {
      q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }

  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim());
  const rows = [];

  for (const line of lines.slice(1)) {
    const vals = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i]);
    rows.push(row);
  }

  return rows;
}

function getAny(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const loose = keys.find(k =>
      k.toLowerCase().replace(/[^a-z0-9]/g, "") ===
      name.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    if (loose) return row[loose];
  }
  return null;
}

function num(v) {
  const n = Number(String(v ?? "").replace("%", "").replace(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function pitchName(row) {
  return String(
    getAny(row, [
      "pitch_name",
      "pitch_type",
      "pitchType",
      "pitches",
      "pitch"
    ]) || ""
  ).trim();
}

function standardPitchTypeRow(row) {
  const name = pitchName(row);
  const pitches = num(getAny(row, ["total_pitches", "pitches", "count"]));
  const pitchPercent = num(getAny(row, ["pitch_percent", "pitchUsage", "usage"]));
  const velocity = num(getAny(row, ["velocity", "release_speed", "effective_speed"]));
  const spinRate = num(getAny(row, ["spin_rate", "release_spin_rate"]));
  const whiffRate = num(getAny(row, ["swing_miss_percent", "whiff_percent"]));
  const xwoba = num(getAny(row, ["xwoba"]));
  const xslg = num(getAny(row, ["xslg"]));
  const xba = num(getAny(row, ["xba"]));
  const hardHitRate = num(getAny(row, ["hardhit_percent", "hard_hit_percent"]));
  const barrelRate = num(getAny(row, ["barrels_per_bbe_percent", "barrel_batted_rate"]));
  const runValuePer100 = num(getAny(row, ["pitcher_run_value_per_100"]));

  return {
    pitchType: name,
    pitches,
    pitchPercent,
    velocity,
    spinRate,
    whiffRate,
    xwoba,
    xslg,
    xba,
    hardHitRate,
    barrelRate,
    runValuePer100
  };
}

function round(v, d = 3) {
  return v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d));
}

function summarize(rows, label, startDate, endDate) {
  const pitchTypes = {};

  for (const row of rows) {
    if (!row.pitchType) continue;
    pitchTypes[row.pitchType] = row;
  }

  const fbRows = rows.filter(r => FASTBALL_TYPES.has(r.pitchType));
  const primaryFastball =
    PRIMARY_FB_ORDER.find(t => pitchTypes[t]?.pitches >= 5) ||
    fbRows.sort((a, b) => (b.pitches || 0) - (a.pitches || 0))[0]?.pitchType ||
    null;

  const totalPitches = rows.reduce((s, r) => s + (r.pitches || 0), 0);

  return {
    label,
    startDate,
    endDate,
    totalPitches,
    pitchTypeCount: rows.length,
    primaryFastball,
    primaryFastballVelo: primaryFastball ? pitchTypes[primaryFastball]?.velocity ?? null : null,
    pitchTypes
  };
}

function trendLabel(delta) {
  if (delta == null) return "unknown";
  if (delta <= -1.5) return "major_drop";
  if (delta <= -0.8) return "drop";
  if (delta >= 1.5) return "major_gain";
  if (delta >= 0.8) return "gain";
  return "stable";
}

async function pullWindow(pitcher, label, startDate, endDate) {
  const url = csvUrl({ pitcherId: pitcher.id, startDate, endDate });
  const text = await fetchText(url);

  const file = `${RAW_DIR}/${DATE}-${pitcher.id}-${norm(pitcher.pitcher)}-${label}.csv`;
  fs.writeFileSync(file, text);

  const rawRows = parseCsv(text);
  const rows = rawRows
    .map(standardPitchTypeRow)
    .filter(r => r.pitchType && r.pitches != null);

  return summarize(rows, label, startDate, endDate);
}

function collectProbables(probables) {
  const out = [];

  for (const [team, rec] of Object.entries(probables.pitcherByTeam || {})) {
    if (!rec?.pitcher) continue;
    out.push({
      team,
      pitcher: rec.pitcher,
      id: rec.id || null,
      hand: rec.hand || null,
      opponent: rec.opponent || null,
      gamePk: rec.gamePk || null
    });
  }

  const seen = new Set();
  return out.filter(p => {
    const k = `${p.team}:${p.pitcher}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync("data/savant", { recursive: true });

  const probables = read(PROBABLES, {});
  const pitchers = collectProbables(probables);
  const withIds = pitchers.filter(p => p.id);
  const missingIds = pitchers.filter(p => !p.id);

  const records = {};
  const errors = [];

  for (const p of withIds) {
    try {
      console.log(`Pulling pitch arsenal windows: ${p.pitcher} (${p.team})...`);

      const season = await pullWindow(p, "season", SEASON_START, DATE);
      await sleep(350);

      const last30 = await pullWindow(p, "last30", dateMinus(DATE, 30), DATE);
      await sleep(350);

      const last15 = await pullWindow(p, "last15", dateMinus(DATE, 15), DATE);
      await sleep(350);

      const last7 = await pullWindow(p, "last7", dateMinus(DATE, 7), DATE);
      await sleep(650);

      const baseline = season.primaryFastballVelo;
      const current = last15.primaryFastballVelo ?? last30.primaryFastballVelo ?? last7.primaryFastballVelo;
      const delta = current != null && baseline != null ? current - baseline : null;

      records[norm(p.pitcher)] = {
        pitcher: p.pitcher,
        pitcherId: p.id,
        playerKey: norm(p.pitcher),
        team: p.team,
        opponent: p.opponent,
        hand: p.hand,
        gamePk: p.gamePk,
        baselineFastballVelo: round(baseline),
        currentFastballVelo: round(current),
        velocityDelta: round(delta),
        trend: trendLabel(delta),
        windows: { season, last30, last15, last7 }
      };
    } catch (err) {
      errors.push({
        pitcher: p.pitcher,
        team: p.team,
        id: p.id,
        error: String(err.message || err)
      });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    seasonStart: SEASON_START,
    source: "Baseball Savant Statcast Search CSV grouped by pitch-type",
    note: "Pitch arsenal + velocity cache. No probability movement applied yet.",
    probablePitchers: pitchers.length,
    pulledPitchers: withIds.length,
    missingIds: missingIds.map(p => ({
      team: p.team,
      pitcher: p.pitcher,
      opponent: p.opponent
    })),
    errors,
    pitchers: records
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("");
  console.log("SAVANT PITCHER VELOCITY / ARSENAL TRENDS");
  console.log("========================================");
  console.log(`Probables: ${pitchers.length}`);
  console.log(`With IDs: ${withIds.length}`);
  console.log(`Missing IDs: ${missingIds.length}`);
  console.log(`Records: ${Object.keys(records).length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Wrote ${OUT}`);

  console.table(Object.values(records).map(r => ({
    pitcher: r.pitcher,
    team: r.team,
    hand: r.hand,
    baseline: r.baselineFastballVelo,
    current: r.currentFastballVelo,
    delta: r.velocityDelta,
    trend: r.trend,
    seasonPitches: r.windows.season.totalPitches,
    pitchTypes: r.windows.season.pitchTypeCount,
    primaryFB: r.windows.season.primaryFastball
  })));

  if (errors.length) {
    console.log("");
    console.log("Errors:");
    console.table(errors);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
