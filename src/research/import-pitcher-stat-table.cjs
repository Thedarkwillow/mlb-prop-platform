const fs = require("fs");

const IN = "data/context/imports/pitcher-stat-table.csv";
const OUT = "data/context/pitcher-stat-table.json";

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function num(v) {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace("%", "").replace(",", "").trim());
  return Number.isFinite(x) ? x : null;
}

function parseCsvLine(line) {
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
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = vals[i]));
    return row;
  });
}

function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

function normalizeRow(row) {
  const name = pick(row, [
    "Name", "Player", "player", "player_name", "last_name, first_name"
  ]);

  const team = pick(row, ["Team", "team", "Tm"]);
  const id = pick(row, ["playerid", "PlayerId", "player_id", "MLBAMID", "mlbamid"]);

  return {
    name,
    id: id || null,
    team: team || null,

    era: num(pick(row, ["ERA", "era"])),
    whip: num(pick(row, ["WHIP", "whip"])),
    fip: num(pick(row, ["FIP", "fip"])),
    xfip: num(pick(row, ["xFIP", "XFIP", "xfip"])),

    homeAwaySplits: {
      home: {
        era: num(pick(row, ["Home ERA", "ERA Home", "home_era"])),
        whip: num(pick(row, ["Home WHIP", "WHIP Home", "home_whip"])),
        fip: num(pick(row, ["Home FIP", "FIP Home", "home_fip"])),
        xfip: num(pick(row, ["Home xFIP", "xFIP Home", "home_xfip"]))
      },
      away: {
        era: num(pick(row, ["Away ERA", "ERA Away", "away_era"])),
        whip: num(pick(row, ["Away WHIP", "WHIP Away", "away_whip"])),
        fip: num(pick(row, ["Away FIP", "FIP Away", "away_fip"])),
        xfip: num(pick(row, ["Away xFIP", "xFIP Away", "away_xfip"]))
      }
    },

    vsLHH: {
      avgAgainst: num(pick(row, ["AVG vs LHH", "vL AVG", "vsLHH_AVG"])),
      xwoba: num(pick(row, ["xwOBA vs LHH", "vL xwOBA", "vsLHH_xwOBA"])),
      xslg: num(pick(row, ["xSLG vs LHH", "vL xSLG", "vsLHH_xSLG"]))
    },

    vsRHH: {
      avgAgainst: num(pick(row, ["AVG vs RHH", "vR AVG", "vsRHH_AVG"])),
      xwoba: num(pick(row, ["xwOBA vs RHH", "vR xwOBA", "vsRHH_xwOBA"])),
      xslg: num(pick(row, ["xSLG vs RHH", "vR xSLG", "vsRHH_xSLG"]))
    },

    kRate: num(pick(row, ["K%", "K-BB%", "k_percent", "SO%"])),
    bbRate: num(pick(row, ["BB%", "bb_percent"])),
    avgAgainst: num(pick(row, ["AVG", "BAA", "AVG Against", "avg_against"])),
    chaseRate: num(pick(row, ["O-Swing%", "Chase%", "chase_rate"])),
    swingMissRate: num(pick(row, ["SwStr%", "Swinging Strike%", "swing_miss_rate"])),
    gbFb: num(pick(row, ["GB/FB", "gb_fb"])),
    pmr: num(pick(row, ["PMR", "pmr"])),

    raw: row
  };
}

function main() {
  fs.mkdirSync("data/context/imports", { recursive: true });

  if (!fs.existsSync(IN)) {
    fs.writeFileSync(
      IN,
      [
        "Name,Team,playerid,ERA,WHIP,FIP,xFIP,K%,BB%,AVG Against,Chase%,SwStr%,GB/FB,PMR",
        ""
      ].join("\n")
    );
  }

  const rows = parseCsv(fs.readFileSync(IN, "utf8"))
    .map(normalizeRow)
    .filter(r => r.name);

  const byName = {};
  const byId = {};

  for (const r of rows) {
    byName[norm(r.name)] = r;
    if (r.id) byId[String(r.id)] = r;
  }

  const out = {
    recordType: "pitcher_stat_table",
    generatedAt: new Date().toISOString(),
    source: IN,
    rows: rows.length,
    byName,
    byId
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("PITCHER STAT TABLE IMPORT");
  console.log("=========================");
  console.log(`Rows: ${rows.length}`);
  console.log(`Wrote ${OUT}`);
  console.table(rows.slice(0, 20).map(r => ({
    name: r.name,
    team: r.team,
    era: r.era,
    whip: r.whip,
    fip: r.fip,
    xfip: r.xfip,
    kRate: r.kRate,
    bbRate: r.bbRate,
    chase: r.chaseRate,
    swMiss: r.swingMissRate,
    pmr: r.pmr
  })));
}

main();
