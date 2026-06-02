const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const OUT_DIR = "outputs/full-prop-confirmation";
const OUT_JSON = `${OUT_DIR}/full-prop-confirmation-report-${DATE}.json`;
const OUT_LATEST = `${OUT_DIR}/full-prop-confirmation-report-latest.json`;
const OUT_TXT = `${OUT_DIR}/full-prop-confirmation-report-${DATE}.txt`;
const OUT_TXT_LATEST = `${OUT_DIR}/full-prop-confirmation-report-latest.txt`;

const FILES = {
  board: "outputs/priced-board.json",
  production: "outputs/production-candidates.json",
  finalSlips: "outputs/final-slips.json",
  playable: "outputs/playable-final-slips.json",
  leanFinal: "outputs/lean-final-slips.json",
  watchlist: "outputs/watchlist-final-slips.json",
  blocked: "outputs/blocked-final-candidates.json",
  leanWatch: "outputs/lean-watchlist-candidates.json",
  allPropReport: "outputs/all-prop-side-line-report-latest.json",
  lineups: "data/context/lineups.json",
  pickfinder: "data/pickfinder/manual-pickfinder-signals.json"
};

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (
    v.player || v.playerName || v.name ||
    v.market || v.stat || v.statType ||
    v.side || v.pick || v.recommendedSide ||
    v.line !== undefined || v.ppLine !== undefined ||
    v.class || v.classification || v.candidateClass ||
    v.result || v.reason || v.reasons || v.legs
  ) out.push(v);
  for (const val of Object.values(v)) flat(val, out);
  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerName(r) {
  return String(r.player || r.playerName || r.name || r.fullName || "").trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hits+runs+rbis": "hrr",
    "hits runs rbis": "hrr",
    "total bases": "bases",
    "home runs": "home_runs",
    "home run": "home_runs",
    "hr": "home_runs",
    "hitter fantasy score": "hitter_fantasy_score",
    "pitcher fantasy score": "pitcher_fantasy_score",
    "pitcher strikeouts": "strikeouts",
    "hits allowed": "hits_allowed",
    "walks allowed": "walks_allowed",
    "earned runs allowed": "earned_runs_allowed",
    "pitching outs": "pitching_outs",
    "pitches thrown": "pitches_thrown",
    "runs allowed": "runs_allowed",
    "rbi": "rbis",
    "stolen bases": "stolen_bases"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  if (s === "MORE" || s === "LESS") return s;
  return "";
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  if (Math.abs(n) > 1) return `${n.toFixed(1)}%`;
  return `${(n * 100).toFixed(1)}%`;
}

function dateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function rowDate(r) {
  return (
    r.date ||
    r.slateDate ||
    r.gameDate ||
    dateOnly(r.startTime || r.game_start || r.start_time || r.board_time || r.updated_at || r.timestamp)
  );
}

function lineBucket(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n <= 0.5) return "0.5";
  if (n <= 1.5) return "1.5";
  if (n <= 2.5) return "2.5";
  if (n <= 3.5) return "3.5";
  if (n <= 4.5) return "4.5";
  if (n <= 5.5) return "5.5";
  if (n <= 8.5) return "6.0-8.5";
  if (n <= 12.5) return "9.0-12.5";
  return "13.0+";
}

function candidateKey(r) {
  const p = norm(playerName(r));
  const m = marketNorm(r.market || r.stat || r.statType);
  const s = sideNorm(r.side || r.pick || r.recommendedSide);
  const l = num(r.line ?? r.ppLine ?? r.prizepicksLine, "");
  return `${p}|${m}|${s}|${l}`;
}

function playerKey(r) {
  return norm(playerName(r));
}

function reasonList(r) {
  const raw = r.reasons ?? r.reason ?? r.flags ?? r.disabledReason ?? [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(",").map(x => x.trim()).filter(Boolean);
  return [];
}

function rowFrom(r, source, fallbackClass = "NO_CLASS") {
  const p = playerName(r);
  const market = marketNorm(r.market || r.stat || r.statType);
  const side = sideNorm(r.side || r.pick || r.recommendedSide);
  const line = num(r.line ?? r.ppLine ?? r.prizepicksLine, null);
  if (!p || !market || !side || line === null) return null;

  return {
    date: rowDate(r) || DATE,
    source,
    player: p,
    team: r.team || r.playerTeam || r.abbrev || null,
    opponent: r.opponent || r.opp || null,
    game: r.game || r.matchup || r.eventName || null,
    market,
    side,
    line,
    lineBucket: lineBucket(line),
    tier: r.tier || r.oddsTier || "standard",
    candidateClass: String(r.class || r.classification || r.candidateClass || fallbackClass).toUpperCase(),
    prob: num(r.prob ?? r.probability ?? r.calibratedProb ?? r.dist ?? r.winProb, null),
    edge: num(r.edge ?? r.adjEdge ?? r.expectedValue ?? r.ev, null),
    books: r.books ?? r.bookCount ?? null,
    grade: r.grade || r.vegasGrade || r.supportGrade || null,
    support: r.support || r.bookSupport || null,
    sideBias: r.sideBias || r.marketSideBias || null,
    score: num(r.score ?? r.officialScore ?? null, null),
    reasons: reasonList(r)
  };
}

function collectRowsFromFile(file, className, source) {
  return flat(read(file, null), [])
    .map(r => rowFrom(r, source, className))
    .filter(Boolean);
}

function collectBoardRows() {
  const board = read(FILES.board, []);
  return (Array.isArray(board) ? board : [])
    .filter(r => r && r.recordType === "merged_prop")
    .filter(r => {
      const d = rowDate(r);
      return !d || d === DATE;
    })
    .map(r => rowFrom(r, "priced-board", "BOARD"))
    .filter(Boolean);
}

function collectProductionRows() {
  return flat(read(FILES.production, null), [])
    .map(r => rowFrom(r, "production-candidates", "PRODUCTION"))
    .filter(Boolean);
}

function collectAllRows() {
  return [
    ...collectBoardRows(),
    ...collectProductionRows(),
    ...collectRowsFromFile(FILES.finalSlips, "FINAL", "final-slips"),
    ...collectRowsFromFile(FILES.playable, "OFFICIAL_SLIP", "playable-final-slips"),
    ...collectRowsFromFile(FILES.leanFinal, "LEAN_FINAL", "lean-final-slips"),
    ...collectRowsFromFile(FILES.watchlist, "WATCHLIST", "watchlist-final-slips"),
    ...collectRowsFromFile(FILES.blocked, "BLOCKED", "blocked-final-candidates"),
    ...collectRowsFromFile(FILES.leanWatch, "LEAN_WATCH", "lean-watchlist-candidates")
  ];
}

function classRank(cls) {
  const c = String(cls || "").toUpperCase();
  const rank = {
    CORE: 1,
    OFFICIAL_CORE: 1,
    OFFICIAL_SLIP: 2,
    LEAN: 3,
    LEAN_FINAL: 4,
    WATCHLIST: 5,
    HIGH_PROBABILITY_WATCH: 6,
    LEAN_WATCH: 7,
    RESEARCH: 8,
    BLOCKED: 9,
    SHADOW_BLOCKED: 10,
    FINAL: 11,
    PRODUCTION: 12,
    BOARD: 20
  };
  return rank[c] || 99;
}

function mergeRows(rows) {
  const map = new Map();

  for (const r of rows) {
    const k = candidateKey(r);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, r);
      continue;
    }

    const best = classRank(r.candidateClass) < classRank(prev.candidateClass) ? r : prev;
    const other = best === r ? prev : r;

    map.set(k, {
      ...other,
      ...best,
      source: [...new Set(`${prev.source}+${r.source}`.split("+").filter(Boolean))].join("+"),
      reasons: [...new Set([...(prev.reasons || []), ...(r.reasons || [])])],
      prob: best.prob ?? other.prob,
      edge: best.edge ?? other.edge,
      books: best.books ?? other.books,
      grade: best.grade ?? other.grade,
      support: best.support ?? other.support,
      sideBias: best.sideBias ?? other.sideBias,
      score: best.score ?? other.score
    });
  }

  return [...map.values()];
}

function getLineupRows() {
  return flat(read(FILES.lineups, null), []).filter(r =>
    playerName(r) || r.fullName || r.batter || r.player_name
  );
}

function lineupIndex() {
  const idx = new Map();

  for (const r of getLineupRows()) {
    const p = playerName(r) || r.fullName || r.batter || r.player_name || "";
    if (!p) continue;

    const item = {
      player: p,
      team: r.team || r.teamAbbr || r.playerTeam || r.abbrev || null,
      opponent: r.opponent || r.opp || null,
      lineupStatus:
        r.lineupStatus ||
        r.status ||
        (r.confirmed === true || r.confirmedLineup === true ? "CONFIRMED" : null) ||
        (r.projected === true || r.projectedLineup === true ? "PROJECTED" : null) ||
        null,
      confirmed:
        r.confirmed === true ||
        r.confirmedLineup === true ||
        r.isConfirmed === true ||
        String(r.lineupStatus || r.status || "").toLowerCase().includes("confirmed"),
      starting:
        r.starting === true ||
        r.isStarter === true ||
        r.inLineup === true ||
        r.lineup === true ||
        r.battingOrder !== undefined ||
        r.order !== undefined ||
        r.lineupSpot !== undefined,
      battingOrder:
        r.battingOrder ??
        r.order ??
        r.lineupSpot ??
        r.batting_order ??
        r.spot ??
        null,
      position: r.position || r.pos || null
    };

    const key = norm(p);
    const prev = idx.get(key);
    if (!prev) idx.set(key, item);
    else {
      const prevScore = (prev.confirmed ? 2 : 0) + (prev.starting ? 1 : 0);
      const itemScore = (item.confirmed ? 2 : 0) + (item.starting ? 1 : 0);
      if (itemScore > prevScore) idx.set(key, item);
    }
  }

  return idx;
}

function pickfinderRows() {
  const data = read(FILES.pickfinder, { rows: [] });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.signals)) return data.signals;
  return [];
}

function pickfinderIndex() {
  const exact = new Map();
  const player = new Map();

  for (const r of pickfinderRows()) {
    if (!playerName(r)) continue;

    const exactKey = candidateKey({
      player: playerName(r),
      market: r.market || r.stat,
      side: r.side,
      line: r.line
    });

    const pk = playerKey(r);
    exact.set(exactKey, r);
    if (!player.has(pk)) player.set(pk, []);
    player.get(pk).push(r);
  }

  return { exact, player };
}

function pfVal(r, keys) {
  if (!r) return null;
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  }
  return null;
}

function allPropBucketIndex() {
  const rpt = read(FILES.allPropReport, {});
  const idx = new Map();
  for (const r of [...(rpt.marketSideLine || []), ...(rpt.marketSide || [])]) {
    if (r && r.bucket) idx.set(String(r.bucket), r);
  }
  return idx;
}

function isPitcherMarket(market, row = {}) {
  const m = String(market || row.market || "");
  const pos = String(row.position || row.playerPosition || row.sourceType || row.playerType || row.recordSourceType || "").toUpperCase();
  const player = String(row.player || "").toLowerCase();

  if (pos === "P" || pos.includes("PITCHER")) return true;

  if ([
    "strikeouts",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score",
    "runs_allowed"
  ].includes(m)) return true;

  // PrizePicks sometimes displays pitcher hits allowed as "hits" after normalization.
  // Treat known pitcher candidates in pitcher-only markets as pitcher props for lineup display.
  if (
    m === "hits" &&
    [
      "connor prielipp",
      "davis martin",
      "logan gilbert",
      "kevin gausman",
      "matthew liberatore",
      "andrew painter"
    ].includes(player)
  ) return true;

  return false;
}

function marketPerfFor(row, perfIdx) {
  const lineKey = `${row.market}|${row.side}|${row.lineBucket}`;
  const sideKey = `${row.market}|${row.side}`;
  return perfIdx.get(lineKey) || perfIdx.get(sideKey) || null;
}

function confirmationGrade(row, lineup, pf, perf) {
  let score = 0;
  const notes = [];
  const cls = String(row.candidateClass || "").toUpperCase();

  if (["CORE", "OFFICIAL_CORE", "OFFICIAL_SLIP"].includes(cls)) score += 4;
  else if (["LEAN", "LEAN_FINAL"].includes(cls)) score += 3;
  else if (["WATCHLIST", "HIGH_PROBABILITY_WATCH", "LEAN_WATCH"].includes(cls)) score += 2;
  else if (["RESEARCH"].includes(cls)) score += 1;
  else if (["BLOCKED", "SHADOW_BLOCKED"].includes(cls)) score -= 3;

  if (row.grade === "GREEN") score += 2;
  if (row.grade === "FADE") score -= 2;
  if (String(row.support || "").toUpperCase() === "OK") score += 1;
  if (String(row.support || "").toUpperCase().includes("LOW")) score -= 1;

  if (String(row.sideBias || "").includes("STRONG_POSITIVE")) score += 2;
  else if (String(row.sideBias || "").includes("POSITIVE")) score += 1;
  else if (String(row.sideBias || "").includes("NEGATIVE")) score -= 2;

  if (perf) {
    if (perf.action === "PROMOTION_CANDIDATE") score += 3;
    else if (perf.action === "WATCHLIST") score += 2;
    else if (perf.action === "SMALL_SAMPLE_WATCH") score += 1;
    else if (perf.action === "SUPPRESS_OR_BLOCK") score -= 3;
  } else {
    notes.push("missing_market_line_performance");
  }

  if (!isPitcherMarket(row.market, row)) {
    if (lineup) {
      if (lineup.confirmed) score += 1;
      if (lineup.starting) score += 1;
      const bo = Number(lineup.battingOrder);
      if (Number.isFinite(bo) && bo >= 1 && bo <= 6) score += 1;
      if (Number.isFinite(bo) && bo >= 8) score -= 1;
    } else {
      notes.push("missing_lineup");
      score -= 1;
    }
  }

  if (pf) {
    score += 1;
    const vsPitcher = String(pfVal(pf, ["vsPitcher", "vs_pitcher", "bvp"]) || "").toLowerCase();
    if (vsPitcher.includes("good")) score += 1;
    if (vsPitcher.includes("bad")) score -= 1;
  } else {
    notes.push("pickfinder_not_checked");
  }

  let confirmation = "C";
  if (score >= 8) confirmation = "A";
  else if (score >= 5) confirmation = "B";
  else if (score >= 2) confirmation = "C";
  else confirmation = "D";

  let decision = "TRACK_ONLY";
  if (["CORE", "OFFICIAL_CORE", "OFFICIAL_SLIP"].includes(cls)) {
    decision = confirmation === "D" ? "OFFICIAL_REVIEW" : "KEEP_OFFICIAL";
  } else if (["LEAN", "LEAN_FINAL"].includes(cls)) {
    decision = ["A", "B"].includes(confirmation) ? "KEEP_SMALL_LEAN" : "WATCH_ONLY";
  } else if (["WATCHLIST", "HIGH_PROBABILITY_WATCH", "LEAN_WATCH"].includes(cls)) {
    decision = confirmation === "A" ? "WATCHLIST_PLUS" : "WATCH_ONLY";
  } else if (["BLOCKED", "SHADOW_BLOCKED"].includes(cls)) {
    decision = "NO_PLAY_BLOCKED";
  } else if (confirmation === "A") {
    decision = "RESEARCH_PLUS";
  }

  return { confirmationScore: score, confirmationGrade: confirmation, finalDecision: decision, confirmationNotes: notes };
}

const rawRows = collectAllRows();
const props = mergeRows(rawRows);
const lineups = lineupIndex();
const pfIndex = pickfinderIndex();
const perfIdx = allPropBucketIndex();

const rows = props.map(row => {
  const lineup = lineups.get(playerKey(row)) || null;
  const pf = pfIndex.exact.get(candidateKey(row)) || (pfIndex.player.get(playerKey(row)) || [])[0] || null;
  const perf = marketPerfFor(row, perfIdx);
  const cg = confirmationGrade(row, lineup, pf, perf);

  return {
    ...row,
    marketPerformanceAction: perf?.action || null,
    marketPerformanceGraded: perf?.graded ?? null,
    marketPerformanceHitRate: perf?.hitRatePct || null,
    marketPerformanceRoiProxy: perf?.roiProxyPct || null,
    lineupStatus: lineup?.lineupStatus || null,
    lineupConfirmed: lineup?.confirmed || false,
    starting: lineup?.starting || false,
    battingOrder: lineup?.battingOrder ?? null,
    lineupPosition: lineup?.position || null,
    pickfinderFound: !!pf,
    pickfinderLine: pfVal(pf, ["pickfinderLine", "pfLine"]),
    pickfinderStat: pfVal(pf, ["pickfinderStat", "pfStat"]),
    pickfinderMatchType: pfVal(pf, ["pickfinderMatchType", "matchType"]),
    pickfinderL5: pfVal(pf, ["l5", "L5", "last5"]),
    pickfinderL10: pfVal(pf, ["l10", "L10", "last10"]),
    pickfinderL15: pfVal(pf, ["l15", "L15", "last15"]),
    pickfinderSeason: pfVal(pf, ["season", "seasonHitRate", "season_rate"]),
    pickfinderVsPitcher: pfVal(pf, ["vsPitcher", "vs_pitcher", "bvp"]),
    pickfinderNotes: pfVal(pf, ["notes", "note"]),
    ...cg
  };
}).sort((a, b) =>
  classRank(a.candidateClass) - classRank(b.candidateClass) ||
  b.confirmationScore - a.confirmationScore ||
  String(a.player).localeCompare(String(b.player))
);

const byDecision = rows.reduce((acc, r) => {
  acc[r.finalDecision] = (acc[r.finalDecision] || 0) + 1;
  return acc;
}, {});

const byClass = rows.reduce((acc, r) => {
  const k = r.candidateClass || "UNKNOWN";
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  files: FILES,
  counts: {
    rawRows: rawRows.length,
    uniqueProps: rows.length,
    lineupMatches: rows.filter(r => r.lineupStatus || r.starting || r.battingOrder).length,
    pickfinderMatches: rows.filter(r => r.pickfinderFound).length,
    marketPerformanceMatches: rows.filter(r => r.marketPerformanceAction).length
  },
  byClass,
  byDecision,
  rows
};

function showLine(r) {
  const lu = isPitcherMarket(r.market, r)
    ? "Lineup=n/a_pitcher_prop"
    : `Lineup=${r.lineupStatus || "n/a"} start=${r.starting} bat=${r.battingOrder ?? "n/a"}`;

  const pf = r.pickfinderFound
    ? `PF L5=${r.pickfinderL5 ?? "n/a"} L10=${r.pickfinderL10 ?? "n/a"} L15=${r.pickfinderL15 ?? "n/a"} Season=${r.pickfinderSeason ?? "n/a"} vsP=${r.pickfinderVsPitcher ?? "n/a"} pfLine=${r.pickfinderLine ?? "n/a"} match=${r.pickfinderMatchType || "exact"}`
    : "PF=not_checked";

  const perf = r.marketPerformanceAction
    ? `Perf=${r.marketPerformanceAction} ${r.marketPerformanceHitRate || "n/a"} ROI=${r.marketPerformanceRoiProxy || "n/a"} n=${r.marketPerformanceGraded ?? "n/a"}`
    : "Perf=n/a";

  return [
    `${r.finalDecision} | ${r.confirmationGrade}(${r.confirmationScore})`,
    r.candidateClass,
    `${r.player} | ${r.team || "?"}`,
    `${r.market} ${r.side} ${r.line}`,
    `prob=${pct(r.prob)} edge=${pct(r.edge)} books=${r.books ?? "n/a"} grade=${r.grade || "n/a"}`,
    perf,
    lu,
    pf,
    r.confirmationNotes?.length ? `notes=${r.confirmationNotes.join(",")}` : null
  ].filter(Boolean).join(" | ");
}

const sections = [
  ["KEEP OFFICIAL", rows.filter(r => r.finalDecision === "KEEP_OFFICIAL")],
  ["OFFICIAL REVIEW", rows.filter(r => r.finalDecision === "OFFICIAL_REVIEW")],
  ["KEEP SMALL LEAN", rows.filter(r => r.finalDecision === "KEEP_SMALL_LEAN")],
  ["WATCHLIST PLUS", rows.filter(r => r.finalDecision === "WATCHLIST_PLUS")],
  ["WATCH ONLY", rows.filter(r => r.finalDecision === "WATCH_ONLY")],
  ["RESEARCH PLUS", rows.filter(r => r.finalDecision === "RESEARCH_PLUS")],
  ["NO PLAY BLOCKED", rows.filter(r => r.finalDecision === "NO_PLAY_BLOCKED").slice(0, 80)]
];

const txt = [
  "FULL PROP CONFIRMATION REPORT",
  "=============================",
  `date: ${DATE}`,
  `rawRows: ${report.counts.rawRows}`,
  `uniqueProps: ${report.counts.uniqueProps}`,
  `lineupMatches: ${report.counts.lineupMatches}`,
  `pickfinderMatches: ${report.counts.pickfinderMatches}`,
  `marketPerformanceMatches: ${report.counts.marketPerformanceMatches}`,
  `byClass: ${JSON.stringify(byClass)}`,
  `byDecision: ${JSON.stringify(byDecision)}`,
  "",
  ...sections.flatMap(([title, list]) => [
    title,
    "-".repeat(title.length),
    ...(list.length ? list.map(showLine) : ["none"]),
    ""
  ])
].join("\n");

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST, report);
writeText(OUT_TXT, txt);
writeText(OUT_TXT_LATEST, txt);

console.log(txt);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_LATEST}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved: ${OUT_TXT_LATEST}`);
