const fs = require("fs");
function getDateArg() {
  const argvDate = process.argv.find(a => /^--date=/.test(a));
  if (argvDate) return argvDate.split("=")[1];
  const positional = process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return (
    process.env.SLATE_DATE ||
    process.env.npm_config_date ||
    positional ||
    new Date().toISOString().slice(0, 10)
  );
}

const https = require("https");

const DATE = getDateArg();

const YEAR = Number(DATE.slice(0, 4));
const SEASON_START = `${YEAR}-03-01`;

const PROBABLES = "data/context/probable-pitcher-hands.json";
const STAFFS = "data/context/pitching-staffs.json";
const BOARD = "outputs/priced-board.json";
const TARGETS = "outputs/context/real-pitch-type-target-list-latest.json";
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

function isPitcherPropMarket(row) {
  const m = String(row.market || row.stat || row.stat_short || "").toLowerCase();
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();

  if (sourceType === "pitcher") return true;
  if (sourceType === "batter" || sourceType === "hitter") return false;

  return (
    m.includes("pitching_outs") ||
    m.includes("hits_allowed") ||
    m.includes("earned_runs_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitcher_fantasy")
  );
}

function inferOpponent(row) {
  const team = String(row.team || row.resolvedTeam || "").toUpperCase().trim();
  const raw = String(row.resolvedGame || row.game || "");
  if (!raw.includes("@")) return row.opponent || row.opponentTeam || null;

  const parts = raw.split("@").map(x => String(x || "").toUpperCase().trim());
  if (parts.length !== 2) return row.opponent || row.opponentTeam || null;
  if (parts[0] === team) return parts[1];
  if (parts[1] === team) return parts[0];

  return row.opponent || row.opponentTeam || null;
}

function collectPitchers() {
  const staffs = read(STAFFS, {});
  const probables = read(PROBABLES, {});
  const board = read(BOARD, []);
  const out = new Map();
  const idByName = new Map();

  function addIdName(name, id) {
    if (!name || !id) return;
    idByName.set(norm(name), id);
  }

  function addPitcher(p = {}, fallback = {}) {
    const name =
      p.pitcher ||
      p.name ||
      p.player ||
      p.fullName ||
      p.opposingPitcher ||
      p.probablePitcher ||
      p.starter ||
      p.opponentStarter ||
      fallback.pitcher ||
      fallback.name;

    if (!name) return;

    const team = p.team || p.resolvedTeam || fallback.team || null;
    const id =
      p.id ||
      p.pitcherId ||
      p.playerId ||
      p.mlbamId ||
      p.mlbId ||
      p.mlb_id ||
      idByName.get(norm(name)) ||
      null;

    const rec = {
      id,
      pitcher: name,
      team,
      opponent: p.opponent || p.opponentTeam || fallback.opponent || null,
      hand: p.hand || p.pitcherHand || p.opposingPitcherHand || fallback.hand || null,
      gamePk: p.gamePk || p.resolvedGamePk || fallback.gamePk || null,
      role: p.role || fallback.role || "probable_starter",
      source: fallback.source || p.source || "unknown"
    };

    const key = id ? `id:${id}` : `name:${norm(name)}:${team || ""}`;
    const prev = out.get(key);

    out.set(key, {
      ...prev,
      ...rec,
      id: prev?.id || rec.id,
      pitcher: prev?.pitcher || rec.pitcher,
      team: prev?.team || rec.team,
      opponent: prev?.opponent || rec.opponent,
      hand: prev?.hand || rec.hand,
      gamePk: prev?.gamePk || rec.gamePk,
      role: prev?.role === "probable_starter" ? prev.role : rec.role,
      source: [prev?.source, rec.source].filter(Boolean).join("|")
    });

    addIdName(name, id);
  }

  // 1) Existing pitching-staffs source.
  for (const t of Object.values(staffs.teams || {})) {
    const all = [
      t.probableStarter,
      t.startingPitcher,
      t.probablePitcher,
      t.starter,
      ...(Array.isArray(t.bullpen) ? t.bullpen : [])
    ].filter(Boolean);

    for (const p of all) {
      addPitcher(p, {
        team: p.team || t.team,
        opponent: p.opponent || t.opponent,
        hand: p.hand || null,
        role: p.role || "staff",
        source: "pitching_staffs"
      });
    }
  }

  // 2) Probable pitcher file: own starter by team.
  for (const [team, p] of Object.entries(probables.pitcherByTeam || {})) {
    addPitcher(p, {
      team,
      opponent: p?.opponent || null,
      hand: p?.hand || null,
      gamePk: p?.gamePk || null,
      role: "probable_starter",
      source: "probable_pitcher_hands.pitcherByTeam"
    });
  }

  // 3) Probable pitcher file: opposing pitcher by team.
  for (const [team, p] of Object.entries(probables.opponentPitcherByTeam || {})) {
    addPitcher(p, {
      team: p?.opponent || null,
      opponent: team,
      hand: p?.hand || null,
      gamePk: p?.gamePk || null,
      role: "probable_starter",
      source: "probable_pitcher_hands.opponentPitcherByTeam"
    });
  }

  // 4) Current priced board opposing pitchers.
  for (const row of Array.isArray(board) ? board : []) {
    if (row.recordType && row.recordType !== "merged_prop") continue;

    const name =
      row.opposingPitcher ||
      row.opponentPitcher ||
      row.probablePitcher ||
      row.handednessContext?.opposingPitcher ||
      row.handednessAdjustment?.opposingPitcher ||
      row.starter ||
      row.opponentStarter;

    if (!name) continue;

    addPitcher({
      pitcher: name,
      id:
        row.opposingPitcherId ||
        row.opponentPitcherId ||
        row.probablePitcherId ||
        row.pitcherId ||
        row.opposingPitcherMlbamId ||
        row.opponentPitcherMlbamId ||
        null,
      team: row.opponentTeam || null,
      opponent: row.team || row.resolvedTeam || null,
      hand: row.pitcherHand || row.opposingPitcherHand || null,
      gamePk: row.gamePk || row.resolvedGamePk || null,
      role: "probable_starter",
      source: "priced_board"
    });
  }


  // Current priced board pitcher-prop players themselves.
  for (const row of Array.isArray(board) ? board : []) {
    if (row.recordType && row.recordType !== "merged_prop") continue;
    if (!isPitcherPropMarket(row)) continue;

    const name =
      row.player ||
      row.playerName ||
      row.name ||
      row.pitcher ||
      row.pitcherName;

    if (!name) continue;

    addPitcher({
      pitcher: name,
      id:
        row.playerId ||
        row.player_id ||
        row.mlbamId ||
        row.mlbId ||
        row.mlb_id ||
        row.pitcherId ||
        row.pitcher_id ||
        row.ppPlayerId ||
        null,
      team: row.team || row.resolvedTeam || null,
      opponent: inferOpponent(row),
      hand:
        row.pitcherHand ||
        row.hand ||
        row.throwHand ||
        row.playerHand ||
        row.handednessContext?.pitcherHand ||
        null,
      gamePk: row.gamePk || row.resolvedGamePk || null,
      role: "probable_starter",
      source: "priced_board_pitcher_prop"
    });
  }

  // Current real pitch-type gap targets.
  const targets = read(TARGETS, {});
  for (const t of targets.pitcherArsenalTargets || []) {
    if (!t?.pitcher) continue;

    addPitcher({
      pitcher: t.pitcher,
      id:
        t.mlbamId ||
        t.pitcherId ||
        t.playerId ||
        t.mlbId ||
        null,
      team: t.team || null,
      opponent: t.opponent || null,
      hand: t.hand || null,
      gamePk: t.gamePk || null,
      role: "probable_starter",
      source: "real_pitch_type_target_list"
    });
  }

  const max = Number(process.env.SAVANT_MAX_PITCHERS || 180);
  const values = [...out.values()];

  const prioritySource = p => {
    const source = String(p.source || "");
    if (source.includes("real_pitch_type_target_list")) return 0;
    if (source.includes("priced_board_pitcher_prop")) return 1;
    if (p.role === "probable_starter") return 2;
    return 3;
  };

  return values
    .sort((a, b) => {
      const pa = prioritySource(a);
      const pb = prioritySource(b);
      if (pa !== pb) return pa - pb;

      const aid = a.id ? 0 : 1;
      const bid = b.id ? 0 : 1;
      if (aid !== bid) return aid - bid;

      return String(a.pitcher || "").localeCompare(String(b.pitcher || ""));
    })
    .slice(0, max);
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

  const pitchers = collectPitchers();
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
