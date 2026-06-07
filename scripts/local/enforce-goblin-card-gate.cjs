const fs = require("fs");

const CARD = "outputs/goblin-recommended-card.json";
const GATE_JSON = "outputs/goblin-construction-gate-audit.json";
const OUT_TXT = "outputs/goblin-card-gate-enforcement.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.legs ||
    v.slip ||
    v.picks ||
    v.slipType ||
    v.status ||
    v.passed === true ||
    v.gateStatus
  ) out.push(v);

  for (const val of Object.values(v)) flatten(val, out);
  return out;
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function legKey(l) {
  return [
    norm(l.player || l.playerName || l.name),
    norm(l.market || l.statType || l.projectionType),
    norm(l.side || l.pick || l.direction),
    String(l.line ?? l.target ?? l.value ?? "")
  ].join(":");
}

function slipLegs(x) {
  if (Array.isArray(x?.legs)) return x.legs;
  if (Array.isArray(x?.slip)) return x.slip;
  if (Array.isArray(x?.picks)) return x.picks;
  return [];
}

function slipKey(x) {
  return slipLegs(x).map(legKey).sort().join("|");
}

function isPassed(x) {
  const raw = JSON.stringify({
    status: x.status,
    gateStatus: x.gateStatus,
    passed: x.passed,
    result: x.result,
    decision: x.decision
  }).toLowerCase();

  return x.pass === true || x.passed === true || /passed|pass|approved|playable/.test(raw);
}

const card = readJson(CARD, null);
const gate = readJson(GATE_JSON, null);
const lines = [];

if (!card) {
  fs.writeFileSync(OUT_TXT, "No goblin card found.\n");
  console.log("No goblin card found.");
  process.exit(0);
}

const gateRows = flatten(gate);
const passedRows = gateRows.filter(isPassed);
const passedKeys = new Set(passedRows.map(slipKey).filter(Boolean));

const primary =
  card.primary ||
  card.primaryCard ||
  card.recommended ||
  card.card ||
  card.best ||
  null;

const primaryArray = Array.isArray(primary) ? primary : (primary ? [primary] : []);
const primaryPasses = primaryArray.some(x => passedKeys.has(slipKey(x)));

lines.push("GOBLIN CARD GATE ENFORCEMENT");
lines.push("============================");
lines.push(`gateRows=${gateRows.length}`);
lines.push(`passedRows=${passedRows.length}`);
lines.push(`primaryRows=${primaryArray.length}`);
lines.push(`primaryPasses=${primaryPasses}`);

if (!passedRows.length) {
  card.gateEnforcement = {
    generatedAt: new Date().toISOString(),
    status: "NO_PASSED_GATE_ROWS",
    note: "No passed construction-gate rows found. Card should be treated as no-play."
  };
  card.status = "NO_PLAY_GOBLIN_GATE";
  card.primary = [];
  lines.push("action=NO_PLAY_GOBLIN_GATE");
  writeJson(CARD, card);
  fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  process.exit(0);
}

if (!primaryPasses) {
  const replacement = passedRows[0];
  card.gateEnforcement = {
    generatedAt: new Date().toISOString(),
    status: "PRIMARY_REPLACED_WITH_GATE_PASSED_ROW",
    originalPrimaryCount: primaryArray.length,
    replacementKey: slipKey(replacement)
  };
  card.primary = [replacement];
  card.status = "PLAYABLE_GOBLIN_CARD_AVAILABLE_GATE_PASSED";

  lines.push("action=PRIMARY_REPLACED_WITH_GATE_PASSED_ROW");
  lines.push(`replacement=${slipKey(replacement)}`);
  writeJson(CARD, card);
} else {
  card.gateEnforcement = {
    generatedAt: new Date().toISOString(),
    status: "PRIMARY_ALREADY_GATE_PASSED"
  };
  lines.push("action=PRIMARY_ALREADY_GATE_PASSED");
  writeJson(CARD, card);
}

fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");
console.log(lines.join("\n"));
