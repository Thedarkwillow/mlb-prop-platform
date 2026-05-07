const fs = require("fs");

const data = JSON.parse(fs.readFileSync("outputs/final-slips.json", "utf8"));

console.log("\nBEST FINAL SLIPS\n");

for (const slip of data.slips || []) {
  console.log(`${slip.name}`);
  console.log("-".repeat(slip.name.length));

  for (const [i, leg] of slip.legs.entries()) {
    console.log(`${i + 1}. ${leg.player} (${leg.team}) — ${leg.market.toUpperCase()} ${leg.side} ${leg.line} | edge ${leg.edge} | books ${leg.books} | ${leg.grade}`);
  }

  console.log("");
}
