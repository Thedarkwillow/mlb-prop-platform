const fs = require("fs");
const cp = require("child_process");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

const historyDir = "outputs/history";
const dates = fs.existsSync(historyDir)
  ? [...new Set(fs.readdirSync(historyDir)
      .map(f => (f.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1])
      .filter(Boolean))]
      .sort()
  : [];

const selected = dates.filter(d =>
  fs.existsSync(`outputs/history/${d}-priced-board.json`) &&
  fs.existsSync(`outputs/history/${d}-full-board-graded.json`)
);

if (!selected.length) {
  console.log({
    message: "No historical priced-board + full-board-graded pairs found.",
    hint: "Backtest needs outputs/history/YYYY-MM-DD-priced-board.json and outputs/history/YYYY-MM-DD-full-board-graded.json"
  });
  process.exit(0);
}

function prevDate(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0,10);
}

const results = [];

for (const d of selected) {
  const outJson = `outputs/history/${d}-goblin-highprob-tightened-backtest.json`;
  const outTxt = `outputs/history/${d}-goblin-highprob-tightened-backtest.txt`;
  const env = {
    ...process.env,
    GOBLIN_BOARD: `outputs/history/${d}-priced-board.json`,
    GOBLIN_OUT_JSON: outJson,
    GOBLIN_OUT_TXT: outTxt,
    GOBLIN_HISTORY_MAX_DATE: d
  };

  cp.execFileSync("node", ["scripts/local/goblin-highprob-slip-maker.cjs"], { stdio: "inherit", env });

  const built = readJson(outJson, null);
  const graded = readJson(`outputs/history/${d}-full-board-graded.json`, []);

  function norm(v) {
    return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
  }
  function market(v) {
    const t = String(v || "").toLowerCase();
    if (t.includes("hrr") || t.includes("hits+runs+rbis")) return "hrr";
    if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
    if (t.includes("strikeouts") || t.includes("strikeout")) return "strikeouts";
    if (t.includes("pitching outs") || t.includes("outs recorded") || t === "outs" || t.includes(" outs")) return "pitching_outs";
    if (t.includes("total bases") || t === "bases") return "bases";
    if (t.includes("hits allowed")) return "hits_allowed";
    if (t === "hits" || t.includes("batter hits")) return "hits";
    if (t.includes("earned") || t.includes("runs allowed") || t === "runs") return "earned_runs_allowed";
    if (t.includes("walks allowed")) return "walks_allowed";
    if (t.includes("walks")) return "walks";
    return t.replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
  }
  function side(v) {
    const s = String(v || "").toUpperCase();
    if (s.includes("MORE") || s.includes("OVER")) return "MORE";
    if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
    return s;
  }
  function key(r) {
    return [
      norm(r.player || r.playerName),
      market(r.market || r.stat || r.projectionType),
      side(r.side || r.recommendedSide),
      String(r.line ?? "")
    ].join("|");
  }
  function res(r) {
    const raw = String(r.result || r.outcome || r.status || "").toUpperCase();
    if (["HIT","WIN","WON"].includes(raw)) return "HIT";
    if (["MISS","LOSS","LOST"].includes(raw)) return "MISS";
    if (["PUSH","TIE"].includes(raw)) return "PUSH";
    if (["REFUND","VOID","DNP"].includes(raw)) return "REFUND";
    if (r.hit === true) return "HIT";
    if (r.hit === false) return "MISS";
    return "UNKNOWN";
  }

  const idx = new Map();
  for (const r of graded) {
    const k = key(r);
    if (!idx.has(k)) idx.set(k, r);
  }

  const slips = built?.slips || [];
  let slipHit = 0, slipMiss = 0, partial = 0;
  let legHit = 0, legMiss = 0, unmatched = 0;

  for (const s of slips) {
    const legs = s.legs || [];
    const legResults = legs.map(l => {
      const m = idx.get(key(l));
      return m ? res(m) : "UNMATCHED";
    });
    legHit += legResults.filter(x => x === "HIT").length;
    legMiss += legResults.filter(x => x === "MISS").length;
    unmatched += legResults.filter(x => x === "UNMATCHED" || x === "UNKNOWN").length;

    if (legResults.some(x => x === "UNMATCHED" || x === "UNKNOWN")) partial++;
    else if (legResults.every(x => x === "HIT")) slipHit++;
    else slipMiss++;
  }

  results.push({
    date: d,
    pool: built?.summary?.pool || 0,
    slips: slips.length,
    slipHit,
    slipMiss,
    partial,
    legHit,
    legMiss,
    unmatched
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  dates: results.length,
  totals: results.reduce((a,r) => {
    for (const k of ["slips","slipHit","slipMiss","partial","legHit","legMiss","unmatched"]) a[k] = (a[k] || 0) + r[k];
    return a;
  }, {})
};

fs.writeFileSync("outputs/goblin-highprob-tightened-backtest.json", JSON.stringify({ summary, results }, null, 2) + "\n");

const lines = [];
lines.push("TIGHTENED GOBLIN HIGH-PROB BACKTEST");
lines.push("===================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");
for (const r of results) {
  lines.push(`${r.date}: slips=${r.slips} hit=${r.slipHit} miss=${r.slipMiss} partial=${r.partial} legs=${r.legHit}-${r.legMiss} unmatched=${r.unmatched}`);
}
fs.writeFileSync("outputs/goblin-highprob-tightened-backtest.txt", lines.join("\n") + "\n");

console.log(summary);
console.log("saved: outputs/goblin-highprob-tightened-backtest.json");
console.log("saved: outputs/goblin-highprob-tightened-backtest.txt");
