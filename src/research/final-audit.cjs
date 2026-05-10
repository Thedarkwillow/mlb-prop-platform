const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const final = read("outputs/final-slips.json", { slips: [] });
const playable = read("outputs/playable-final-slips.json", []);
const legs = (final.slips || []).flatMap(s => s.legs || []);

const failures = [];

const hrrMore = legs.filter(l =>
  String(l.market || l.stat || "").toLowerCase() === "hrr" &&
  String(l.side || l.recommendedSide || "").toUpperCase() === "MORE"
);

const fantasy = legs.filter(l =>
  String(l.market || l.stat || "").toLowerCase().includes("fantasy")
);

const suppressed = legs.filter(l => l.marketTrust?.suppressed === true);

const playableCount = Array.isArray(playable)
  ? playable.length
  : Array.isArray(playable.slips)
    ? playable.slips.length
    : 0;

if (hrrMore.length) failures.push(`HRR MORE leaked into final slips: ${hrrMore.length}`);
if (fantasy.length) failures.push(`Fantasy leaked into final slips: ${fantasy.length}`);
if (suppressed.length) failures.push(`Suppressed market leaked into final slips: ${suppressed.length}`);
if (playableCount <= 0) failures.push("No playable final slips found");

console.log("FINAL AUDIT");
console.log("===========");
console.log(`Final legs: ${legs.length}`);
console.log(`Playable slips: ${playableCount}`);
console.log(`HRR MORE legs: ${hrrMore.length}`);
console.log(`Fantasy legs: ${fantasy.length}`);
console.log(`Suppressed legs: ${suppressed.length}`);

if (failures.length) {
  console.log("");
  console.log("FAILURES");
  for (const f of failures) console.log(`- ${f}`);
  process.exit(1);
}

console.log("AUDIT PASSED");
