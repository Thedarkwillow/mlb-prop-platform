const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function nline(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(1) : "";
}

function fantasyType(row) {
  const raw = row.fantasyType || row.stat || row.market || row.projectionType || "";
  const n = norm(raw);
  if (n.includes("pitcher")) return "Pitcher Fantasy Score";
  if (n.includes("hitter")) return "Hitter Fantasy Score";
  return raw || "Fantasy Score";
}

function resultOpposite(r) {
  const x = String(r || "").toUpperCase();
  if (x === "HIT") return "MISS";
  if (x === "MISS") return "HIT";
  if (x === "PUSH") return "PUSH";
  return "UNGRADED";
}

const graded = readJson("outputs/fantasy-graded.json", []);
const rows = Array.isArray(graded) ? graded : [];

const out = [];

for (const r of rows) {
  const side = String(r.side || "").toUpperCase();
  const type = fantasyType(r);
  const base = {
    player: r.player,
    team: r.team || null,
    type,
    side: side || "UNKNOWN",
    line: r.line,
    actual: r.actual ?? null,
    result: r.result || "UNGRADED",
    source: "fantasy-graded",
    syntheticInverse: false
  };

  out.push(base);

  if (side === "MORE" && ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase())) {
    out.push({
      ...base,
      side: "LESS",
      result: resultOpposite(r.result),
      source: "fantasy-graded-inverse",
      syntheticInverse: true
    });
  }
}

function summarize(list) {
  const m = new Map();
  for (const r of list) {
    const key = [r.type, r.side, r.result, r.syntheticInverse ? "synthetic" : "direct"].join("|");
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => {
    const [type, side, result, sourceType] = key.split("|");
    return { type, side, result, sourceType, count };
  }).sort((a,b) =>
    a.type.localeCompare(b.type) ||
    a.side.localeCompare(b.side) ||
    a.result.localeCompare(b.result) ||
    a.sourceType.localeCompare(b.sourceType)
  );
}

const direct = out.filter(x => !x.syntheticInverse);
const syntheticLess = out.filter(x => x.syntheticInverse && x.side === "LESS");
const lessGraded = syntheticLess.filter(x => x.result === "HIT" || x.result === "MISS");
const lessHits = lessGraded.filter(x => x.result === "HIT").length;
const lessMisses = lessGraded.filter(x => x.result === "MISS").length;
const lessHitRate = lessGraded.length ? lessHits / lessGraded.length : null;

const report = {
  generatedAt: new Date().toISOString(),
  note: "Fantasy MORE is direct graded data. Fantasy LESS is inferred from same-line MORE grades unless direct LESS exists later.",
  policy: {
    fantasyPlayable: false,
    reason: "Keep fantasy suppressed until direct LESS sample exists and side-specific ROI is validated."
  },
  totals: {
    directRows: direct.length,
    syntheticInverseRows: out.filter(x => x.syntheticInverse).length,
    inferredLessGraded: lessGraded.length,
    inferredLessHits: lessHits,
    inferredLessMisses: lessMisses,
    inferredLessHitRate: lessHitRate == null ? null : Number(lessHitRate.toFixed(4))
  },
  summary: summarize(out),
  rows: out
};

fs.writeFileSync("outputs/fantasy-side-tracking.json", JSON.stringify(report, null, 2) + "\n");

console.log("FANTASY SIDE TRACKING");
console.log("=====================");
console.log(JSON.stringify(report.totals, null, 2));
console.table(report.summary);
console.log("Wrote outputs/fantasy-side-tracking.json");
