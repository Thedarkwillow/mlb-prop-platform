const fs = require("fs");

function readJson(p, fallback = {}) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function line(s = "") { return s + "\n"; }

const phase5 = readJson("data/learning/phase5-market-trust.json", {});
const phase6 = readJson("data/learning/phase6-calibration-shrinkage.json", {});
const regime = readJson("data/learning/phase6-regime-detection.json", {});
const exposure = readJson("data/learning/phase6-exposure-governor.json", {});
const attribution = readJson("data/learning/phase6-feature-attribution.json", {});
const react = readJson("data/learning/phase6-reactivation.json", {});

const suppress = Object.values(phase5.rows || {}).filter(r => String(r.action || "").includes("SUPPRESS"));
const down = Object.values(phase5.rows || {}).filter(r => String(r.action || "").includes("DOWN"));
const boost = Object.values(phase5.rows || {}).filter(r => String(r.action || "").includes("BOOST"));
const badRegime = Object.values(regime.rows || {}).filter(r => ["TIGHTEN","SUPPRESS_RECENT"].includes(r.action));

let txt = "";
txt += line("PHASE 6 ADAPTIVE INTELLIGENCE DASHBOARD");
txt += line("=======================================");
txt += line(`Generated: ${new Date().toISOString()}`);
txt += line("");
txt += line("Exposure Governor");
txt += line("-----------------");
txt += line(`Risk Level: ${exposure.riskLevel || "UNKNOWN"}`);
txt += line(`Reasons: ${(exposure.reasons || []).join(", ") || "none"}`);
txt += line(`Max Slip Size: ${exposure.governor?.maxSlipSize ?? "n/a"}`);
txt += line(`Score Multiplier: ${exposure.governor?.scoreMultiplier ?? "n/a"}`);
txt += line("");
txt += line("Suppressed / Downweighted Markets");
txt += line("---------------------------------");
for (const r of [...suppress, ...down].slice(0, 20)) {
  txt += line(`${r.key || ""} | sample=${r.sample} | hitRate=${r.hitRate} | action=${r.action} | weight=${r.weight}`);
}
txt += line("");
txt += line("Boosted Markets");
txt += line("---------------");
for (const r of boost.slice(0, 20)) {
  txt += line(`${r.key || ""} | sample=${r.sample} | hitRate=${r.hitRate} | action=${r.action} | weight=${r.weight}`);
}
txt += line("");
txt += line("Weak / Tightened Regimes");
txt += line("------------------------");
for (const r of badRegime.slice(0, 20)) {
  txt += line(`${r.key || ""} | action=${r.action} | d3=${r.d3} | d7=${r.d7} | d14=${r.d14}`);
}
txt += line("");
txt += line("Top Positive Features");
txt += line("---------------------");
for (const r of attribution.topPositive || []) {
  txt += line(`${r.feature}:${r.value} | sample=${r.sample} | hitRate=${r.hitRate} | action=${r.action} | weight=${r.weight}`);
}
txt += line("");
txt += line("Top Negative Features");
txt += line("---------------------");
for (const r of attribution.topNegative || []) {
  txt += line(`${r.feature}:${r.value} | sample=${r.sample} | hitRate=${r.hitRate} | action=${r.action} | weight=${r.weight}`);
}
txt += line("");
txt += line("Reactivation Watch");
txt += line("------------------");
for (const r of react.reactivated || []) {
  txt += line(`${r.key} | sample=${r.sample} | hitRate=${r.hitRate} | d7=${r.d7} | ${r.reactivation}`);
}

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/phase6-dashboard.txt", txt);
console.log(txt);
console.log("Wrote outputs/phase6-dashboard.txt");
