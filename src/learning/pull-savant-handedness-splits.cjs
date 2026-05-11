const fs = require("fs");
const https = require("https");
const path = require("path");

const YEAR = process.env.SEASON || new Date().getFullYear();
const OUT = "data/savant/handedness-splits.json";
const RAW_DIR = "data/savant/handedness-raw";

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function num(v) {
  if (v == null) return null;
  const x = Number(String(v).replace("%", "").replace(",", "").trim());
  return Number.isFinite(x) ? x : null;
}

function csvUrl({ playerType, pitcherThrows = "", batterStands = "" }) {
  const params = new URLSearchParams({
    all: "true",
    player_type: playerType,
    group_by: "name",
    hfGT: "R|",
    hfSea: `${YEAR}|`,
    pitcher_throws: pitcherThrows,
    batter_stands: batterStands,
    min_pitches: "0",
    min_results: "0",
    min_pas: "0",
    sort_col: "pitches",
    sort_order: "desc",

    chk_stats_pa: "on",
    chk_stats_ba: "on",
    chk_stats_slg: "on",
    chk_stats_woba: "on",
    chk_stats_xba: "on",
    chk_stats_xslg: "on",
    chk_stats_xwoba: "on",
    chk_stats_k_percent: "on",
    chk_stats_bb_percent: "on",
    chk_stats_swing_miss_percent: "on",
    chk_stats_hardhit_percent: "on",
    chk_stats_barrel_percent: "on"
  });

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
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        resolve(body);
      });
    }).on("error", reject);
  });
}

function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return rows;

  function split(line) {
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

  const headers = split(lines[0]).map(h => h.trim());

  for (const line of lines.slice(1)) {
    const vals = split(line);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i]);
    rows.push(row);
  }

  return rows;
}

function getAny(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = keys.find(k => k === name);
    if (exact) return row[exact];

    const loose = keys.find(k =>
      k.toLowerCase().replace(/[^a-z0-9]/g, "") ===
      name.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    if (loose) return row[loose];
  }
  return null;
}

function playerName(row) {
  return getAny(row, ["player_name", "last_name, first_name", "Player", "player", "name"]);
}

function standardize(row) {
  return {
    player: playerName(row),
    playerKey: norm(playerName(row)),
    pa: num(getAny(row, ["pa", "PA"])),
    pitches: num(getAny(row, ["pitches", "Pitches"])),
    ba: num(getAny(row, ["ba", "BA"])),
    slg: num(getAny(row, ["slg", "SLG"])),
    woba: num(getAny(row, ["woba", "wOBA"])),
    xba: num(getAny(row, ["xba", "xBA"])),
    xslg: num(getAny(row, ["xslg", "xSLG"])),
    xwoba: num(getAny(row, ["xwoba", "xwOBA"])),
    kRate: num(getAny(row, ["k_percent", "k%", "K%", "strikeout_percent"])),
    bbRate: num(getAny(row, ["bb_percent", "bb%", "BB%", "walk_percent"])),
    whiffRate: num(getAny(row, ["swing_miss_percent", "whiff_percent", "Whiff%"])),
    hardHitRate: num(getAny(row, ["hardhit_percent", "hard_hit_percent", "HardHit%"])),
    barrelRate: num(getAny(row, ["barrel_percent", "Barrel%"]))
  };
}

function mergeSide(target, sideKey, rows) {
  for (const raw of rows) {
    const r = standardize(raw);
    if (!r.player || !r.playerKey) continue;

    if (!target[r.playerKey]) {
      target[r.playerKey] = {
        player: r.player,
        playerKey: r.playerKey
      };
    }

    target[r.playerKey][sideKey] = r;
  }
}

async function main() {
  mkdirp(RAW_DIR);
  mkdirp(path.dirname(OUT));

  const pulls = [
    {
      name: "batters_vs_lhp",
      playerType: "batter",
      pitcherThrows: "L",
      sideKey: "vsLHP",
      bucket: "batters"
    },
    {
      name: "batters_vs_rhp",
      playerType: "batter",
      pitcherThrows: "R",
      sideKey: "vsRHP",
      bucket: "batters"
    },
    {
      name: "pitchers_vs_lhb",
      playerType: "pitcher",
      batterStands: "L",
      sideKey: "vsLHB",
      bucket: "pitchers"
    },
    {
      name: "pitchers_vs_rhb",
      playerType: "pitcher",
      batterStands: "R",
      sideKey: "vsRHB",
      bucket: "pitchers"
    }
  ];

  const out = {
    generatedAt: new Date().toISOString(),
    season: YEAR,
    source: "Baseball Savant Statcast Search CSV",
    rules: {
      note: "Public Savant pull/cache. No Odds API usage.",
      usage: "Do not wire into projections until row counts and split columns are verified."
    },
    rawCounts: {},
    batters: {},
    pitchers: {}
  };

  for (const pull of pulls) {
    const url = csvUrl(pull);
    console.log(`Pulling ${pull.name}...`);
    const text = await fetchText(url);

    const rawPath = `${RAW_DIR}/${YEAR}-${pull.name}.csv`;
    fs.writeFileSync(rawPath, text);

    const rows = parseCsv(text);
    out.rawCounts[pull.name] = rows.length;

    mergeSide(out[pull.bucket], pull.sideKey, rows);
  }

  out.batterCount = Object.keys(out.batters).length;
  out.pitcherCount = Object.keys(out.pitchers).length;

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("");
  console.log("SAVANT HANDEDNESS SPLITS");
  console.log("========================");
  console.log(`Season: ${YEAR}`);
  console.log(`Batters: ${out.batterCount}`);
  console.log(`Pitchers: ${out.pitcherCount}`);
  console.log(`Wrote ${OUT}`);
  console.log("");

  console.table(Object.entries(out.rawCounts).map(([key, rows]) => ({ key, rows })));

  console.log("");
  console.log("Sample batters:");
  console.table(Object.values(out.batters).slice(0, 10).map(x => ({
    player: x.player,
    vsLHP_pa: x.vsLHP?.pa ?? null,
    vsLHP_xwoba: x.vsLHP?.xwoba ?? null,
    vsRHP_pa: x.vsRHP?.pa ?? null,
    vsRHP_xwoba: x.vsRHP?.xwoba ?? null
  })));

  console.log("");
  console.log("Sample pitchers:");
  console.table(Object.values(out.pitchers).slice(0, 10).map(x => ({
    player: x.player,
    vsLHB_pa: x.vsLHB?.pa ?? null,
    vsLHB_xwoba: x.vsLHB?.xwoba ?? null,
    vsRHB_pa: x.vsRHB?.pa ?? null,
    vsRHB_xwoba: x.vsRHB?.xwoba ?? null
  })));
}

main().catch(err => {
  console.error("Failed to pull Savant handedness splits");
  console.error(err);
  process.exit(1);
});
