const fs = require("fs");

function stat(label, arr) {
  const h = arr.filter(r=>r.result==="HIT").length;
  const m = arr.filter(r=>r.result==="MISS").length;
  const p = arr.filter(r=>r.result==="PUSH").length;
  const rate = h+m ? (h/(h+m)*100).toFixed(1)+"%" : "0.0%";
  console.log(`${label}: ${h}-${m}-${p} | graded=${h+m} | hitRate=${rate}`);
}

const graded = JSON.parse(fs.readFileSync("outputs/all-markets-graded.json","utf8"));
const research = JSON.parse(fs.readFileSync("outputs/full-board-research-graded.json","utf8"));
const fantasy = fs.existsSync("outputs/fantasy-graded.json")
  ? JSON.parse(fs.readFileSync("outputs/fantasy-graded.json","utf8"))
  : [];

console.log("\n=== PRODUCTION (SLIPS) ===");
stat("ALL", graded);
stat("HITS MORE", graded.filter(r=>r.market==="HITS" && r.side==="MORE"));
stat("STRIKEOUTS LESS", graded.filter(r=>r.market==="STRIKEOUTS" && r.side==="LESS"));

console.log("\n=== FULL BOARD RESEARCH ===");
stat("ALL", research);
stat("STRIKEOUTS MORE", research.filter(r=>r.market==="STRIKEOUTS" && r.side==="MORE"));
stat("STRIKEOUTS LESS", research.filter(r=>r.market==="STRIKEOUTS" && r.side==="LESS"));
stat("HRR MORE", research.filter(r=>r.market==="HRR" && r.side==="MORE"));
stat("HRR LESS", research.filter(r=>r.market==="HRR" && r.side==="LESS"));
stat("RUNS MORE", research.filter(r=>r.market==="RUNS" && r.side==="MORE"));
stat("RBIS MORE", research.filter(r=>r.market==="RBIS" && r.side==="MORE"));

console.log("\n=== FANTASY ===");
stat("FANTASY ALL", fantasy);
stat("PITCHER FANTASY", fantasy.filter(r=>String(r.stat||"").toLowerCase().includes("pitcher")));
stat("HITTER FANTASY", fantasy.filter(r=>String(r.stat||"").toLowerCase().includes("hitter")));

console.log("\n=== CURRENT RULES ===");
console.log(`
KEEP:
- Hits MORE
- Strikeouts LESS only if line >= 5.5 and gap >= 0.60
- No duplicate props: MAX_PROP_EXPOSURE = 1
- Standard
- Goblin allowed, but goblin Hits MORE banned

BAN:
- Demons
- Bases
- HRR
- Fantasy
- Runs
- RBIs
- Strikeouts MORE
`);
