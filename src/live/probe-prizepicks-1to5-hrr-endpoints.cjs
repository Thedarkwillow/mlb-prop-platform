const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = `outputs/live/true-1to5-hrr-endpoint-probe-${date}.json`;
const LATEST = "outputs/live/true-1to5-hrr-endpoint-probe-latest.json";

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHrrRow(item) {
  const a = item.attributes || {};
  const t = `${a.stat_type || ""} ${a.stat_display_name || ""}`.toLowerCase();
  return (
    t.includes("hits+runs+rbis") ||
    t.includes("hits + runs + rbis") ||
    t.includes("hrr")
  );
}

function hasTrue1to5Text(obj) {
  const s = JSON.stringify(obj || {}).toLowerCase();
  return (
    s.includes("1+2+3+4+5") ||
    s.includes("1-5") ||
    s.includes("1 to 5") ||
    s.includes("first 5") ||
    s.includes("first five") ||
    s.includes("innings 1") && s.includes("5")
  );
}

function buildDurationMap(json) {
  const m = new Map();
  for (const inc of json.included || []) {
    if (inc.type === "duration") {
      m.set(String(inc.id), inc.attributes || {});
    }
  }
  return m;
}

function analyzeJson(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const durations = buildDurationMap(json);

  const hrrRows = rows.filter(isHrrRow);
  const hrrWithDuration = hrrRows.map(item => {
    const a = item.attributes || {};
    const durationId = String(item.relationships?.duration?.data?.id || "");
    const duration = durations.get(durationId) || {};
    const durationName = duration.name || null;

    return {
      id: item.id,
      stat_type: a.stat_type,
      stat_display_name: a.stat_display_name,
      line_score: a.line_score,
      description: a.description,
      odds_type: a.odds_type,
      event_type: a.event_type,
      status: a.status,
      game_id: a.game_id,
      group_key: a.group_key,
      durationId,
      durationName,
      apiConfirms1to5: hasTrue1to5Text({ item, duration })
    };
  });

  const true1to5 = hrrWithDuration.filter(r => r.apiConfirms1to5);
  const nonFull = hrrWithDuration.filter(r =>
    r.durationName && String(r.durationName).toLowerCase() !== "full"
  );

  const byDuration = Object.entries(
    hrrWithDuration.reduce((acc, r) => {
      const key = `${r.durationId || "none"} | ${r.durationName || "none"}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  ).map(([duration, count]) => ({ duration, count }))
   .sort((a, b) => b.count - a.count);

  return {
    dataRows: rows.length,
    includedRows: Array.isArray(json?.included) ? json.included.length : 0,
    hrrRows: hrrWithDuration.length,
    true1to5Rows: true1to5.length,
    nonFullHrrRows: nonFull.length,
    hasTrue1to5Text: hasTrue1to5Text(json),
    byDuration,
    true1to5Sample: true1to5.slice(0, 20),
    nonFullSample: nonFull.slice(0, 20)
  };
}

async function tryUrl(url) {
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      headers: {
        "accept": "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0",
        "origin": "https://app.prizepicks.com",
        "referer": "https://app.prizepicks.com/"
      }
    });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const analysis = json ? analyzeJson(json) : null;

    return {
      url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - startedAt,
      contentType: res.headers.get("content-type"),
      textSample: text.slice(0, 300),
      analysis
    };
  } catch (err) {
    return {
      url,
      status: "ERROR",
      ok: false,
      ms: Date.now() - startedAt,
      error: String(err?.message || err)
    };
  }
}

const base = "https://api.prizepicks.com/projections";
const urls = [
  `${base}?league_id=2&per_page=1000&single_stat=true`,
  `${base}?league_id=2&per_page=1000`,
  `${base}?league_id=2&per_page=1000&single_stat=true&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&single_stat=true&stat_type=Hits%2BRuns%2BRBIs`,
  `${base}?league_id=2&per_page=1000&stat_type=Hits%2BRuns%2BRBIs`,
  `${base}?league_id=2&per_page=1000&single_stat=true&duration_id=11&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&duration_id=11&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&single_stat=true&duration=first_5&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&duration=first_5&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&single_stat=true&duration=1-5&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&duration=1-5&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&single_stat=true&duration=1%2B2%2B3%2B4%2B5&stat_type_id=282`,
  `${base}?league_id=2&per_page=1000&duration=1%2B2%2B3%2B4%2B5&stat_type_id=282`,
  `https://api.prizepicks.com/projections?league_id=2&per_page=1000&market=live&stat_type_id=282`,
  `https://api.prizepicks.com/projections?league_id=2&per_page=1000&projection_type=live&stat_type_id=282`,
  `https://api.prizepicks.com/projections?league_id=2&per_page=1000&event_type=team&stat_type_id=282`
];

(async () => {
  const results = [];

  for (const url of urls) {
    const r = await tryUrl(url);
    results.push(r);

    const a = r.analysis;
    console.log([
      r.status,
      `rows=${a?.dataRows ?? "null"}`,
      `hrr=${a?.hrrRows ?? "null"}`,
      `true1to5=${a?.true1to5Rows ?? "null"}`,
      `nonFull=${a?.nonFullHrrRows ?? "null"}`,
      url
    ].join(" | "));

    await sleep(1200);
  }

  const hits = results.filter(r =>
    r.analysis &&
    (r.analysis.true1to5Rows > 0 || r.analysis.nonFullHrrRows > 0)
  );

  const report = {
    date,
    generatedAt: new Date().toISOString(),
    totalUrls: urls.length,
    hits: hits.length,
    conclusion: hits.length
      ? "Confirmed true 1-5/non-Full HRR endpoint found. Inspect hits."
      : "No confirmed true 1-5/non-Full HRR endpoint found from tested URLs.",
    hitResults: hits,
    results
  };

  write(OUT, report);
  write(LATEST, report);

  console.log("saved:", OUT);
  console.log("saved:", LATEST);
  console.log("conclusion:", report.conclusion);
})();
