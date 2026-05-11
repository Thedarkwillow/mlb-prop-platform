const fs = require("fs");
const path = require("path");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const OUTPUT = "data/context/imports/today-umpires.csv";

const TEAM_MAP = {
  ARI: "AZ", AZ: "AZ", ATL: "ATL", BAL: "BAL", BOS: "BOS",
  CHC: "CHC", CWS: "CWS", CHW: "CWS", CIN: "CIN", CLE: "CLE",
  COL: "COL", DET: "DET", HOU: "HOU", KC: "KC", KCR: "KC",
  LAA: "LAA", LAD: "LAD", MIA: "MIA", MIL: "MIL", MIN: "MIN",
  NYM: "NYM", NYY: "NYY", OAK: "ATH", ATH: "ATH", PHI: "PHI",
  PIT: "PIT", SD: "SD", SDP: "SD", SEA: "SEA", SF: "SF",
  SFG: "SF", STL: "STL", TB: "TB", TBR: "TB", TEX: "TEX",
  TOR: "TOR", WSH: "WSH", WAS: "WSH"
};

function normTeam(s) {
  const raw = String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  return TEAM_MAP[raw] || raw;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function likelyUmpireName(s) {
  const x = String(s || "").trim();
  if (!x) return false;
  if (/umpire|assignment|weather|odds|lineup|preview|bet|today|game/i.test(x)) return false;
  return /^[A-Z][a-zÀ-ÿ.'-]+(?:\s+[A-Z][a-zÀ-ÿ.'-]+){1,3}$/.test(x);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function getText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html,application/json,text/plain,*/*"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function getRenderedText(url) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    console.log("Playwright not installed. Run: npm i playwright");
    return "";
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(5000);

    return await page.evaluate(() => document.body.innerText || document.documentElement.innerText || "");
  } finally {
    await browser.close();
  }
}

function extractJsonBlobs(text) {
  const blobs = [];
  const t = String(text || "");
  for (const m of t.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { blobs.push(JSON.parse(m[1])); } catch {}
  }
  for (const m of t.matchAll(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { blobs.push(JSON.parse(m[1])); } catch {}
  }
  return blobs;
}

function walk(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const x of obj) walk(x, out);
    return out;
  }
  out.push(obj);
  for (const v of Object.values(obj)) walk(v, out);
  return out;
}

function objectRowsToAssignments(objects, source) {
  const out = [];

  for (const r of objects) {
    const away = r.away_team || r.awayTeam || r.away || r.away_abbr || r.awayAbbr || r.visitor_team;
    const home = r.home_team || r.homeTeam || r.home || r.home_abbr || r.homeAbbr;
    const ump =
      r.home_plate || r.homePlate || r.plate_umpire || r.plateUmpire ||
      r.hp_umpire || r.hpUmpire || r.umpire || r.official || r.plate;

    if (away && home && ump && likelyUmpireName(ump)) {
      out.push({
        date: DATE,
        away: normTeam(away),
        home: normTeam(home),
        umpire: String(ump).trim(),
        status: source
      });
    }
  }

  return out;
}

function textToAssignments(text, source) {
  const clean = stripHtml(text);
  const out = [];

  const patterns = [
    /\b([A-Z]{2,3})\s*@\s*([A-Z]{2,3})\b.{0,180}?\b(?:HP|Home Plate|Plate Umpire|Umpire)\b[:\s-]*([A-Z][a-zÀ-ÿ.'-]+(?:\s+[A-Z][a-zÀ-ÿ.'-]+){1,3})/g,
    /\b([A-Z]{2,3})\s*@\s*([A-Z]{2,3})\b.{0,180}?([A-Z][a-zÀ-ÿ.'-]+(?:\s+[A-Z][a-zÀ-ÿ.'-]+){1,3})/g
  ];

  for (const re of patterns) {
    for (const m of clean.matchAll(re)) {
      const away = normTeam(m[1]);
      const home = normTeam(m[2]);
      const umpire = String(m[3] || "").trim();

      if (away && home && likelyUmpireName(umpire)) {
        out.push({ date: DATE, away, home, umpire, status: source });
      }
    }
  }

  return out;
}

async function scrapeSource(name, urls) {
  let all = [];

  for (const url of urls) {
    try {
      const raw = await getText(url);
      const blobs = extractJsonBlobs(raw);
      for (const blob of blobs) {
        all = all.concat(objectRowsToAssignments(walk(blob), `${name}-fetch-json`));
      }
      all = all.concat(textToAssignments(raw, `${name}-fetch-html`));
    } catch (e) {
      console.log(`${name} fetch failed: ${url} | ${e.message}`);
    }

    if (all.length) break;

    try {
      const rendered = await getRenderedText(url);
      all = all.concat(textToAssignments(rendered, `${name}-playwright`));
    } catch (e) {
      console.log(`${name} playwright failed: ${url} | ${e.message}`);
    }

    if (all.length) break;
  }

  return all;
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];

  for (const r of rows) {
    const key = `${r.date}|${r.away}|${r.home}`;
    if (seen.has(key)) continue;
    if (!r.away || !r.home || !r.umpire) continue;
    seen.add(key);
    out.push(r);
  }

  return out;
}

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

  const ref = await scrapeSource("refmetrics", [
    "https://www.refmetrics.com/baseball/mlb/game-calendar",
    "https://www.refmetrics.com/baseball/mlb/umpire-assignments",
    "https://www.refmetrics.com/baseball/mlb/todays-umpire-assignments"
  ]);

  const action = await scrapeSource("actionnetwork", [
    "https://www.actionnetwork.com/mlb/referee-assignments"
  ]);

  const merged = dedupe([...ref, ...action]);

  if (ref.length === 0) {
    console.log("RefMetrics slate found, but HP assignments may not be posted yet.");
  }
  if (action.length === 0) {
    console.log("Action Network produced no usable same-day umpire rows.");
  }

  const lines = [
    "date,away,home,umpire,status",
    ...merged.map(r => [r.date, r.away, r.home, r.umpire, r.status].map(csvEscape).join(","))
  ];

  fs.writeFileSync(OUTPUT, lines.join("\n") + "\n");

  console.log("TODAY UMPIRE SCRAPER");
  console.log("====================");
  console.log(`Date: ${DATE}`);
  console.log(`RefMetrics rows: ${ref.length}`);
  console.log(`Action rows: ${action.length}`);
  console.log(`Written rows: ${merged.length}`);
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
