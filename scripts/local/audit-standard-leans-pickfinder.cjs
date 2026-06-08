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

const MARKET_ALIAS = {
  "hitter fantasy score pp": "hitter_fantasy_score",
  "hitter fantasy score": "hitter_fantasy_score",
  "fantasy score": "hitter_fantasy_score",
  "hits+runs+rbis": "hrr",
  "hits runs rbis": "hrr",
  "hrr": "hrr",
  "hits": "hits",
  "singles": "singles",
  "runs": "runs",
  "rbis": "rbis",
  "runs batted in": "rbis",
  "bases": "bases",
  "total bases": "bases",
  "walks": "walks",
  "hitter walks": "walks",
  "hitter strikeouts": "hitter_strikeouts",
  "strikeouts": "strikeouts"
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

function norm(v) {
  return s(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normName(v) {
  return norm(v);
}

function getTeamValue(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    return s(v.abbreviation || v.abbr || v.team || v.name || v.shortName || v.short_name);
  }
  return "";
}

function team(v) {
  const x = s(getTeamValue(v)).toUpperCase();
  return TEAM_ALIAS[x] || x;
}

function playerName(r) {
  return s(r.player || r.playerName || r.player_name || r.fullName || r.displayName || r.name);
}

function rowTeam(r) {
  return team(r.team || r.teamAbbr || r.playerTeam || r.player_team || "");
}

function marketRaw(r) {
  return s(r.market || r.statType || r.stat_type || r.type || r.projection_type || r.stat);
}

function marketKey(v) {
  const n = norm(v).replace(/\bpp\b/g, "pp").trim();
  return MARKET_ALIAS[n] || n.replace(/\s+/g, "_");
}

function market(r) {
  return marketKey(marketRaw(r));
}

function side(r) {
  const raw = s(r.side || r.pick || r.prediction || r.direction || r.selection || "").toUpperCase();
  if (/MORE|OVER/.test(raw)) return "MORE";
  if (/LESS|UNDER/.test(raw)) return "LESS";
  return raw;
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
  if (v.player || v.playerName || v.player_name || v.market || v.statType || v.stat || v.line || v.player_id) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x, out);
  return out;
}

function pfSupportForSide(pf, sd) {
  const l5 = num(pf.hitRateLast5);
  const l10 = num(pf.hitRateLast10);
  const l15 = num(pf.hitRateLast15);
  const diff = num(pf.differencePercent);
  const over = num(pf.consensus_over_ip);
  const under = num(pf.consensus_under_ip);

  const rates = [l5, l10, l15].filter(x => x !== null);
  const avg = rates.length ? rates.reduce((a,b)=>a+b,0) / rates.length : null;

  let score = 0;
  const reasons = [];

  if (avg !== null) {
    if (sd === "MORE") {
      if (avg >= 65) score += 16;
      else if (avg >= 58) score += 8;
      else if (avg >= 52) score += 2;
      else if (avg < 45) score -= 14;
      else score -= 6;
    } else if (sd === "LESS") {
      if (avg <= 35) score += 16;
      else if (avg <= 42) score += 8;
      else if (avg <= 48) score += 2;
      else if (avg > 55) score -= 14;
      else score -= 6;
    }
    reasons.push(`PF_avgHit=${avg.toFixed(1)}%`);
  }

  if (l10 !== null) reasons.push(`PF_L10=${l10}%`);
  if (l15 !== null) reasons.push(`PF_L15=${l15}%`);

  if (diff !== null) {
    if (sd === "MORE") {
      if (diff >= 25) score += 8;
      else if (diff >= 10) score += 4;
      else if (diff < 0) score -= 8;
    } else if (sd === "LESS") {
      if (diff <= -25) score += 8;
      else if (diff <= -10) score += 4;
      else if (diff > 0) score -= 8;
    }
    reasons.push(`PF_diff=${diff}%`);
  }

  if (over !== null && under !== null && (over > 0 || under > 0)) {
    const lean = sd === "MORE" ? over - under : under - over;
    if (lean >= 0.05) score += 5;
    else if (lean <= -0.05) score -= 5;
    reasons.push(`PF_consensusLean=${lean.toFixed(3)}`);
  }

  return {
    score,
    reasons,
    hitRateLast5: l5,
    hitRateLast10: l10,
    hitRateLast15: l15,
    differencePercent: diff,
    consensus_over_ip: over,
    consensus_under_ip: under
  };
}

function buildPfIndex(...files) {
  const rows = [];
  const fieldCounts = {};
  for (const file of files) {
    const data = read(file, {});
    const list = flat(data.props || data.popular || data.discrepancies || data);
    for (const r of list) {
      for (const k of Object.keys(r || {})) fieldCounts[k] = (fieldCounts[k] || 0) + 1;
      const p = normName(playerName(r));
      const t = rowTeam(r);
      const m = market(r);
      const ln = line(r);
      if (!p || !m) continue;
      rows.push({ raw: r, playerNorm: p, team: t, market: m, line: ln });
    }
  }
  return { rows, fieldCounts };
}

function findPfMatches(pfRows, r) {
  const p = normName(playerName(r));
  const t = rowTeam(r);
  const m = market(r);
  const ln = line(r);

  return pfRows.filter(x => {
    if (x.playerNorm !== p) return false;
    if (t && x.team && x.team !== t) return false;
    if (m && x.market !== m) return false;
    if (ln !== null && x.line !== null && Math.abs(Number(x.line) - Number(ln)) > 0.01) return false;
    return true;
  });
}

const board = read(BOARD, []);
const rows = flat(board);
const { rows: pfRows, fieldCounts } = buildPfIndex(PF_PROPS, PF_POPULAR, PF_DISC);

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
const byPfMatch = { exact: 0, none: 0 };

function reject(reason) {
  byReject[reason] = (byReject[reason] || 0) + 1;
}

for (const r of standard) {
  const p = playerName(r);
  const t = rowTeam(r);
  const m = market(r);
  const mr = marketRaw(r);
  let sd = side(r);
  const ln = line(r);
  const pr = prob(r);
  const evv = ev(r);
  const proj = projection(r);
  const ls = s(r.lineupStatus || r.confirmedLineupStatus || "").toUpperCase();
  const src = s(r.lineupSource || r.confirmedLineupSource || r.sourceLineup || "").toUpperCase();

  // If side is missing but projection/line imply direction, infer it only for audit display.
  if (!sd && proj !== null && ln !== null) {
    sd = proj >= ln ? "MORE" : "LESS";
  }

  if (!/CONFIRMED/.test(ls)) {
    reject("lineup_not_confirmed");
    continue;
  }

  const pfMatches = findPfMatches(pfRows, r);
  const pfMatched = pfMatches.length > 0;
  if (pfMatched) byPfMatch.exact++;
  else byPfMatch.none++;

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
    reasons.push(`PF_EXACT_MATCH=${pfMatches.length}`);

    // Best PF support row for the requested side.
    let best = null;
    for (const x of pfMatches) {
      const sup = pfSupportForSide(x.raw, sd);
      if (!best || sup.score > best.score) best = { row: x.raw, ...sup };
    }
    if (best) {
      score += best.score;
      reasons.push(...best.reasons);
    }
  } else {
    score -= 10;
    reasons.push("PF_NO_EXACT_PROP_MATCH");
  }

  if (/PICKFINDER/.test(src)) {
    score += 6;
    reasons.push("PF_LINEUP_CONFIRMED");
  } else if (/CONFIRMED/.test(ls)) {
    score += 3;
    reasons.push("LINEUP_CONFIRMED");
  }

  if (proj !== null && ln !== null && sd) {
    const gap = sd === "MORE" ? proj - ln : ln - proj;
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

  if (score < 65) {
    reject("score_below_lean_threshold");
    continue;
  }

  const pfFieldPreview = pfMatches.slice(0, 3).map(x => ({
    player_name: x.raw.player_name,
    team: rowTeam(x.raw),
    stat: x.raw.stat,
    normalizedMarket: x.market,
    line: x.raw.line,
    hitRateLast5: x.raw.hitRateLast5,
    hitRateLast10: x.raw.hitRateLast10,
    hitRateLast15: x.raw.hitRateLast15,
    differencePercent: x.raw.differencePercent,
    consensus_over_ip: x.raw.consensus_over_ip,
    consensus_under_ip: x.raw.consensus_under_ip
  }));

  candidates.push({
    player: p,
    team: t,
    game: r.game || r.matchup,
    market: m,
    rawMarket: mr,
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
    pfRows: pfMatches.length,
    pfFieldPreview
  });
}

candidates.sort((a,b) => b.score - a.score);

const report = {
  generatedAt: new Date().toISOString(),
  boardRows: rows.length,
  standardRows: standard.length,
  pfPropsIndexed: pfRows.length,
  candidateCount: candidates.length,
  byReject,
  byPfMatch,
  topCandidates: candidates.slice(0, 120),
  availablePickFinderFields: Object.entries(fieldCounts).sort((a,b)=>b[1]-a[1]).slice(0, 160)
};

write(OUT, report);

const lines = [];
lines.push("STANDARD LEANS + PICKFINDER AUDIT");
lines.push("=================================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`boardRows=${report.boardRows}`);
lines.push(`standardRows=${report.standardRows}`);
lines.push(`pfPropsIndexed=${report.pfPropsIndexed}`);
lines.push(`candidateCount=${report.candidateCount}`);
lines.push(`pfExactMatchRows=${byPfMatch.exact}`);
lines.push(`pfNoMatchRows=${byPfMatch.none}`);
lines.push("");
lines.push("REJECTS");
lines.push("-------");
for (const [k,v] of Object.entries(byReject).sort((a,b)=>b[1]-a[1])) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("TOP STANDARD LEAN CANDIDATES");
lines.push("----------------------------");
for (const c of candidates.slice(0, 50)) {
  lines.push(`${c.player} | ${c.team} | ${c.game || "?"} | ${c.market} ${c.side || "?"} ${c.line} | score=${c.score} | prob=${c.probability ?? "?"} | ev=${c.ev ?? "?"} | lineup=${c.lineupStatus}/${c.lineupSource} | pfRows=${c.pfRows}`);
  lines.push(`  reasons=${c.reasons.join("; ")}`);
  if (c.pfFieldPreview?.length) {
    const pf = c.pfFieldPreview[0];
    lines.push(`  PF=${pf.stat} line=${pf.line} L5=${pf.hitRateLast5} L10=${pf.hitRateLast10} L15=${pf.hitRateLast15} diff=${pf.differencePercent} consensusO=${pf.consensus_over_ip} consensusU=${pf.consensus_under_ip}`);
  }
}
lines.push("");
lines.push("AVAILABLE PICKFINDER FIELDS");
lines.push("---------------------------");
for (const [k,v] of report.availablePickFinderFields) lines.push(`${k}: ${v}`);

text(TXT, lines.join("\n") + "\n");

console.log({
  boardRows: report.boardRows,
  standardRows: report.standardRows,
  pfPropsIndexed: report.pfPropsIndexed,
  candidateCount: report.candidateCount,
  byPfMatch,
  top: candidates.slice(0, 10).map(c => `${c.player} ${c.market} ${c.side} ${c.line} pfRows=${c.pfRows} score=${c.score}`),
  out: OUT,
  txt: TXT
});
