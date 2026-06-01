const fs = require("fs");
const https = require("https");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const TARGETS = "outputs/context/real-pitch-type-target-list-latest.json";
const OUT = `outputs/context/pitch-type-target-mlb-id-repair-${date}.json`;
const LATEST = "outputs/context/pitch-type-target-mlb-id-repair-latest.json";

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "mlb-prop-platform/1.0",
        "Accept": "application/json"
      }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

async function lookupPlayer(name) {
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`;
  let data = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      data = await getJson(url);
      break;
    } catch (err) {
      lastErr = err;
      await sleep(600 * attempt);
    }
  }

  if (!data) throw lastErr || new Error("lookup_failed");

  const people = Array.isArray(data.people) ? data.people : [];
  const key = norm(name);

  const exact = people.find(p => norm(p.fullName) === key);
  const activePitcher = people.find(p =>
    String(p.active) === "true" &&
    String(p.primaryPosition?.abbreviation || "").toUpperCase() === "P"
  );
  const anyPitcher = people.find(p =>
    String(p.primaryPosition?.abbreviation || "").toUpperCase() === "P"
  );

  const best = exact || activePitcher || anyPitcher || people[0] || null;
  if (!best) return null;

  return {
    query: name,
    id: best.id || null,
    fullName: best.fullName || null,
    active: best.active ?? null,
    primaryPosition: best.primaryPosition?.abbreviation || null,
    matched: norm(best.fullName) === key ? "exact" : "best_available"
  };
}

async function main() {
  const targets = readJson(TARGETS, {});
  const pitcherTargets = targets.pitcherArsenalTargets || [];
  const max = Number(process.env.MLB_ID_REPAIR_MAX || 40);

  const rows = pitcherTargets.slice(0, max);
  const repaired = [];
  const failed = [];

  for (const row of rows) {
    await sleep(Number(process.env.MLB_ID_REPAIR_SLEEP_MS || 350));
    try {
      const match = await lookupPlayer(row.pitcher);
      if (match?.id) {
        repaired.push({
          ...row,
          mlbamId: match.id,
          matchedName: match.fullName,
          matchType: match.matched,
          primaryPosition: match.primaryPosition,
          active: match.active
        });
      } else {
        failed.push({ ...row, reason: "no_match" });
      }
    } catch (err) {
      failed.push({ ...row, reason: String(err.message || err) });
    }
  }

  const report = {
    date,
    generatedAt: new Date().toISOString(),
    sourceTargets: TARGETS,
    requested: rows.length,
    repaired: repaired.length,
    failed: failed.length,
    repairedRows: repaired,
    failedRows: failed
  };

  writeJson(OUT, report);
  writeJson(LATEST, report);

  console.log("PITCH TYPE TARGET MLB ID REPAIR");
  console.log("-------------------------------");
  console.table([{
    requested: report.requested,
    repaired: report.repaired,
    failed: report.failed
  }]);
  console.table(repaired.slice(0, 30).map(r => ({
    pitcher: r.pitcher,
    team: r.team,
    rows: r.rows,
    mlbamId: r.mlbamId,
    matchedName: r.matchedName,
    matchType: r.matchType
  })));
  if (failed.length) {
    console.log("Failed:");
    console.table(failed.slice(0, 20).map(r => ({
      pitcher: r.pitcher,
      team: r.team,
      rows: r.rows,
      reason: r.reason
    })));
  }
  console.log("saved:", OUT);
  console.log("saved:", LATEST);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
