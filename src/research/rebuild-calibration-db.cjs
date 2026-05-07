const fs = require("fs");

const date =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const gradedFile = `outputs/playable-final-slips-graded-${date}.json`;
if (!fs.existsSync(gradedFile)) {
  console.error("missing:", gradedFile);
  process.exit(1);
}

fs.mkdirSync("data/calibration", { recursive: true });

const graded = JSON.parse(fs.readFileSync(gradedFile, "utf8"));
const rows = [];
const seen = new Set();

for (const slip of graded.slips || []) {
  for (const leg of slip.legs || []) {
    if (leg.result !== "HIT" && leg.result !== "MISS") continue;

    const key = [
      date,
      leg.player,
      leg.market,
      leg.side,
      leg.line,
      leg.gamePk || leg.game
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      date,
      player: leg.player,
      team: leg.team,
      game: leg.game,
      gamePk: leg.gamePk ?? null,
      market: leg.market,
      side: leg.side,
      line: leg.line,
      result: leg.result,
      actual: leg.actual,
      note: leg.note || "",
      calibratedDistributionProb: leg.calibratedDistributionProb ?? null,
      distributionProb: leg.distributionProb ?? null,
      distributionConfidence: leg.distributionConfidence ?? null,
      grade: leg.grade ?? null,
      savant: leg.savant ?? null,
      adjustedEdge: leg.adjustedEdge ?? null,
      edge: leg.edge ?? null,
      books: leg.books ?? null
    });
  }
}

fs.writeFileSync(
  "data/calibration/calibration-db.json",
  JSON.stringify(rows, null, 2) + "\n"
);

console.log("rebuilt calibration db rows:", rows.length);
