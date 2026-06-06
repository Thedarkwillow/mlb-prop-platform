const fs = require("fs");

function getDate() {
  const argvDate = process.argv.slice(2).find(x =>
    /^\d{4}-\d{2}-\d{2}$/.test(x) || /^--date=\d{4}-\d{2}-\d{2}$/.test(x)
  );
  if (argvDate) return argvDate.replace(/^--date=/, "");
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();

const PLAY = "outputs/goblin-context-playability.json";
const HRR_GRADE = `outputs/history/${DATE}-goblin-hrr-controlled-slips-graded.json`;
const HIGH_GRADE = `outputs/history/${DATE}-goblin-highprob-construction-graded.json`;
const OUT = `outputs/history/${DATE}-goblin-context-playability-graded.json`;
const TXT = `outputs/history/${DATE}-goblin-context-playability-graded.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function normResult(v) {
  const s = String(v || "").toLowerCase();
  if (s === "hit" || s === "win" || s === "won") return "hit";
  if (s === "miss" || s === "loss" || s === "lost") return "miss";
  if (s.includes("partial")) return "partialUnmatched";
  if (s.includes("all_unmatched") || s.includes("allunmatched")) return "allUnmatched";
  if (s.includes("unmatched")) return "partialUnmatched";
  return "ungraded";
}

function emptyBucket() {
  return { slips: 0, hit: 0, miss: 0, partialUnmatched: 0, allUnmatched: 0, ungraded: 0 };
}

function incBucket(bucket, result) {
  bucket.slips++;
  bucket[result] = (bucket[result] || 0) + 1;
}

function idAliases(id) {
  const raw = String(id || "").trim();
  const out = new Set();
  if (!raw) return [];

  out.add(raw);

  const noEntry = raw.replace(/_(power|flex)$/i, "");
  out.add(noEntry);

  out.add(raw.replace("goblin_highprob_", "goblin_highprob_clean_"));
  out.add(raw.replace("goblin_highprob_clean_", "goblin_highprob_"));
  out.add(noEntry.replace("goblin_highprob_", "goblin_highprob_clean_"));
  out.add(noEntry.replace("goblin_highprob_clean_", "goblin_highprob_"));

  return [...out].filter(Boolean);
}

function putGrade(map, row, sourceLane) {
  if (!row || typeof row !== "object") return;

  const id = row.id || row.slipId || row.name || row.title;
  if (!id) return;

  const result = normResult(row.result || row.status || row.outcome);
  if (result === "ungraded") return;

  const grade = {
    id: String(id),
    lane: sourceLane,
    result,
    size: Number(row.size || row.legs?.length || 0) || null,
    entryType: String(row.entryType || row.type || "").toUpperCase() || null,
    hits: Number(row.hits || row.hit || 0) || 0,
    misses: Number(row.misses || row.miss || 0) || 0,
    unmatched: Number(row.unmatched || row.unmatchedCount || 0) || 0
  };

  for (const alias of idAliases(id)) {
    map.set(alias, grade);
  }
}

function flattenGrades(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flattenGrades(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if ((v.id || v.slipId || v.name || v.title) && (v.result || v.status || v.outcome)) {
    out.push(v);
  }

  for (const val of Object.values(v)) flattenGrades(val, out);
  return out;
}

function buildGradeMap(obj, sourceLane) {
  const map = new Map();

  // Known structures first.
  for (const row of arr(obj.slips)) putGrade(map, row, sourceLane);
  for (const row of arr(obj.slipsGraded)) putGrade(map, row, sourceLane);
  for (const row of arr(obj.results)) putGrade(map, row, sourceLane);
  for (const row of arr(obj.summary?.slips)) putGrade(map, row, sourceLane);

  // Fallback recursive scan.
  for (const row of flattenGrades(obj)) putGrade(map, row, sourceLane);

  return map;
}

function findGrade(map, id) {
  for (const alias of idAliases(id)) {
    if (map.has(alias)) return map.get(alias);
  }
  return null;
}

function playRows(play) {
  if (Array.isArray(play.slips)) return play.slips;
  if (Array.isArray(play.rows)) return play.rows;
  if (Array.isArray(play)) return play;
  return [];
}

const play = readJson(PLAY, {});
const hrrGrade = readJson(HRR_GRADE, {});
const highGrade = readJson(HIGH_GRADE, {});

const hrrMap = buildGradeMap(hrrGrade, "goblin_hrr_controlled");
const highMap = buildGradeMap(highGrade, "goblin_highprob_clean");

const rows = playRows(play);
const outRows = [];

const byPlayability = {};
const byLane = {};
const byShape = {};
let matchedGrades = 0;

for (const row of rows) {
  const lane = String(row.lane || "");
  const id = row.id || row.slipId || row.name || "";
  const playability = String(row.playability || row.label || "UNKNOWN");
  const size = Number(row.size || 0) || null;
  const entryType = String(row.entryType || row.type || "").toUpperCase() || "UNKNOWN";

  const grade =
    lane === "goblin_highprob_clean"
      ? findGrade(highMap, id)
      : lane === "goblin_hrr_controlled"
        ? findGrade(hrrMap, id)
        : (findGrade(hrrMap, id) || findGrade(highMap, id));

  const result = grade?.result || "ungraded";
  if (grade) matchedGrades++;

  if (!byPlayability[playability]) byPlayability[playability] = emptyBucket();
  if (!byLane[lane]) byLane[lane] = emptyBucket();

  const shapeKey = `${lane}|${size || "?"}|${entryType}`;
  if (!byShape[shapeKey]) byShape[shapeKey] = emptyBucket();

  incBucket(byPlayability[playability], result);
  incBucket(byLane[lane], result);
  incBucket(byShape[shapeKey], result);

  outRows.push({
    id,
    lane,
    playability,
    size,
    entryType,
    score: row.score,
    minProb: row.minProb,
    avgProb: row.avgProb,
    result,
    hits: grade?.hits || 0,
    misses: grade?.misses || 0,
    unmatched: grade?.unmatched || 0
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  playabilityRows: rows.length,
  matchedGrades,
  gradeMapSizes: {
    goblin_hrr_controlled: hrrMap.size,
    goblin_highprob_clean: highMap.size
  },
  byPlayability,
  byLane,
  byShape
};

const payload = { summary, rows: outRows };
fs.mkdirSync(`outputs/history`, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

const lines = [];
lines.push("GOBLIN CONTEXT PLAYABILITY GRADED");
lines.push("=================================");
lines.push(JSON.stringify(summary, null, 2));
for (const r of outRows) {
  lines.push(
    `${r.playability} | ${r.lane} | ${r.id} | ${r.size}-man ${r.entryType} | ${r.result} | hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched}`
  );
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
