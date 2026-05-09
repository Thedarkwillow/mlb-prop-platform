import fs from "fs";

const files = fs.existsSync("outputs/history")
  ? fs.readdirSync("outputs/history")
      .filter(f => f.endsWith("-fantasy-grades.json"))
      .map(f => `outputs/history/${f}`)
  : [];

const rows = [];

for (const file of files) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(data)) rows.push(...data);
  } catch {}
}

function key(row) {
  return `${row.market || row.stat || "unknown"}_${row.side || "MORE"}`;
}

const groups = {};

for (const r of rows) {
  const result = String(r.result || "").toUpperCase();
  if (!["HIT", "MISS", "PUSH"].includes(result)) continue;

  const k = key(r);
  groups[k] ||= { market: k, hits: 0, misses: 0, pushes: 0, rows: 0 };

  groups[k].rows++;
  if (result === "HIT") groups[k].hits++;
  if (result === "MISS") groups[k].misses++;
  if (result === "PUSH") groups[k].pushes++;
}

const summary = Object.values(groups).map(g => ({
  ...g,
  hitRate: g.hits + g.misses > 0 ? g.hits / (g.hits + g.misses) : null
}));

fs.mkdirSync("outputs/learning", { recursive: true });

let txt = "FANTASY LEARNING REPORT\n";
txt += "=======================\n";
txt += `Rows: ${rows.length}\n\n`;

for (const g of summary.sort((a,b) => b.rows - a.rows)) {
  txt += `${g.market} | rows=${g.rows} | hits=${g.hits} | misses=${g.misses} | pushes=${g.pushes} | hitRate=${g.hitRate == null ? "NA" : (g.hitRate*100).toFixed(1)+"%"}\n`;
}


const rules = {};
for (const g of summary) {
  const canPromote = g.rows >= 250 && g.hitRate != null && g.hitRate >= 0.55;
  rules[g.market] = {
    rows: g.rows,
    hits: g.hits,
    misses: g.misses,
    pushes: g.pushes,
    hitRate: g.hitRate,
    trackingOnly: !canPromote,
    rankEligible: canPromote,
    suppressed: !canPromote,
    reason: canPromote
      ? "fantasy sample and hit rate meet promotion threshold"
      : "fantasy tracking only until sample >= 250 and hitRate >= 55%"
  };
}

fs.writeFileSync("data/learning/fantasy-rules.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  rules
}, null, 2) + "\n");

fs.writeFileSync("outputs/learning/fantasy-learning-report.txt", txt);
console.log(txt);
