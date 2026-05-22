const fs = require("fs");
const crypto = require("crypto");
const { Client } = require("pg");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function hashRow(prefix, row) {
  return crypto
    .createHash("sha256")
    .update(prefix + JSON.stringify(row))
    .digest("hex");
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function dateArg() {
  const i = process.argv.findIndex(x => x === "--date");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

function flattenRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.props)) return data.props;
  if (Array.isArray(data.legs)) return data.legs;
  if (Array.isArray(data.slips)) return data.slips.flatMap(s => s.legs || []);
  return [];
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL missing. Run: source .env");

  const slateDate = dateArg();
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const boardPath = "outputs/priced-board.json";
  const boardRows = flattenRows(readJson(boardPath, []))
    .filter(r => r && (r.recordType === "merged_prop" || r.player));

  let propInserted = 0;
  for (const r of boardRows) {
    const rowHash = hashRow(`prop:${slateDate}:`, {
      player: r.player,
      team: r.team || r.resolvedTeam,
      market: r.market,
      side: r.recommendedSide || r.side,
      line: r.line,
      game: r.resolvedGame || r.game,
      oddsTier: r.oddsTier
    });

    await client.query(`
      INSERT INTO prop_snapshots (
        slate_date, source_file, row_hash, player, team, opponent, game,
        market, side, line, odds_tier, projection, probability,
        expected_value, confidence_bucket, raw
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (row_hash) DO NOTHING
    `, [
      slateDate,
      boardPath,
      rowHash,
      r.player || null,
      r.team || r.resolvedTeam || null,
      r.opponent || null,
      r.resolvedGame || r.game || null,
      r.market || null,
      r.recommendedSide || r.side || null,
      n(r.line),
      r.oddsTier || null,
      n(r.projection ?? r.contextAdjustedProjection ?? r.rawProjection),
      n(r.recommendedProb ?? r.probability ?? r.prob),
      n(r.expectedValue ?? r.ev),
      r.confidenceBucket || r.confidence || null,
      r
    ]);
    propInserted++;
  }

  const gradedFiles = [
    "outputs/all-markets-graded.json",
    `outputs/playable-final-slips-graded-${slateDate}.json`,
    "outputs/playable-final-slips-graded.json",
    "data/results/prop-warehouse.json"
  ];

  let gradedInserted = 0;

  for (const file of gradedFiles) {
    const rows = flattenRows(readJson(file, []))
      .filter(r => r && (r.player || r.playerName));

    for (const r of rows) {
      const rowHash = hashRow(`grade:${slateDate}:${file}:`, {
        player: r.player || r.playerName,
        team: r.team || r.resolvedTeam,
        market: r.market,
        side: r.recommendedSide || r.side,
        line: r.line,
        game: r.resolvedGame || r.game,
        result: r.result || r.grade || r.outcome
      });

      const result = String(r.result || r.grade || r.outcome || "").toUpperCase();
      const hit = ["WIN", "HIT", "W"].includes(result)
        ? true
        : ["LOSS", "MISS", "L"].includes(result)
          ? false
          : null;

      await client.query(`
        INSERT INTO graded_props (
          slate_date, source_file, row_hash, player, team, opponent, game,
          market, side, line, result, hit, probability, expected_value,
          confidence_bucket, pitch_type_tier, lineup_tier, own_bullpen_tier,
          opponent_bullpen_tier, catcher_framing_tier, savant_form_tier, raw
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT (row_hash) DO NOTHING
      `, [
        slateDate,
        file,
        rowHash,
        r.player || r.playerName || null,
        r.team || r.resolvedTeam || null,
        r.opponent || null,
        r.resolvedGame || r.game || null,
        r.market || null,
        r.recommendedSide || r.side || null,
        n(r.line),
        result || null,
        hit,
        n(r.recommendedProb ?? r.probability ?? r.prob),
        n(r.expectedValue ?? r.ev),
        r.confidenceBucket || r.confidence || null,
        r.pitchTypeMatchupTier || null,
        r.lineupTier || null,
        r.ownBullpenFatigueTier || null,
        r.opponentBullpenFatigueTier || null,
        r.opponentCatcherFramingTier || null,
        r.savantRollingForm?.formTier || null,
        r
      ]);
      gradedInserted++;
    }
  }

  const roiPath = "outputs/context-roi-report.json";
  const roiRows = readJson(roiPath, []);
  let roiInserted = 0;

  for (const r of roiRows) {
    await client.query(`
      INSERT INTO context_roi_history (
        report_date, signal, total, wins, losses, pushes,
        hit_rate, roi, avg_prob, avg_ev, raw
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      slateDate,
      r.signal || null,
      n(r.total),
      n(r.wins),
      n(r.losses),
      n(r.pushes),
      n(r.hitRate),
      n(r.roi),
      n(r.avgProb),
      n(r.avgEV),
      r
    ]);
    roiInserted++;
  }

  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM prop_snapshots) AS prop_snapshots,
      (SELECT COUNT(*) FROM graded_props) AS graded_props,
      (SELECT COUNT(*) FROM context_roi_history) AS context_roi_history
  `);

  await client.end();

  console.log("PHASE 7 JSON MIRROR IMPORT");
  console.log("==========================");
  console.log({ slateDate, propRowsSeen: boardRows.length, propInserted, gradedInserted, roiInserted });
  console.table(counts.rows);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
