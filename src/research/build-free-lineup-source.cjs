const fs = require("fs");

const OUT = "data/context/free-lineup-source.json";
const DATE = process.argv[2] || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function keyName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function cleanHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 MLB prop context bot",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

function extractRotowire(html) {
  const text = cleanHtml(html);
  const teams = {};
  const players = {};

  // Defensive generic extraction. This will catch embedded names/classes if public HTML exposes them.
  const nameRegex = /(?:lineup__player|lineup-player|player-name|lineup-card).*?>([^<>]{3,40})</gi;
  let m;
  while ((m = nameRegex.exec(html))) {
    const name = String(m[1] || "").trim();
    if (!name || /\d|confirmed|lineup|weather|tickets/i.test(name)) continue;
    const k = keyName(name);
    players[k] = { name, source: "rotowire_html_generic" };
  }

  return { teams, players, textSample: text.slice(0, 1000) };
}

function extractRosterResource(html) {
  const text = cleanHtml(html);
  return { teams: {}, players: {}, textSample: text.slice(0, 1000) };
}

async function main() {
  const sources = [];
  const teams = {};
  const players = {};
  const errors = [];

  const urls = [
    { name: "rotowire", url: "https://www.rotowire.com/baseball/daily-lineups.php" },
    { name: "rosterresource", url: "https://www.fangraphs.com/roster-resource/mlb-lineups" }
  ];

  for (const src of urls) {
    try {
      const html = await fetchText(src.url);
      const parsed = src.name === "rotowire" ? extractRotowire(html) : extractRosterResource(html);

      Object.assign(teams, parsed.teams || {});
      Object.assign(players, parsed.players || {});
      sources.push({
        name: src.name,
        url: src.url,
        ok: true,
        playerHints: Object.keys(parsed.players || {}).length,
        teamHints: Object.keys(parsed.teams || {}).length
      });
    } catch (e) {
      errors.push({ source: src.name, error: String(e.message || e) });
      sources.push({ name: src.name, url: src.url, ok: false });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    recordType: "free_lineup_source_v1",
    status: Object.keys(players).length ? "partial_html_extracted" : "no_structured_lineups_found",
    teams,
    players,
    sources,
    errors,
    notes: [
      "This is a free public-page fallback layer.",
      "It is intentionally fail-soft.",
      "If RotoWire/RosterResource markup changes or blocks structured HTML, it will not break the main pipeline.",
      "MLB Stats API confirmed-lineups remains the primary structured source."
    ]
  };

  write(OUT, out);

  console.log("FREE LINEUP SOURCE");
  console.log("==================");
  console.log("Status:", out.status);
  console.log("Players:", Object.keys(players).length);
  console.log("Teams:", Object.keys(teams).length);
  console.log("Wrote", OUT);
  console.table(sources);
  if (errors.length) console.table(errors);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
