const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILE = `outputs/playable-final-slips-graded-${DATE}.json`;

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function declaredSize(slip) {
  const n = Number(
    slip?.size ??
    slip?.slipSize ??
    slip?.declaredSize ??
    slip?.legCount ??
    0
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function actualLegCount(slip) {
  if (Array.isArray(slip?.legs)) return slip.legs.length;
  if (Array.isArray(slip?.props)) return slip.props.length;
  if (Array.isArray(slip?.picks)) return slip.picks.length;
  if (Array.isArray(slip?.entries)) return slip.entries.length;
  return 0;
}

const data = readJson(FILE);
if (!data) {
  console.error(`missing graded slip file: ${FILE}`);
  process.exit(1);
}

const slips = Array.isArray(data) ? data : Array.isArray(data.slips) ? data.slips : [];
let repaired = 0;

for (const slip of slips) {
  const need = declaredSize(slip);
  const have = actualLegCount(slip);

  if (need > 0 && have < need) {
    slip.graded = {
      ...(slip.graded || {}),
      clean: false,
      result: "INVALID_PARTIAL",
      invalidPartial: true,
      declaredSize: need,
      actualLegCount: have,
      reason: `partial_slip_${have}_of_${need}_legs`
    };

    slip.complete = false;
    slip.rejected = true;
    slip.rejectReasons = Array.from(new Set([
      ...(Array.isArray(slip.rejectReasons) ? slip.rejectReasons : []),
      `partial_slip_${have}_of_${need}_legs`
    ]));

    repaired++;
  }
}

if (data.overall && typeof data.overall === "object") {
  data.overall.invalidPartial = repaired;
}

writeJson(FILE, data);

console.log("PARTIAL GRADED SLIP REPAIR");
console.log("==========================");
console.log(`date: ${DATE}`);
console.log(`file: ${FILE}`);
console.log(`slips checked: ${slips.length}`);
console.log(`partial slips repaired: ${repaired}`);
