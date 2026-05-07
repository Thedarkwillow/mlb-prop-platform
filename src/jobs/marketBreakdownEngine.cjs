// src/jobs/marketBreakdownEngine.js

const fs = require("fs");

const data = JSON.parse(fs.readFileSync("outputs/multi-day-performance.json", "utf8"));

const markets = data.byMarket || {};

function rate(w, l) {
  return (w + l) ? ((w / (w + l)) * 100).toFixed(1) + "%" : "0%";
}

let out = ["MARKET BREAKDOWN"];

for (const [m, v] of Object.entries(markets)) {
  out.push(`${m}: ${v.wins}-${v.losses} | Hit: ${rate(v.wins, v.losses)} | Pending: ${v.pending}`);
}

fs.writeFileSync("outputs/market-breakdown.txt", out.join("\n"));
console.log("Saved market breakdown");
