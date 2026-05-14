const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normMarket(s) {
  return String(s || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function sideKey(x = {}) {
  return String(x.side || x.recommendedSide || "").toUpperCase().trim() || "NA";
}

function loadRollingRoi() {
  return readJson("data/results/rolling-roi-windows.json", null);
}

function loadValidationRules() {
  const raw = readJson("data/results/validation-rules.json", []);
  if (Array.isArray(raw)) return raw;

  return [
    ...(raw.byProbability || []),
    ...(raw.byMarket || []),
    ...(raw.byBooks || [])
  ];
}

function findRolling(report, marketSide) {
  const windows = ["7d", "15d", "30d"];
  const out = [];

  for (const w of windows) {
    const rows = report?.windows?.[w]?.byMarketSide || [];
    const row = rows.find(r =>
      String(r.bucket || "").toLowerCase() === String(marketSide || "").toLowerCase()
    );
    if (row) out.push({ window: w, ...row });
  }

  return out;
}

function findValidationRule(rules, marketSide) {
  return rules.find(r =>
    String(r.type || "").toLowerCase() === "market" &&
    String(r.bucket || "").toLowerCase() === String(marketSide || "").toLowerCase()
  ) || null;
}

function autoMarketDecision(leg = {}) {
  const market = normMarket(leg.market || leg.stat);
  const side = sideKey(leg);
  const marketSide = `${market} ${side}`;

  const rolling = loadRollingRoi();
  const rules = loadValidationRules();

  const rollingRows = findRolling(rolling, marketSide);
  const validationRule = findValidationRule(rules, marketSide);

  const notes = [];
  let action = "ALLOW";
  let probabilityAdjustment = 0;
  let edgeMultiplier = 1;
  let confidenceAdjustment = 0;

  const strongRollingBad = rollingRows.some(r =>
    Number(r.count || 0) >= 5 &&
    Number(r.roi) <= -0.25 &&
    Number(r.hitRate) < 0.48
  );

  const mediumRollingBad = rollingRows.some(r =>
    Number(r.count || 0) >= 3 &&
    Number(r.roi) <= -0.30
  );

  const validationBad =
    validationRule &&
    Number(validationRule.count || 0) >= 20 &&
    Number(validationRule.actual) < 0.48 &&
    Number(validationRule.calibrationEdge || 0) <= -0.12;

  const validationMediumBad =
    validationRule &&
    Number(validationRule.count || 0) >= 10 &&
    Number(validationRule.calibrationEdge || 0) <= -0.15;

  if (validationBad || strongRollingBad) {
    action = "SUPPRESS";
    probabilityAdjustment -= 0.06;
    edgeMultiplier *= 0.65;
    confidenceAdjustment -= 3;
    notes.push(validationBad ? "validation hard suppression" : "rolling ROI hard suppression");
  } else if (validationMediumBad || mediumRollingBad) {
    action = "DOWNGRADE";
    probabilityAdjustment -= 0.03;
    edgeMultiplier *= 0.80;
    confidenceAdjustment -= 2;
    notes.push(validationMediumBad ? "validation downgrade" : "rolling ROI downgrade");
  }

  const rollingStrong = rollingRows.some(r =>
    Number(r.count || 0) >= 8 &&
    Number(r.roi) >= 0.20 &&
    Number(r.hitRate) >= 0.58
  );

  const validationStrong =
    validationRule &&
    Number(validationRule.count || 0) >= 25 &&
    Number(validationRule.actual) >= 0.58 &&
    Number(validationRule.calibrationEdge || 0) >= -0.04;

  if (action === "ALLOW" && (rollingStrong || validationStrong)) {
    action = "BOOST_OK";
    probabilityAdjustment += 0.01;
    edgeMultiplier *= 1.03;
    confidenceAdjustment += 1;
    notes.push(rollingStrong ? "rolling ROI strength" : "validated market strength");
  }

  return {
    marketSide,
    action,
    suppressed: action === "SUPPRESS",
    probabilityAdjustment: Number(probabilityAdjustment.toFixed(4)),
    edgeMultiplier: Number(edgeMultiplier.toFixed(4)),
    confidenceAdjustment,
    notes,
    rolling: rollingRows,
    validationRule: validationRule || null
  };
}

module.exports = {
  autoMarketDecision
};
