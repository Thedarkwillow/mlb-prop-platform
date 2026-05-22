const fs = require("fs");

const input = "data/context/imports/catcher-framing.csv";
const output = "data/context/catcher-framing.json";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(x => x.replace(/^"|"$/g, ""));
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function tier(rv, pitches) {
  if ((pitches || 0) < 300) return "LOW_SAMPLE";
  if (rv >= 2) return "ELITE";
  if (rv >= 0.75) return "POSITIVE";
  if (rv <= -2) return "POOR";
  if (rv <= -0.75) return "NEGATIVE";
  return "NEUTRAL";
}

const text = fs.readFileSync(input, "utf8").trim();
const lines = text.split(/\r?\n/);
const header = parseCsvLine(lines[0]);

const rows = lines.slice(1).map(line => {
  const vals = parseCsvLine(line);
  const r = {};
  header.forEach((h, i) => r[h] = vals[i]);

  const id = r.id;
  const rawName = r.name || "";
  const parts = rawName.split(",").map(x => x.trim());
  const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : rawName;

  const pitches = num(r.pitches);
  const rvTot = num(r.rv_tot);
  const pctTot = num(r.pct_tot);

  return {
    id,
    catcher: name,
    rawName,
    pitches,
    framingRunValue: rvTot,
    framingPct: pctTot,
    framingTier: tier(rvTot, pitches)
  };
}).sort((a, b) => (b.framingRunValue ?? -999) - (a.framingRunValue ?? -999));

fs.mkdirSync("data/context", { recursive: true });
fs.writeFileSync(output, JSON.stringify(rows, null, 2));

console.log("CATCHER FRAMING REPORT");
console.log("======================");
console.log({ rows: rows.length });
console.table(rows.slice(0, 20).map(r => ({
  catcher: r.catcher,
  pitches: r.pitches,
  rv: r.framingRunValue,
  pct: r.framingPct,
  tier: r.framingTier
})));
console.log(`Wrote ${output}`);
