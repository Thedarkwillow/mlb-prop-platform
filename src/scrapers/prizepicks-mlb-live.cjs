const fs = require("fs");
const path = require("path");

const OUT = "data/prizepicks-mlb-live-raw-latest.json";
const URL = "https://api.prizepicks.com/projections?league_id=231&per_page=250&single_stat=true&in_game=true&state_code=CA&game_mode=prizepools";

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

async function main() {
  console.log("Fetching PrizePicks MLB Live board...");
  console.log("URL:", URL);

  const res = await fetch(URL, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "origin": "https://app.prizepicks.com",
      "referer": "https://app.prizepicks.com/",
      "user-agent": "Mozilla/5.0"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`PrizePicks MLB Live request failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`PrizePicks MLB Live returned non-JSON:\n${text.slice(0, 500)}`);
  }

  write(OUT, json);

  const rows = Array.isArray(json.data) ? json.data.length : 0;
  const included = Array.isArray(json.included) ? json.included.length : 0;

  const statCounts = {};
  for (const item of json.data || []) {
    const stat = item?.attributes?.stat_type || "UNKNOWN";
    statCounts[stat] = (statCounts[stat] || 0) + 1;
  }

  console.log("Saved raw MLB Live board:", OUT);
  console.log("Rows:", rows);
  console.log("Included:", included);
  console.table(Object.entries(statCounts).map(([stat, count]) => ({ stat, count })).sort((a, b) => b.count - a.count));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
