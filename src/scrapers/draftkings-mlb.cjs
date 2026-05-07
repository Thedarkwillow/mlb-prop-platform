const fs = require("fs");

const OUT = "outputs/draftkings-mlb-props.json";

// MLB event group is commonly 84240, but DK can change response shape.
const URL = "https://sportsbook.draftkings.com//sites/US-SB/api/v5/eventgroups/84240?format=json";

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

function cleanMarketName(s) {
  return String(s || "").toLowerCase();
}

function wantedMarket(name) {
  const m = cleanMarketName(name);
  return (
    m.includes("hits") ||
    m.includes("total bases") ||
    m.includes("strikeouts") ||
    m.includes("pitcher strikeouts")
  );
}

function normalizeMarket(name) {
  const m = cleanMarketName(name);
  if (m.includes("total bases")) return "bases";
  if (m.includes("strikeout")) return "strikeouts";
  if (m.includes("hits")) return "hits";
  return m;
}

function walk(obj, fn) {
  if (!obj || typeof obj !== "object") return;
  fn(obj);
  if (Array.isArray(obj)) {
    for (const x of obj) walk(x, fn);
  } else {
    for (const v of Object.values(obj)) walk(v, fn);
  }
}

function pickName(o) {
  return o.name || o.label || o.outcomeLabel || o.participant || o.participantName || o.playerName || "";
}

function pickOdds(o) {
  return o.oddsAmerican || o.americanOdds || o.displayOdds?.american || o.odds;
}

function pickLine(o) {
  return o.line || o.points || o.handicap || o.displayLine || o.statValue;
}

function pickSide(o) {
  const s = String(o.label || o.name || o.outcomeLabel || "").toLowerCase();
  if (s.includes("over") || s.includes("more")) return "MORE";
  if (s.includes("under") || s.includes("less")) return "LESS";
  return null;
}

async function main() {
  console.log("Fetching DraftKings MLB...");
  const res = await fetch(URL, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error(`DraftKings request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const props = [];

  walk(data, (o) => {
    const marketName =
      o.marketName ||
      o.marketType?.name ||
      o.market?.name ||
      o.categoryName ||
      o.name;

    if (!wantedMarket(marketName)) return;

    const outcomes = o.outcomes || o.selections || o.offers || [];
    if (!Array.isArray(outcomes)) return;

    for (const out of outcomes) {
      const odds = pickOdds(out);
      const side = pickSide(out);
      const line = pickLine(out);
      const name = pickName(out);

      if (!name || !side || odds == null) continue;

      props.push({
        source: "DraftKings",
        market: normalizeMarket(marketName),
        marketName,
        player: name
          .replace(/\b(over|under)\b/gi, "")
          .replace(/[0-9.]+/g, "")
          .trim(),
        side,
        line: line == null ? null : Number(line),
        oddsAmerican: Number(odds),
        impliedProb: americanToImplied(odds),
        rawName: name,
        scrapedAt: new Date().toISOString()
      });
    }
  });

  const clean = props.filter(p =>
    p.player &&
    ["hits", "bases", "strikeouts"].includes(p.market) &&
    Number.isFinite(p.oddsAmerican)
  );

  fs.writeFileSync(OUT, JSON.stringify(clean, null, 2));

  console.log("DraftKings props:", clean.length);
  console.log("Wrote", OUT);
  console.log(clean.slice(0, 10));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
