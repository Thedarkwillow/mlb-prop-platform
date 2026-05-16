const fs = require("fs");
const { pool } = require("./client.cjs");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function read(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const pricedBoard = read(`outputs/priced-board-${DATE}.json`, read("outputs/priced-board.json", []));
  const fullBoardGrades = read(`outputs/full-board-graded-${DATE}.json`, []);
  const phase7Simulation = read(`outputs/phase7-simulation-${DATE}.json`, null);
  const phase7Portfolio = read(`outputs/phase7-portfolio-${DATE}.json`, null);
  const phase7Bankroll = read(`outputs/phase7-bankroll-${DATE}.json`, null);
  const phase7Risk = read(`outputs/phase7-risk-of-ruin-${DATE}.json`, null);

  await pool.query("DELETE FROM priced_boards WHERE slate_date=$1", [DATE]);
  await pool.query(
    `INSERT INTO priced_boards (slate_date, source_file, row_count, data)
     VALUES ($1,$2,$3,$4)`,
    [DATE, `outputs/priced-board-${DATE}.json`, Array.isArray(pricedBoard) ? pricedBoard.length : 0, JSON.stringify(pricedBoard)]
  );

  await pool.query("DELETE FROM full_board_grades WHERE slate_date=$1", [DATE]);
  for (const r of fullBoardGrades) {
    await pool.query(
      `INSERT INTO full_board_grades
       (slate_date, player, team, game, market, side, line, odds_tier, probability, edge, decision, actual, result, game_pk, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        DATE,
        r.player || null,
        r.team || null,
        r.game || null,
        r.market || null,
        r.side || null,
        r.line ?? null,
        r.oddsTier || r.tier || null,
        r.prob ?? r.probability ?? null,
        r.edge ?? null,
        r.decision || null,
        r.actual ?? null,
        r.result || null,
        r.gamePk ?? null,
        JSON.stringify(r)
      ]
    );
  }

  await pool.query("DELETE FROM phase7_reports WHERE slate_date=$1", [DATE]);
  const reports = [
    ["simulation", phase7Simulation],
    ["portfolio", phase7Portfolio],
    ["bankroll", phase7Bankroll],
    ["risk_of_ruin", phase7Risk]
  ].filter(([, data]) => data);

  for (const [type, data] of reports) {
    await pool.query(
      `INSERT INTO phase7_reports (slate_date, report_type, data)
       VALUES ($1,$2,$3)`,
      [DATE, type, JSON.stringify(data)]
    );
  }

  console.log("POSTGRES EXPORT COMPLETE");
  console.log("date:", DATE);
  console.log("priced board rows:", Array.isArray(pricedBoard) ? pricedBoard.length : 0);
  console.log("full board grades:", fullBoardGrades.length);
  console.log("phase7 reports:", reports.length);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
