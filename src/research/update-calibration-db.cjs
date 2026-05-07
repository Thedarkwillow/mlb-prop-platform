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

const graded = JSON.parse(fs.readFileSync(gradedFile, "utf8"));

const dbPath = "data/calibration/calibration-db.json";
fs.mkdirSync("data/calibration", { recursive: true });

let db = [];
if (fs.existsSync(dbPath)) {
  db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

const seen = new Set(
  db.map(x => [x.date, x.player, x.market, x.side, x.line, x.gamePk || x.game].join("|"))
);

for (const slip of graded.slips || []) {
  for (const leg of slip.legs || []) {
    if (leg.result !== "HIT" && leg.result !== "MISS") continue;

    const key = [date, leg.player, leg.market, leg.side, leg.line, leg.gamePk || leg.game].join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    db.push({
      date,
      player: leg.player,
      team: leg.team,
      game: leg.game,
      gamePk: leg.gamePk,
      market: leg.market,
      side: leg.side,
      line: leg.line,
      actual: leg.actual,
      result: leg.result,
      grade: leg.grade,
      edge: leg.edge,
      adjustedEdge: leg.adjustedEdge,
      finalScore: leg.finalScore,
      distributionProb: leg.distributionProb,
      calibratedDistributionProb: leg.calibratedDistributionProb,
      distributionConfidence: leg.distributionConfidence,
      books: leg.books,
      savant: leg.savant
    });
  }
}

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log("calibration db rows:", db.length);
