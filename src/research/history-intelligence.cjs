const fs = require("fs");

const HISTORY = "data/results/graded-leg-history.json";
const CLV = `outputs/clv-report-${new Date().toISOString().slice(0,10)}.json`;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const rows = read(HISTORY, []);
const clvRows = read(CLV, []);

function roi(rows) {
  if (!rows.length) return 0;
  return rows.reduce((a,x)=>a+Number(x.unitResult||0),0) / rows.length;
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function bucketProb(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  const low = Math.floor(p * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function bucketBooks(b) {
  b = Number(b);
  if (!Number.isFinite(b)) return "unknown";
  if (b >= 4) return "4+";
  return String(b);
}

function bucketClv(c) {
  c = Number(c);
  if (c <= -20) return "<= -20";
  if (c <= -10) return "-20 to -10";
  if (c < 0) return "-10 to 0";
  if (c < 10) return "0 to 10";
  return "10+";
}

function summarize(name, grouped) {
  console.log(`\n${name}`);
  console.table(grouped);
}

function group(rows, keyFn, mapper) {
  const m = new Map();

  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }

  return [...m.entries()].map(([bucket, xs]) => mapper(bucket, xs))
    .sort((a,b)=>b.count-a.count);
}

console.log("HISTORICAL BETTING INTELLIGENCE");
console.log("================================");
console.log("graded legs:", rows.length);

summarize(
  "ROI BY MARKET",
  group(rows,
    r => r.market,
    (bucket, xs) => ({
      market: bucket,
      count: xs.length,
      roi: pct(roi(xs)),
      hitRate: pct(xs.filter(x=>x.result==="HIT").length / xs.length)
    })
  )
);

summarize(
  "ROI BY BOOK SUPPORT",
  group(rows,
    r => bucketBooks(r.books),
    (bucket, xs) => ({
      books: bucket,
      count: xs.length,
      roi: pct(roi(xs)),
      hitRate: pct(xs.filter(x=>x.result==="HIT").length / xs.length)
    })
  )
);

summarize(
  "CALIBRATION",
  group(rows,
    r => bucketProb(r.probability),
    (bucket, xs) => ({
      bucket,
      count: xs.length,
      predicted: pct(xs.reduce((a,x)=>a+Number(x.probability||0),0)/xs.length),
      actual: pct(xs.filter(x=>x.result==="HIT").length / xs.length),
      error: pct(
        Math.abs(
          (xs.reduce((a,x)=>a+Number(x.probability||0),0)/xs.length)
          -
          (xs.filter(x=>x.result==="HIT").length / xs.length)
        )
      )
    })
  )
);

if (clvRows.length) {
  summarize(
    "CLV BUCKETS",
    group(clvRows,
      r => bucketClv(r.clv),
      (bucket, xs) => ({
        bucket,
        count: xs.length,
        avgClv: (
          xs.reduce((a,x)=>a+Number(x.clv||0),0)/xs.length
        ).toFixed(2),
        beatClose: pct(
          xs.filter(x=>x.beatClose).length / xs.length
        )
      })
    )
  );
}
