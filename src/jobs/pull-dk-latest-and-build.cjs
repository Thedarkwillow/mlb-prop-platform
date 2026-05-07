const fs = require("fs");
const { execSync } = require("child_process");

const ACTOR_ID = process.env.DRAFTKINGS_APIFY_ACTOR_ID || "zen-studio~draftkings-odds";
const TOKEN = fs.readFileSync(".env", "utf8").match(/APIFY_TOKEN=(.+)/)?.[1]?.trim();

if (!TOKEN) throw new Error("Missing APIFY_TOKEN");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const url =
    "https://api.apify.com/v2/acts/" +
    ACTOR_ID +
    "/runs/last/dataset/items?clean=true&format=json&limit=5000&token=" +
    TOKEN;

  const rows = await fetch(url).then(r => r.json());

  if (!Array.isArray(rows)) {
    throw new Error("Apify did not return an array: " + JSON.stringify(rows, null, 2).slice(0, 1000));
  }

  const playerProps = rows.filter(r =>
    String(r.marketType || "").toLowerCase() === "player_prop" ||
    String(r.market || "").toLowerCase().includes("hits") ||
    String(r.market || "").toLowerCase().includes("home runs") ||
    String(r.market || "").toLowerCase().includes("total bases") ||
    String(r.market || "").toLowerCase().includes("strikeouts") ||
    String(r.market || "").toLowerCase().includes("outs")
  );

  const previous = readJson("data/vegas-latest.json", []);

  if (playerProps.length < 1000) {
    console.log("WARNING: DK pull returned too few player prop rows:", playerProps.length);
    console.log("Keeping previous vegas-latest rows:", Array.isArray(previous) ? previous.length : 0);

    if (!Array.isArray(previous) || previous.length < 1000) {
      throw new Error("No safe previous DK data available. Refusing to overwrite with bad pull.");
    }
  } else {
    fs.writeFileSync("data/vegas-raw.json", JSON.stringify(rows, null, 2));
    fs.writeFileSync("data/vegas-latest.json", JSON.stringify(rows, null, 2));
    console.log("Pulled DK rows:", rows.length);
    console.log("DK player prop rows:", playerProps.length);
  }

  execSync("node src/research/price-current-slips.cjs", { stdio: "inherit" });
  execSync("node src/research/build-final-slips.cjs", { stdio: "inherit" });
  execSync("node src/research/final-slip-summary.cjs", { stdio: "inherit" });
}

main();
