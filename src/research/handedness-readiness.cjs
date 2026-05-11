const fs = require("fs");

const rows = JSON.parse(fs.readFileSync("outputs/priced-board.json", "utf8"));
const props = rows.filter(r => r.recordType === "merged_prop");

function market(r) {
  return String(r.market || r.stat || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function isPitcherMarket(r) {
  const m = market(r);
  return (
    m.includes("strikeout") ||
    m.includes("pitching") ||
    m.includes("outs") ||
    m.includes("earned_runs_allowed") ||
    m.includes("hits_allowed")
  );
}

const matched = props.filter(r => r.handednessMatched);
const active = props.filter(r => r.handednessContext?.active);

const batterRows = matched.filter(r => !isPitcherMarket(r));
const pitcherRows = matched.filter(r => isPitcherMarket(r));

const missingPitcherHand = batterRows.filter(r => !r.handednessContext?.pitcherHand);
const missingBatterStand = pitcherRows.filter(r => !r.handednessContext?.batterStand);

const out = {
  generatedAt: new Date().toISOString(),
  totalProps: props.length,
  handednessMatched: matched.length,
  activeKnown: active.length,
  batterRows: batterRows.length,
  pitcherRows: pitcherRows.length,
  missingPitcherHand: missingPitcherHand.length,
  missingBatterStand: missingBatterStand.length,
  status: active.length > 0 ? "PARTIAL_ACTIVE" : "MATCHED_BUT_NEEDS_HAND_FIELDS"
};

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/handedness-readiness.json", JSON.stringify(out, null, 2) + "\n");

console.log("HANDEDNESS READINESS");
console.log("====================");
console.table([out]);

console.log("");
console.log("Missing pitcher hand examples:");
console.table(missingPitcherHand.slice(0, 12).map(r => ({
  player: r.player,
  market: r.market,
  game: r.game,
  team: r.team,
  matchType: r.handednessMatchType
})));

console.log("");
console.log("Missing batter stand examples:");
console.table(missingBatterStand.slice(0, 12).map(r => ({
  player: r.player,
  market: r.market,
  game: r.game,
  team: r.team,
  matchType: r.handednessMatchType
})));
