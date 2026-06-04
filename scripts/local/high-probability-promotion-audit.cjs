const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const OUT_JSON = `outputs/high-probability-promotion-audit-${DATE}.json`;
const OUT_TXT = `outputs/high-probability-promotion-audit-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/high-probability-promotion-audit-latest.json";
const OUT_LATEST_TXT = "outputs/high-probability-promotion-audit-latest.txt";

const BUCKETS = [
  {
    key: "GOBLIN_STRIKEOUTS_MORE",
    label: "Goblin strikeouts MORE",
    sourcePattern: /^outputs\/promotion-watch-bucket-grades-(\d{4}-\d{2}-\d{2})\.json$/,
    bucketKey: "GOBLIN_STRIKEOUTS_MORE",
    minGraded: 30,
    promoteHitRate: 0.65,
    watchHitRate: 0.60,
    requiredDays: 2
  },
  {
    key: "GOBLIN_WALKS_ALLOWED_MORE",
    label: "Goblin walks_allowed MORE",
    sourcePattern: /^outputs\/promotion-watch-bucket-grades-(\d{4}-\d{2}-\d{2})\.json$/,
    bucketKey: "GOBLIN_WALKS_ALLOWED_MORE",
    minGraded: 30,
    promoteHitRate: 0.65,
    watchHitRate: 0.60,
    requiredDays: 2
  },
  {
    key: "STANDARD_STRIKEOUTS_LESS",
    label: "Standard strikeouts LESS",
    sourcePattern: /^outputs\/promotion-watch-bucket-grades-(\d{4}-\d{2}-\d{2})\.json$/,
    bucketKey: "STANDARD_STRIKEOUTS_LESS",
    minGraded: 30,
    promoteHitRate: 0.65,
    watchHitRate: 0.60,
    requiredDays: 2
  },
  {
    key: "HRR_MORE_HIGH_PROB",
    label: "HRR MORE high probability",
    sourcePattern: /^outputs\/high-probability-hrr-synthetic-grades-(\d{4}-\d{2}-\d{2})\.json$/,
    minGraded: 30,
    promoteHitRate: 0.65,
    watchHitRate: 0.6,
    requiredDays: 2
  },
  {
    key: "SHADOW_HITS_BASES_HIGH_PROB",
    label: "Shadow hits/bases high probability",
    sourcePattern: /^outputs\/high-probability-bucket-grades-(\d{4}-\d{2}-\d{2})\.json$/,
    bucketKey: "SHADOW_HIGH_PROBABILITY",
    minGraded: 30,
    promoteHitRate: 0.65,
    watchHitRate: 0.6,
    requiredDays: 2
  },
  {
    key: "GOBLIN_FANTASY_HIGH_PROB",
    label: "Goblin fantasy high probability",
    sourcePattern: /^outputs\/high-probability-bucket-grades-(\d{4}-\d{2}-\d{2})\.json$/,
    bucketKey: "GOBLIN_FANTASY_RESEARCH",
    minGraded: 50,
    promoteHitRate: 0.62,
    watchHitRate: 0.58,
    requiredDays: 3,
    forceSuppressBelow: 0.55
  }
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function pct(n) {
  if (!Number.isFinite(n)) return "n/a";
  return `${(n * 100).toFixed(1)}%`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function listFiles() {
  const out = [];
  for (const dir of ["outputs"]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      out.push(`${dir}/${name}`);
    }
  }
  return out;
}

function extractBucketFromFile(bucket, file) {
  const data = readJson(file);
  if (!data) return null;

  const m = file.match(bucket.sourcePattern);
  const date = m ? m[1] : data.date || "unknown";

  if (bucket.key === "HRR_MORE_HIGH_PROB") {
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.results) ? data.results : [];
    const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
    const hits = graded.filter(r => String(r.result || "").toUpperCase() === "HIT").length;
    const misses = graded.filter(r => String(r.result || "").toUpperCase() === "MISS").length;
    const pushes = graded.filter(r => String(r.result || "").toUpperCase() === "PUSH").length;
    const unmatched = rows.length - graded.length;
    return {
      date,
      file,
      total: rows.length || num(data.total),
      graded: graded.length || num(data.graded),
      hits: hits || num(data.hits),
      misses: misses || num(data.misses),
      pushes: pushes || num(data.pushes),
      unmatched: unmatched || num(data.unmatched)
    };
  }

  function findBucketObject(v) {
    if (!v || typeof v !== "object") return null;

    if (Array.isArray(v)) {
      for (const x of v) {
        const found = findBucketObject(x);
        if (found) return found;
      }
      return null;
    }

    const names = [
      v.key,
      v.bucket,
      v.name,
      v.label,
      v.bucketKey,
      v.category,
      v.section
    ].map(x => String(x || "").toUpperCase());

    if (names.includes(String(bucket.bucketKey || "").toUpperCase())) return v;

    if (v[bucket.bucketKey]) return v[bucket.bucketKey];

    for (const val of Object.values(v)) {
      const found = findBucketObject(val);
      if (found) return found;
    }

    return null;
  }

  const source = findBucketObject(data);
  if (!source) return null;

  const rows =
    Array.isArray(source.rows) ? source.rows :
    Array.isArray(source.results) ? source.results :
    Array.isArray(source.items) ? source.items :
    Array.isArray(source.props) ? source.props :
    [];

  if (rows.length) {
    const gradedRows = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
    return {
      date,
      file,
      total: rows.length,
      graded: gradedRows.length,
      hits: gradedRows.filter(r => String(r.result || "").toUpperCase() === "HIT").length,
      misses: gradedRows.filter(r => String(r.result || "").toUpperCase() === "MISS").length,
      pushes: gradedRows.filter(r => String(r.result || "").toUpperCase() === "PUSH").length,
      unmatched: rows.length - gradedRows.length
    };
  }

  return {
    date,
    file,
    total: num(source.total),
    graded: num(source.graded),
    hits: num(source.hits),
    misses: num(source.misses),
    pushes: num(source.pushes),
    unmatched: num(source.unmatched)
  };
}

function decision(bucket, agg, daysWithPositiveSignal) {
  const hitRate = agg.graded > 0 ? agg.hits / agg.graded : null;

  if (agg.graded <= 0) {
    return {
      action: "NO_DATA",
      reason: "no graded rows yet"
    };
  }

  if (bucket.forceSuppressBelow && hitRate < bucket.forceSuppressBelow) {
    return {
      action: "SUPPRESS",
      reason: `hit_rate_below_${Math.round(bucket.forceSuppressBelow * 100)}pct`
    };
  }

  if (agg.graded < bucket.minGraded) {
    return {
      action: "TRACK_ONLY",
      reason: `needs_${bucket.minGraded}_graded_minimum`
    };
  }

  if (hitRate >= bucket.promoteHitRate && daysWithPositiveSignal >= bucket.requiredDays) {
    return {
      action: "PROMOTION_REVIEW",
      reason: `passes_${bucket.minGraded}_graded_and_${Math.round(bucket.promoteHitRate * 100)}pct_hit_rate_over_${bucket.requiredDays}_days`
    };
  }

  if (hitRate >= bucket.watchHitRate) {
    return {
      action: "WATCH",
      reason: `positive_but_needs_more_days_or_stronger_sample`
    };
  }

  return {
    action: "TRACK_ONLY",
    reason: "does_not_clear_watch_threshold"
  };
}

function main() {
  const files = listFiles();
  const audit = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    policy: {
      officialPromotionAllowedAutomatically: false,
      note: "Promotion audit only. Buckets require manual approval before becoming official or actionable."
    },
    buckets: []
  };

  for (const bucket of BUCKETS) {
    const matchingFiles = files
      .filter(f => bucket.sourcePattern.test(f))
      .sort();

    const daily = [];
    for (const file of matchingFiles) {
      const row = extractBucketFromFile(bucket, file);
      if (row) daily.push(row);
    }

    const agg = daily.reduce((a, r) => {
      a.total += num(r.total);
      a.graded += num(r.graded);
      a.hits += num(r.hits);
      a.misses += num(r.misses);
      a.pushes += num(r.pushes);
      a.unmatched += num(r.unmatched);
      return a;
    }, { total: 0, graded: 0, hits: 0, misses: 0, pushes: 0, unmatched: 0 });

    const daysWithPositiveSignal = daily.filter(r => {
      const hr = r.graded > 0 ? r.hits / r.graded : 0;
      return r.graded > 0 && hr >= bucket.watchHitRate;
    }).length;

    const hitRate = agg.graded > 0 ? agg.hits / agg.graded : null;
    const d = decision(bucket, agg, daysWithPositiveSignal);

    audit.buckets.push({
      key: bucket.key,
      label: bucket.label,
      thresholds: {
        minGraded: bucket.minGraded,
        watchHitRate: bucket.watchHitRate,
        promoteHitRate: bucket.promoteHitRate,
        requiredDays: bucket.requiredDays
      },
      aggregate: {
        ...agg,
        hitRate
      },
      daysTracked: daily.length,
      daysWithPositiveSignal,
      action: d.action,
      reason: d.reason,
      daily
    });
  }

  const lines = [];
  lines.push("HIGH-PROBABILITY PROMOTION AUDIT");
  lines.push("================================");
  lines.push(`date=${DATE}`);
  lines.push("policy=manual approval required; no automatic official promotion");
  lines.push("");

  for (const b of audit.buckets) {
    lines.push(b.key);
    lines.push("-".repeat(b.key.length));
    lines.push(`label=${b.label}`);
    lines.push(`action=${b.action}`);
    lines.push(`reason=${b.reason}`);
    lines.push(`daysTracked=${b.daysTracked}`);
    lines.push(`daysWithPositiveSignal=${b.daysWithPositiveSignal}`);
    lines.push(`total=${b.aggregate.total} graded=${b.aggregate.graded} hits=${b.aggregate.hits} misses=${b.aggregate.misses} pushes=${b.aggregate.pushes} unmatched=${b.aggregate.unmatched} hitRate=${pct(b.aggregate.hitRate)}`);
    lines.push(`thresholds=minGraded:${b.thresholds.minGraded} watch:${pct(b.thresholds.watchHitRate)} promote:${pct(b.thresholds.promoteHitRate)} requiredDays:${b.thresholds.requiredDays}`);
    if (b.daily.length) {
      lines.push("daily:");
      for (const d of b.daily.slice(-10)) {
        const hr = d.graded > 0 ? d.hits / d.graded : null;
        lines.push(`  ${d.date}: graded=${d.graded} hits=${d.hits} misses=${d.misses} hitRate=${pct(hr)} file=${d.file}`);
      }
    }
    lines.push("");
  }

  writeJson(OUT_JSON, audit);
  writeJson(OUT_LATEST_JSON, audit);
  writeText(OUT_TXT, lines.join("\n"));
  writeText(OUT_LATEST_TXT, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_TXT}`);
}

main();
