const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const FILE = "outputs/final-slips-validated.json";
const rows = read(FILE, []);

for (const r of rows) {
  r.intelPenalty = 0;
  r.intelBoost = 0;
  r.intelNotes = [];

  const edge = Number(r.edge || 0);
  const books = Number(r.books || 0);
  const market = String(r.market || "").toLowerCase();

  if (market === "runs") {
    r.intelPenalty += 0.08;
    r.intelNotes.push("runs market weak historical ROI");
  }

  if (market === "bases") {
    r.intelBoost += 0.03;
    r.intelNotes.push("bases market strong historical ROI");
  }

  if (books === 3) {
    r.intelBoost += 0.03;
    r.intelNotes.push("3-book support historically strong");
  }

  if (books >= 4) {
    r.intelPenalty += 0.04;
    r.intelNotes.push("4+ books underperforming historically");
  }

  if (edge >= 0.18) {
    r.intelPenalty += 0.06;
    r.intelNotes.push("high-edge bucket historically overfit");
  }

  if (edge >= 0.12 && edge < 0.18) {
    r.intelBoost += 0.04;
    r.intelNotes.push("validated edge sweet spot");
  }

  r.intelAdjustedEdge =
    edge
    + r.intelBoost
    - r.intelPenalty;
}

rows.sort((a, b) =>
  (b.intelAdjustedEdge || 0) -
  (a.intelAdjustedEdge || 0)
);

fs.writeFileSync(FILE, JSON.stringify(rows, null, 2));

console.log("MARKET INTELLIGENCE ADJUSTMENTS APPLIED");
console.log(`rows: ${rows.length}`);
