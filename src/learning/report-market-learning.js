import fs from "fs";

const p = "data/learning/market-learning.json";
const out = "outputs/learning/market-learning-report.txt";

function read(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function pct(x) {
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function line(title) {
  return `\n${title}\n${"=".repeat(title.length)}\n`;
}

const data = read(p);
fs.mkdirSync("outputs/learning", { recursive: true });

const md = Object.entries(data.byMarketDirection || {})
  .map(([key, v]) => ({ key, ...v }))
  .filter(x => x.sample >= 50)
  .sort((a, b) => b.bias - a.bias);

const suppressed = md.filter(x => x.suppressed);
const best = md.slice(0, 10);
const worst = [...md].sort((a, b) => a.bias - b.bias).slice(0, 10);

let txt = "";
txt += "MARKET LEARNING REPORT\n";
txt += `Generated: ${data.generatedAt}\n`;
txt += `Source: ${data.sourceFile}\n`;
txt += `Usable rows: ${data.usableRows}\n`;

txt += line("BEST LEARNED EDGES");
for (const x of best) {
  txt += `${x.key} | sample=${x.sample} | pred=${pct(x.predicted)} | actual=${pct(x.actual)} | bias=${pct(x.bias)} | mult=${x.adjustmentMultiplier}\n`;
}

txt += line("WORST LEARNED EDGES");
for (const x of worst) {
  txt += `${x.key} | sample=${x.sample} | pred=${pct(x.predicted)} | actual=${pct(x.actual)} | bias=${pct(x.bias)} | mult=${x.adjustmentMultiplier}${x.suppressed ? " | SUPPRESSED" : ""}\n`;
}

txt += line("SUPPRESSED MARKETS");
for (const x of suppressed) {
  txt += `${x.key} | sample=${x.sample} | pred=${pct(x.predicted)} | actual=${pct(x.actual)} | bias=${pct(x.bias)}\n`;
}

fs.writeFileSync(out, txt);
console.log(txt);
console.log(`\nWrote ${out}`);
