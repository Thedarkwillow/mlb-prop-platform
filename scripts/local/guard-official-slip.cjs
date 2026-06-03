const fs = require("fs");
const path = require("path");

const PLAYABLE = "outputs/playable-final-slips.json";
const OFFICIAL = "outputs/official-slip.json";
const OFFICIAL_TXT = "outputs/official-slip.txt";
const STALE_DIR = "outputs/stale-official";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function hasCompleteSlip(slip) {
  const legs = Array.isArray(slip?.legs) ? slip.legs : [];
  const size = Number(slip?.size || legs.length || 0);
  return legs.length >= 2 && (!size || legs.length >= size) && slip?.status !== "INCOMPLETE";
}

function main() {
  const playable = readJson(PLAYABLE, []);
  const official = readJson(OFFICIAL, []);

  const playableSlips = Array.isArray(playable) ? playable : [];
  const validPlayable = playableSlips.filter(hasCompleteSlip);

  fs.mkdirSync(STALE_DIR, { recursive: true });

  if (validPlayable.length === 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (fs.existsSync(OFFICIAL)) {
      fs.copyFileSync(OFFICIAL, path.join(STALE_DIR, `official-slip-${stamp}.json`));
    }

    if (fs.existsSync(OFFICIAL_TXT)) {
      fs.copyFileSync(OFFICIAL_TXT, path.join(STALE_DIR, `official-slip-${stamp}.txt`));
    }

    writeJson(OFFICIAL, []);
    fs.writeFileSync(
      OFFICIAL_TXT,
      [
        "OFFICIAL PLAYABLE SLIPS",
        "=======================",
        "none",
        "",
        "Reason: playable-final-slips.json has no complete playable slips.",
        "Stale official-slip output was cleared by guard-official-slip.cjs.",
        ""
      ].join("\n")
    );

    console.log("OFFICIAL SLIP GUARD");
    console.log("===================");
    console.log("validPlayable=0");
    console.log("action=cleared stale official-slip.json");
    return;
  }

  console.log("OFFICIAL SLIP GUARD");
  console.log("===================");
  console.log(`validPlayable=${validPlayable.length}`);
  console.log("action=kept official output");
}

main();
