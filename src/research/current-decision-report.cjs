const fs = require("fs");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "n/a";
}

const official = readJson("outputs/playable-final-slips.json", []);
const leanReport = readJson("outputs/lean-final-slips.json", {});
const blocked = readJson("outputs/blocked-final-candidates.json", []);

const leans = Array.isArray(leanReport.leans) ? leanReport.leans : [];

console.log("CURRENT MLB PROP DECISION");
console.log("=========================");
console.log(`official slips: ${official.length}`);
console.log(`leans: ${leans.length}`);
console.log("");

if (official.length) {
  console.log("OFFICIAL PLAYS");
  console.log("--------------");
  for (const slip of official) {
    console.log(`${slip.name || "slip"} | ${slip.status || ""} | EV=${slip.trueEVPct ?? "n/a"}`);
    for (const leg of slip.legs || []) {
      console.log(`- ${leg.player} | ${leg.market} ${leg.side} ${leg.line} | prob=${pct(leg.prob)} | edge=${pct(leg.edge)}`);
    }
  }
} else {
  console.log("OFFICIAL PLAYS");
  console.log("--------------");
  console.log("none");
}

console.log("");
console.log("BEST LEANS");
console.log("----------");

if (!leans.length) {
  console.log("none");
} else {
  for (const l of leans.slice(0, 5)) {
    const sideBias = l.fullBoardSideBias || {};
    console.log(
      `- ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | ` +
      `${l.oddsTier || "standard"} | prob=${pct(l.prob)} | edge=${pct(l.edge)} | ` +
      `support=${l.support || "n/a"} | sideBias=${sideBias.tier || "n/a"} | sideROI=${pct(sideBias.roi)}`
    );
    if (Array.isArray(l.leanNotes) && l.leanNotes.length) {
      console.log(`  notes: ${l.leanNotes.join(", ")}`);
    }
  }
}

console.log("");
console.log("TOP BLOCKED");
console.log("-----------");

for (const b of blocked.slice(0, 10)) {
  console.log(
    `- ${b.player} | ${b.market} ${b.side} ${b.line} | ` +
    `prob=${pct(b.prob)} | edge=${pct(b.edge)} | reason=${b.reason || b.disabledReason || "n/a"}`
  );
}
