const fs = require("fs");
const path = require("path");

const YEAR = process.argv[2] || process.env.npm_config_year || new Date().getFullYear();
const OUT = "data/context/imports/umpire-scorecards.csv";

async function getText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/csv,text/plain,*/*"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const candidates = [
    `https://umpscorecards.com/data/umpires?season=${YEAR}&csv=true`,
    `https://www.umpscorecards.com/data/umpires?season=${YEAR}&csv=true`,
    `https://umpscorecards.com/api/games?season=${YEAR}`,
    `https://www.umpscorecards.com/api/games?season=${YEAR}`
  ];

  for (const url of candidates) {
    try {
      const text = await getText(url);
      if (!text || text.length < 100 || text.toLowerCase().includes("<html")) {
        console.log(`Skipped non-data response: ${url}`);
        continue;
      }

      fs.writeFileSync(OUT, text);
      console.log("UMPSCORECARDS PULL");
      console.log("==================");
      console.log(`Year: ${YEAR}`);
      console.log(`Source: ${url}`);
      console.log(`Wrote ${OUT}`);
      return;
    } catch (e) {
      console.log(`Failed: ${url}`);
      console.log(`  ${e.message}`);
    }
  }

  console.log("No direct public UmpScorecards CSV/API endpoint succeeded.");
  console.log(`Keep using manual/import file: ${OUT}`);
  process.exitCode = 0;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
