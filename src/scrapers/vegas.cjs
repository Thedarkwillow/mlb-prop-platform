const fs = require("fs");

const TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = process.env.DRAFTKINGS_APIFY_ACTOR_ID || "zen-studio~draftkings-odds";
const DATASET_ID = process.env.DRAFTKINGS_APIFY_DATASET_ID || "";

if (!TOKEN) throw new Error("Missing APIFY_TOKEN");

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function marketKey(market, participant) {
  let m = String(market || "");
  const p = String(participant || "");
  if (p) m = m.replace(new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+", "i"), "");
  m = m.replace(/\s+O\/U$/i, "").trim().toLowerCase();

  if (m.includes("hits+runs+rbis")) return "hrr";
  if (m.includes("total bases")) return "bases";
  if (m.includes("hits")) return "hits";
  if (m.includes("home runs")) return "home_runs";
  if (m.includes("rbis")) return "rbis";
  if (m.includes("runs")) return "runs";
  if (m.includes("strikeouts")) return "strikeouts";
  if (m.includes("pitching outs")) return "pitching_outs";
  if (m.includes("hits allowed")) return "hits_allowed";
  if (m.includes("earned runs allowed")) return "earned_runs_allowed";
  return null;
}

function implied(decimalOdds) {
  const d = Number(decimalOdds);
  return d > 1 ? 1 / d : null;
}

function normalizeRow(r) {
  const market = marketKey(r.market, r.participant);
  if (!market) return null;

  const sel = String(r.selection || "").trim();
  let side = null;
  let line = null;

  if (String(r.outcome || "").toLowerCase() === "over" || sel.toLowerCase() === "over") {
    side = "MORE";
    line = Number(r.points);
  } else if (String(r.outcome || "").toLowerCase() === "under" || sel.toLowerCase() === "under") {
    side = "LESS";
    line = Number(r.points);
  } else {
    const m = sel.match(/^(\d+)\+$/);
    if (!m) return null;
    side = "MORE";
    line = Number(m[1]) - 0.5;
  }

  if (!Number.isFinite(line)) return null;

  return {
    sportsbook: "DraftKings",
    source: "apify_draftkings",
    player: r.participant,
    playerNorm: normName(r.participant),
    teamEvent: r.event,
    game: r.event,
    eventId: r.eventId,
    startTime: r.startTime,
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    market,
    marketRaw: r.market,
    selection: r.selection,
    side,
    line,
    odds: r.odds,
    decimalOdds: Number(r.decimalOdds),
    impliedProb: implied(r.decimalOdds),
    participantId: r.participantId,
    status: r.status
  };
}

async function fetchActorRun() {
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${TOKEN}`;
  const input = {
    sport: "baseball",
    league: "MLB",
    marketType: "Player Props"
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Apify actor failed ${res.status}: ${txt.slice(0, 800)}`);
  }

  return res.json();
}

async function fetchDataset(id) {
  const url = `https://api.apify.com/v2/datasets/${id}/items?clean=true&format=json&token=${TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Apify dataset failed ${res.status}: ${txt.slice(0, 800)}`);
  }
  return res.json();
}

(async () => {
  fs.mkdirSync("data", { recursive: true });

  const raw = DATASET_ID ? await fetchDataset(DATASET_ID) : await fetchActorRun();

  fs.writeFileSync("data/vegas-raw.json", JSON.stringify(raw, null, 2));

  const normalized = raw
    .filter(r => ["player_prop", "total"].includes(String(r.marketType || "").toLowerCase()))
    .map(normalizeRow)
    .filter(Boolean);

  fs.writeFileSync("data/vegas-latest.json", JSON.stringify(normalized, null, 2));

  console.log("Raw rows:", raw.length);
  console.log("Normalized DK prop rows:", normalized.length);
  console.log("Wrote data/vegas-latest.json");

  if (normalized.length === 0) {
    console.log("WARNING: No player props normalized. Your Apify run likely returned game lines only.");
  }
})();
