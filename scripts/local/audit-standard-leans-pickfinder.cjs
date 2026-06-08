const fs = require("fs");
const path = require("path");

const BOARD = "outputs/priced-board.json";
const PF_PROPS = "outputs/pickfinder-mlb-props.json";
const PF_POPULAR = "outputs/pickfinder-mlb-popular.json";
const PF_DISC = "outputs/pickfinder-mlb-discrepancies.json";
const OUT = "outputs/standard-leans-pickfinder-audit.json";
const TXT = "outputs/standard-leans-pickfinder-audit.txt";

const TEAM_ALIAS = {
  "NY-A": "NYY", NYA: "NYY",
  ANA: "LAA",
  LA: "LAD",
  AZ: "ARI",
  WAS: "WSH",
  OAK: "ATH",
  "CHI-N": "CHC", CHN: "CHC",
  "CHI-A": "CWS", CHA: "CWS",
  KAN: "KC",
  SL: "STL"
};

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function text(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function s(v) {
  return String(v ?? "").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normName(v) {
  return s(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function team(v) {
  const x = s(v).toUpperCase();
  return TEAM_ALIAS[x] || x;
}

function playerName(r) {
  return s(r.player || r.playerName || r.player_name || r.fullName || r.displayName || r.name);
}

function rowTeam(r) {
  return team(r.team || r.teamAbbr || r.playerTeam || r.player_team || "");
}

function market(r) {
  return s(r.market || r.statType || r.stat_type || r.type || r.projection_type);
}

function side(r) {
  return s(r.side || r.pick || r.prediction || r.direction || "").toUpperCase();
}

function line(r) {
  return num(r.line ?? r.projectionLine ?? r.threshold ?? r.value);
}

function tier(r) {
  return s(r.tier || r.oddsTier || r.type || r.promoType || r.discountType).toLowerCase();
}

function prob(r) {
  const keys = [
    "probability", "finalProbability", "modelProbability", "winProbability",
    "hitProbability", "hitProb", "moreProb", "overProb", "lessProb", "underProb",
    "prob", "p"
  ];
  for (const k of keys) {
    if (r[k] !== undefined) {
      const n = num(r[k]);
      if (n !== null) return n > 1 ? n / 100 : n;
    }
  }
  return null;
}

function ev(r) {
  const keys = ["ev", "EV", "expectedValue", "edgeValue", "value"];
  for (const k of keys) {
    if (r[k] !== undefined) {
      const n = num(r[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

function projection(r) {
  const keys = ["projection", "rawProjection", "contextAdjustedProjection", "modelProjection", "projectedValue"];
  for (const k of keys) {
    if (r[k] !== undefined) {
      const n = num(r[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.player_name || v.market || v.statType || v.line || v.player_id) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x, out);
  return out;
}

function buildPfIndex(...files) {
  const idx = new Map();
  const fieldCounts = {};
  for (const file of files) {
    const data = read(file, {});
    const rows = flat(data.props || data.popular || data.discrepancies || data);
    for (const r of rows) {
      for (const k of Object.keys(r || {})) fieldCounts[k] = (fieldCounts[k] || 0) + 1;
      const p = normName(playerName(r));
      const t = rowTeam(r);
      if (!p) continue;
      const k = `${p}|${t}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(r);
    }
  }
  return { idx, fieldCounts };
}

const board = read(BOARD, []);
const rows = flat(board);
const { idx: pfIndex, fieldCounts } = buildPfIndex(PF_PROPS, PF_POPULAR, PF_DISC);

const standard = rows.filter(r => {
  const tr = tier(r);
  if (/goblin|demon|special|discount/i.test(tr)) return false;
  const p = playerName(r);
  const m = market(r);
  if (!p || !m) return false;
  return true;
});

const candidates = [];
const byReject = {};

function reject(reason) {
  byReject[reason] = (byReject[reason] || 0) + 1;
}

for (const r of standard) {
  const p = playerName(r);
  const t = rowTeam(r);
  const m = market(r);
  const sd = side(r);
  const ln = line(r);
  const pr = prob(r);
  const evv = ev(r);
  const proj = projection(r);
  const ls = s(r.lineupStatus || r.confirmedLineupStatus || "").toUpperCase();
  const src = s(r.lineupSource || r.confirmedLineupSource || r.sourceLineup || "").toUpperCase();

  if (!/CONFIRMED/.test(ls)) {
    reject("lineup_not_confirmed");
    continue;
  }

  const key = `${normName(p)}|${t}`;
  const pfRows = pfIndex.get(key) || [];
  const pfMatched = pfRows.length > 0;

  let score = 0;
  const reasons = [];

  if (pr !== null) {
    score += pr * 100;
    if (pr >= 0.62) reasons.push(`modelProb=${pr.toFixed(3)}`);
  }
  if (evv !== null) {
    score += Math.max(-5, Math.min(20, evv * 10));
    if (evv > 0) reasons.push(`EV=${evv.toFixed(3)}`);
  }
  if (pfMatched) {
    score += 8;
    reasons.push(`PF_MATCHED=${pfRows.length}`);
  }
  if (/PICKFINDER/.test(src)) {
    score += 6;
    reasons.push("PF_LINEUP_CONFIRMED");
  } else if (/CONFIRMED/.test(ls)) {
    score += 3;
    reasons.push("LINEUP_CONFIRMED");
  }

  if (proj !== null && ln !== null && sd) {
    const gap = sd.includes("MORE") || sd.includes("OVER")
      ? proj - ln
      : ln - proj;
    if (Number.isFinite(gap)) {
      score += Math.max(-8, Math.min(12, gap * 4));
      reasons.push(`gap=${gap.toFixed(2)}`);
    }
  }

  const conf = s(r.confidence || r.confidenceTier || r.modelConfidence || "");
  const risk = s(r.riskStatus || r.risk || r.blockReason || "");
  const sample = s(r.sampleStatus || r.sample || "");
  if (/BLOCK|SUPPRESS|CONFLICT|NEGATIVE/i.test(risk)) {
    score -= 30;
    reasons.push(`risk=${risk}`);
  }
  if (/MISSING|PENDING/i.test(sample)) {
    score -= 5;
    reasons.push(`sample=${sample}`);
  }
  if (/elite|high|green/i.test(conf)) {
    score += 5;
    reasons.push(`conf=${conf}`);
  }

  if (score < 65 && !(pr !== null && pr >= 0.62 && pfMatched)) {
    reject("score_below_lean_threshold");
    continue;
  }

  const pfFieldPreview = pfRows.slice(0, 3).map(x => {
    const out = {};
    for (const [k,v] of Object.entries(x || {})) {
      if (/hit|rate|last|diff|consensus|over|under|line|projection|prop|market|book|odds|team/i.test(k)) {
        out[k] = v;
      }
    }
    return out;
  });

  candidates.push({
    player: p,
    team: t,
    game: r.game || r.matchup,
    market: m,
    side: sd,
    line: ln,
    probability: pr,
    ev: evv,
    projection: proj,
    confidence: conf,
    lineupStatus: ls,
    lineupSource: src,
    tier: tier(r) || "standard",
    score: +score.toFixed(2),
    reasons,
    pfMatched,
    pfRows: pfRows.length,
    pfFieldPreview
  });
}

candidates.sort((a,b) => b.score - a.score);

const report = {
  generatedAt: new Date().toISOString(),
  boardRows: rows.length,
  standardRows: standard.length,
  pfPlayersIndexed: pfIndex.size,
  candidateCount: candidates.length,
  byReject,
  topCandidates: candidates.slice(0, 80),
  availablePickFinderFields: Object.entries(fieldCounts).sort((a,b)=>b[1]-a[1]).slice(0, 160)
};

write(OUT, report);

const lines = [];
lines.push("STANDARD LEANS + PICKFINDER AUDIT");
lines.push("=================================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`boardRows=${report.boardRows}`);
lines.push(`standardRows=${report.standardRows}`);
lines.push(`pfPlayersIndexed=${report.pfPlayersIndexed}`);
lines.push(`candidateCount=${report.candidateCount}`);
lines.push("");
lines.push("REJECTS");
lines.push("-------");
for (const [k,v] of Object.entries(byReject).sort((a,b)=>b[1]-a[1])) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("TOP STANDARD LEAN CANDIDATES");
lines.push("----------------------------");
for (const c of candidates.slice(0, 40)) {
  lines.push(`${c.player} | ${c.team} | ${c.game || "?"} | ${c.market} ${c.side} ${c.line} | score=${c.score} | prob=${c.probability ?? "?"} | ev=${c.ev ?? "?"} | lineup=${c.lineupStatus}/${c.lineupSource} | pfRows=${c.pfRows}`);
  lines.push(`  reasons=${c.reasons.join("; ")}`);
}
lines.push("");
lines.push("AVAILABLE PICKFINDER FIELDS");
lines.push("---------------------------");
for (const [k,v] of report.availablePickFinderFields) lines.push(`${k}: ${v}`);

text(TXT, lines.join("\n") + "\n");

console.log({
  boardRows: report.boardRows,
  standardRows: report.standardRows,
  pfPlayersIndexed: report.pfPlayersIndexed,
  candidateCount: report.candidateCount,
  top: candidates.slice(0, 10).map(c => `${c.player} ${c.market} ${c.side} ${c.line} score=${c.score}`),
  out: OUT,
  txt: TXT
});
