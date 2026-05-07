// src/jobs/calibrationEngine.js

const fs = require("fs");

const data = JSON.parse(fs.readFileSync("outputs/priced-board.json", "utf8"));

function bucket(p) {
  if (p < 0.55) return "50-54.9%";
  if (p < 0.60) return "55-59.9%";
  if (p < 0.65) return "60-64.9%";
  if (p < 0.70) return "65-69.9%";
  if (p < 0.75) return "70-74.9%";
  return "75%+";
}

const buckets = {};

for (const r of data) {
  const p = Number(r.recommendedProb);
  const result = (r.result || "").toLowerCase();

  if (!p || !["hit", "miss"].includes(result)) continue;

  const b = bucket(p);
  if (!buckets[b]) buckets[b] = { wins: 0, losses: 0 };

  if (result === "hit") buckets[b].wins++;
  else buckets[b].losses++;
}

function rate(w, l) {
  return (w + l) ? ((w / (w + l)) * 100).toFixed(1) + "%" : "0%";
}

let out = ["CALIBRATION REPORT"];

for (const [b, v] of Object.entries(buckets)) {
  out.push(`${b}: ${v.wins}-${v.losses} | Hit: ${rate(v.wins, v.losses)}`);
}

fs.writeFileSync("outputs/calibration.txt", out.join("\n"));
console.log("Saved calibration report");
