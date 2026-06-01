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

const path = require("path");

const DATE = getDateArg();

const INPUT = "data/savant/pitcher-velocity-trends.json";
const STAFFS = "data/context/pitching-staffs.json";
const RAW_DIR = "data/savant/velocity-raw";

const OUT_COMPACT = "data/savant/pitcher-arsenal-compact.json";
const OUT_BULLPEN = "data/savant/bullpen-arsenal-compact.json";
const OUT_STARTERS = "data/savant/starter-arsenal-compact.json";
const OUT_REPORT = "outputs/context/arsenal-cache-report-latest.json";
const OUT_REPORT_DATED = `outputs/context/arsenal-cache-report-${DATE}.json`;

const RETENTION_DAYS = Number(process.env.SAVANT_RAW_RETENTION_DAYS || 10);
const MAX_PITCH_TYPES = Number(process.env.SAVANT_COMPACT_MAX_PITCH_TYPES || 8);
const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "1" || String(process.env.DRY_RUN || "").toLowerCase() === "true";

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

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function n(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function round(v, d = 3) {
  const x = n(v, null);
  return x === null ? null : Number(x.toFixed(d));
}

function roleIndexFromStaffs(staffs) {
  const idx = new Map();

  for (const [teamKey, team] of Object.entries(staffs.teams || {})) {
    const teamCode = String(team.team || teamKey || "").toUpperCase();

    const starter = team.probableStarter || team.startingPitcher || null;
    if (starter?.name) {
      idx.set(norm(starter.name), {
        role: "probable_starter",
        team: starter.team || teamCode,
        opponent: starter.opponent || team.opponent || null,
        hand: starter.hand || null
      });
    }

    for (const p of Array.isArray(team.bullpen) ? team.bullpen : []) {
      if (!p?.name) continue;
      idx.set(norm(p.name), {
        role: "bullpen",
        team: p.team || teamCode,
        opponent: p.opponent || team.opponent || null,
        hand: p.hand || null,
        bullpenRole: p.role || p.bullpenRole || null
      });
    }
  }

  return idx;
}

function compactPitchTypes(window) {
  const pitchTypes = window?.pitchTypes || {};
  return Object.entries(pitchTypes)
    .map(([pitchType, r]) => ({
      pitchType,
      pitches: n(r.pitches, 0),
      usage: round(r.pitchPercent ?? r.usage, 3),
      velocity: round(r.velocity, 3),
      spinRate: round(r.spinRate, 3),
      whiffRate: round(r.whiffRate, 3),
      xwoba: round(r.xwoba, 3),
      xslg: round(r.xslg, 3),
      xba: round(r.xba, 3),
      hardHitRate: round(r.hardHitRate, 3),
      barrelRate: round(r.barrelRate, 3),
      runValuePer100: round(r.runValuePer100, 3)
    }))
    .filter(r => r.pitchType && r.pitches > 0)
    .sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0) || (b.pitches ?? 0) - (a.pitches ?? 0))
    .slice(0, MAX_PITCH_TYPES);
}

function compactPitcher(rec, roleMeta = {}) {
  const season = rec.windows?.season || {};
  const last30 = rec.windows?.last30 || {};
  const last15 = rec.windows?.last15 || {};
  const last7 = rec.windows?.last7 || {};

  const player =
    rec.pitcher ||
    rec.player ||
    rec.name ||
    rec.fullName ||
    null;

  const role = rec.role || roleMeta.role || "unknown";

  return {
    player,
    pitcher: player,
    pitcherId: rec.pitcherId || rec.id || rec.playerId || null,
    playerKey: rec.playerKey || norm(player),
    team: rec.team || roleMeta.team || null,
    opponent: rec.opponent || roleMeta.opponent || null,
    hand: rec.hand || roleMeta.hand || null,
    role,
    bullpenRole: rec.bullpenRole || roleMeta.bullpenRole || null,
    gamePk: rec.gamePk || null,

    trend: rec.trend || "unknown",
    baselineFastballVelo: round(rec.baselineFastballVelo),
    currentFastballVelo: round(rec.currentFastballVelo),
    velocityDelta: round(rec.velocityDelta),

    season: {
      totalPitches: n(season.totalPitches, 0),
      pitchTypeCount: n(season.pitchTypeCount, 0),
      primaryFastball: season.primaryFastball || null,
      primaryFastballVelo: round(season.primaryFastballVelo),
      pitchTypes: compactPitchTypes(season)
    },
    last30: {
      totalPitches: n(last30.totalPitches, 0),
      primaryFastballVelo: round(last30.primaryFastballVelo),
      pitchTypes: compactPitchTypes(last30)
    },
    last15: {
      totalPitches: n(last15.totalPitches, 0),
      primaryFastballVelo: round(last15.primaryFastballVelo),
      pitchTypes: compactPitchTypes(last15)
    },
    last7: {
      totalPitches: n(last7.totalPitches, 0),
      primaryFastballVelo: round(last7.primaryFastballVelo),
      pitchTypes: compactPitchTypes(last7)
    }
  };
}

function groupByTeam(rows) {
  const byTeam = {};
  for (const r of rows) {
    const team = String(r.team || "UNKNOWN").toUpperCase();
    byTeam[team] ||= [];
    byTeam[team].push(r);
  }
  for (const team of Object.keys(byTeam)) {
    byTeam[team].sort((a, b) =>
      String(a.role).localeCompare(String(b.role)) ||
      String(a.pitcher || "").localeCompare(String(b.pitcher || ""))
    );
  }
  return byTeam;
}

function rawRetention() {
  const result = {
    rawDir: RAW_DIR,
    retentionDays: RETENTION_DAYS,
    dryRun: DRY_RUN,
    scanned: 0,
    deleted: 0,
    kept: 0,
    deleteBytes: 0,
    errors: []
  };

  if (!fs.existsSync(RAW_DIR)) return result;

  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  for (const name of fs.readdirSync(RAW_DIR)) {
    const file = path.join(RAW_DIR, name);
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      result.scanned++;
      if (st.mtimeMs < cutoff) {
        result.deleteBytes += st.size;
        if (!DRY_RUN) fs.unlinkSync(file);
        result.deleted++;
      } else {
        result.kept++;
      }
    } catch (err) {
      result.errors.push({ file, error: String(err.message || err) });
    }
  }

  return result;
}

const source = readJson(INPUT, {});
const staffs = readJson(STAFFS, {});
const roleIdx = roleIndexFromStaffs(staffs);

const pitcherRecords = Object.values(source.pitchers || {});
const compact = pitcherRecords
  .map(rec => {
    const player = rec.pitcher || rec.player || rec.name || rec.fullName || "";
    return compactPitcher(rec, roleIdx.get(norm(player)) || {});
  })
  .filter(r => r.pitcher);

const starters = compact.filter(r => r.role === "probable_starter" || r.role === "starter");
const bullpen = compact.filter(r => r.role === "bullpen");

const rawCleanup = rawRetention();

const compactOut = {
  generatedAt: new Date().toISOString(),
  date: source.date || DATE,
  sourceFile: INPUT,
  mode: "compact_pitcher_arsenal_cache",
  note: "Compact cache for model use. Raw Savant CSVs are retained only temporarily.",
  retention: rawCleanup,
  counts: {
    sourcePitchers: pitcherRecords.length,
    compactPitchers: compact.length,
    starters: starters.length,
    bullpen: bullpen.length,
    unknownRole: compact.filter(r => r.role === "unknown").length
  },
  pitchers: Object.fromEntries(compact.map(r => [r.playerKey, r])),
  byTeam: groupByTeam(compact)
};

const bullpenOut = {
  generatedAt: compactOut.generatedAt,
  date: compactOut.date,
  sourceFile: OUT_COMPACT,
  mode: "compact_bullpen_arsenal_cache",
  counts: {
    bullpenPitchers: bullpen.length,
    teams: Object.keys(groupByTeam(bullpen)).length
  },
  byTeam: groupByTeam(bullpen),
  pitchers: Object.fromEntries(bullpen.map(r => [r.playerKey, r]))
};

const startersOut = {
  generatedAt: compactOut.generatedAt,
  date: compactOut.date,
  sourceFile: OUT_COMPACT,
  mode: "compact_starter_arsenal_cache",
  counts: {
    starters: starters.length,
    teams: Object.keys(groupByTeam(starters)).length
  },
  byTeam: groupByTeam(starters),
  pitchers: Object.fromEntries(starters.map(r => [r.playerKey, r]))
};

const report = {
  generatedAt: compactOut.generatedAt,
  date: compactOut.date,
  sourceFile: INPUT,
  outputs: {
    compact: OUT_COMPACT,
    bullpen: OUT_BULLPEN,
    starters: OUT_STARTERS
  },
  counts: compactOut.counts,
  rawCleanup,
  diskProtection: {
    rawCsvRetentionDays: RETENTION_DAYS,
    compactMaxPitchTypesPerWindow: MAX_PITCH_TYPES,
    rawDeletedThisRun: rawCleanup.deleted,
    rawDeleteBytesThisRun: rawCleanup.deleteBytes
  }
};

writeJson(OUT_COMPACT, compactOut);
writeJson(OUT_BULLPEN, bullpenOut);
writeJson(OUT_STARTERS, startersOut);
writeJson(OUT_REPORT, report);
writeJson(OUT_REPORT_DATED, report);

console.log("SAVANT ARSENAL COMPACT CACHE");
console.log("============================");
console.log("date:", compactOut.date);
console.table([compactOut.counts]);
console.log("raw cleanup:", rawCleanup);
console.log("saved:", OUT_COMPACT);
console.log("saved:", OUT_BULLPEN);
console.log("saved:", OUT_STARTERS);
console.log("saved:", OUT_REPORT);
