const fs = require("fs");

const files = [
  "outputs/pickfinder-network.json",
  "outputs/pickfinder-network-latest.json",
  "outputs/pickfinder-props.json",
  "outputs/pickfinder-lineups.json"
];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v === "object") {
    out.push(v);
    for (const x of Object.values(v)) flatten(x, out);
  }
  return out;
}

function asUrl(x) {
  return String(
    x.url ||
    x.requestUrl ||
    x.endpoint ||
    x.href ||
    x.resource ||
    ""
  );
}

function scoreEndpoint(obj) {
  const text = JSON.stringify(obj).toLowerCase();
  const url = asUrl(obj).toLowerCase();

  let score = 0;
  if (/lineup|lineups|batting.?order|confirmed|probable/.test(url)) score += 6;
  if (/lineup|lineups|batting.?order|confirmed|probable/.test(text)) score += 4;
  if (/player|team|game|mlb/.test(url)) score += 2;
  if (/props|projection|markets/.test(url)) score += 1;
  if (/pickfinder/.test(url)) score += 1;

  return score;
}

const found = [];

for (const f of files) {
  const data = readJson(f);
  if (!data) continue;

  const objs = flatten(data);
  for (const obj of objs) {
    const url = asUrl(obj);
    const score = scoreEndpoint(obj);
    if (score >= 4) {
      found.push({
        file: f,
        score,
        url,
        method: obj.method || obj.requestMethod || "",
        status: obj.status || obj.statusCode || "",
        keys: Object.keys(obj).slice(0, 30)
      });
    }
  }
}

found.sort((a, b) => b.score - a.score);

const report = {
  generatedAt: new Date().toISOString(),
  checkedFiles: files,
  candidateCount: found.length,
  bestCandidates: found.slice(0, 30),
  verdict: found.length
    ? "Possible PickFinder lineup/probable source candidates found. Inspect bestCandidates before trusting lineup source."
    : "No local PickFinder lineup source found. Need to run/refresh the local Playwright network inspector to verify source."
};

fs.writeFileSync("outputs/audits/pickfinder-lineup-source-report.json", JSON.stringify(report, null, 2));

console.log("=== PickFinder Lineup Source Verification ===");
console.log("Candidates:", found.length);
if (found.length) {
  for (const c of found.slice(0, 10)) {
    console.log(`score=${c.score} status=${c.status || "-"} ${c.url || "(no url)"} [${c.file}]`);
  }
} else {
  console.log("No local PF lineup endpoint found in existing outputs.");
  console.log("Run your local PickFinder inspector if you need fresh network proof.");
}
console.log("Saved: outputs/audits/pickfinder-lineup-source-report.json");
