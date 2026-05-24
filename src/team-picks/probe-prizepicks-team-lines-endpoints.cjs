const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = `outputs/team-picks/team-lines-endpoint-probe-${date}.json`;
const LATEST = "outputs/team-picks/team-lines-endpoint-probe-latest.json";

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function hasGameLineWords(obj) {
  const text = JSON.stringify(obj || {}).toLowerCase();
  return (
    text.includes("moneyline") ||
    text.includes("money line") ||
    text.includes("spread") ||
    text.includes("run line") ||
    text.includes("game total") ||
    text.includes("game lines") ||
    text.includes("team picks") ||
    text.includes("winner")
  );
}

async function tryUrl(url) {
  const startedAt = Date.now();

  try {
    const r = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0"
      }
    });

    const contentType = r.headers.get("content-type") || "";
    const text = await r.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    return {
      url,
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      contentType,
      ms: Date.now() - startedAt,
      bytes: text.length,
      json: !!json,
      topKeys: json && typeof json === "object" ? Object.keys(json).slice(0, 30) : [],
      dataRows: Array.isArray(json?.data) ? json.data.length : null,
      includedRows: Array.isArray(json?.included) ? json.included.length : null,
      hasGameLineWords: hasGameLineWords(json || text),
      sample: json ? JSON.stringify(json).slice(0, 1200) : text.slice(0, 1200)
    };
  } catch (e) {
    return {
      url,
      ok: false,
      error: e.message
    };
  }
}

async function main() {
  const urls = [
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&single_stat=true",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&projection_type=team",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&event_type=team",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&game_lines=true",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&team_picks=true",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&market=game_lines",
    "https://api.prizepicks.com/projections?league_id=2&per_page=1000&projection_type=game_lines",
    "https://api.prizepicks.com/leagues",
    "https://api.prizepicks.com/game_lines?league_id=2",
    "https://api.prizepicks.com/team_picks?league_id=2",
    "https://api.prizepicks.com/markets?league_id=2"
  ];

  const results = [];

  for (const url of urls) {
    const res = await tryUrl(url);
    results.push(res);
    console.log(`${res.status || "ERR"} | rows=${res.dataRows} | gameWords=${res.hasGameLineWords} | ${url}`);
  }

  const out = {
    date,
    generatedAt: new Date().toISOString(),
    results
  };

  write(OUT, out);
  write(LATEST, out);

  console.log("saved:", OUT);
  console.log("saved:", LATEST);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
