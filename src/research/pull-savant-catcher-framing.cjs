const fs = require("fs");
const path = require("path");

const YEAR = process.argv[2] || process.env.npm_config_year || new Date().getFullYear();
const OUT_CSV = "data/context/imports/catcher-framing.csv";

async function getText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/csv,*/*"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });

  const urls = [
    `https://baseballsavant.mlb.com/leaderboard/catcher-framing?csv=true&year=${YEAR}&team=&min=100`,
    `https://baseballsavant.mlb.com/catcher_framing?csv=true&year=${YEAR}&team=&min=100`
  ];

  let csv = "";
  let used = "";

  for (const url of urls) {
    try {
      const text = await getText(url);
      if (text && text.includes(",") && !text.toLowerCase().includes("<html")) {
        csv = text;
        used = url;
        break;
      }
    } catch {}
  }

  if (!csv) {
    console.error("Could not pull Savant catcher framing CSV.");
    process.exit(1);
  }

  fs.writeFileSync(OUT_CSV, csv);
  console.log("SAVANT CATCHER FRAMING");
  console.log("======================");
  console.log(`Year: ${YEAR}`);
  console.log(`Source: ${used}`);
  console.log(`Wrote ${OUT_CSV}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
