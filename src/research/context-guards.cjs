const fs = require("fs");

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

function write(file, data) {
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const official = read("outputs/official-slip.json", []);
const finalSlips = read("outputs/final-slips.json", []);
const lineupData = read("data/context/lineups.json", {});
const injuryNews = read("data/context/injury-news.json", {});
const bullpen = read("data/context/bullpen-fatigue.json", {});
const travel = read("data/context/travel-rest.json", {});
const umpire = read("data/context/umpires.json", {});
const catcher = read("data/context/catcher-framing.json", {});

const slips = official.length ? official : finalSlips;
const legs = slips.flatMap(s => s.legs || []);

function teamFromLeg(l) {
  return String(l.team || "").toUpperCase();
}

function playerKey(l) {
  return norm(l.player);
}

function gameKey(l) {
  return norm(l.game || "");
}

function contextForLeg(l) {
  const flags = [];
  let adjustment = 0;
  const team = teamFromLeg(l);
  const player = playerKey(l);
  const game = gameKey(l);
  const market = norm(l.market);

  const lineup = lineupData.players?.[player] || lineupData.teams?.[team];
  if (lineup) {
    if (lineup.status && !["confirmed", "starting", "active"].includes(norm(lineup.status))) {
      flags.push("LINEUP_NOT_CONFIRMED");
      adjustment -= 0.04;
    }
    if (lineup.battingOrder && Number(lineup.battingOrder) >= 7 && ["bases", "hits", "hrr", "runs", "rbis"].includes(market)) {
      flags.push("LOW_LINEUP_SLOT");
      adjustment -= 0.015;
    }
  } else {
    flags.push("LINEUP_UNKNOWN");
    adjustment -= 0.01;
  }

  const news = injuryNews.players?.[player];
  if (news) {
    if (news.status && !["active", "probable", "available"].includes(norm(news.status))) {
      flags.push("PLAYER_INJURY_RISK");
      adjustment -= 0.06;
    }
    if (news.note) flags.push("NEWS_NOTE");
  }

  const pen = bullpen.teams?.[team];
  if (pen) {
    if (pen.fatigue === "HIGH" || Number(pen.backToBackRelievers || 0) >= 3 || Number(pen.pitchCountLast2Days || 0) >= 90) {
      flags.push("BULLPEN_FATIGUE_HIGH");
      if (["pitching_outs"].includes(market)) adjustment -= 0.025;
      if (["earned_runs_allowed", "hits_allowed"].includes(market) && norm(l.side) === "less") adjustment -= 0.025;
      if (["bases", "hits", "hrr", "runs", "rbis"].includes(market) && norm(l.side) === "more") adjustment += 0.01;
    }
  }

  const rest = travel.teams?.[team];
  if (rest) {
    if (rest.travelSpot === "BAD" || rest.restDisadvantage === true) {
      flags.push("TRAVEL_REST_DOWNGRADE");
      adjustment -= 0.015;
    }
  }

  const ump = umpire.games?.[game];
  if (ump) {
    if (market === "strikeouts") {
      if (ump.kBoost === true || Number(ump.kFactor || 0) > 0.03) {
        flags.push("UMPIRE_K_BOOST");
        adjustment += norm(l.side) === "more" ? 0.02 : -0.02;
      }
      if (ump.kDowngrade === true || Number(ump.kFactor || 0) < -0.03) {
        flags.push("UMPIRE_K_DOWNGRADE");
        adjustment += norm(l.side) === "less" ? 0.02 : -0.02;
      }
    }
  }

  const frame = catcher.teams?.[team] || catcher.players?.[norm(l.catcher)];
  if (frame && market === "strikeouts") {
    if (frame.framing === "PLUS" || Number(frame.framingRuns || 0) > 3) {
      flags.push("CATCHER_FRAMING_BOOST");
      adjustment += norm(l.side) === "more" ? 0.01 : -0.01;
    }
    if (frame.framing === "MINUS" || Number(frame.framingRuns || 0) < -3) {
      flags.push("CATCHER_FRAMING_DOWNGRADE");
      adjustment += norm(l.side) === "less" ? 0.01 : -0.01;
    }
  }

  return {
    player: l.player,
    team: l.team,
    game: l.game,
    market: l.market,
    side: l.side,
    line: l.line,
    baseEdge: Number(l.edge ?? l.sportsbookEdge ?? 0),
    contextAdjustment: Number(adjustment.toFixed(4)),
    contextAdjustedEdge: Number((Number(l.edge ?? l.sportsbookEdge ?? 0) + adjustment).toFixed(4)),
    flags
  };
}

const rows = legs.map(contextForLeg);
write(`outputs/context/context-guards-${DATE}.json`, rows);

console.log("CONTEXT GUARDS");
console.log("==============");
console.log(`Date: ${DATE}`);
console.log(`Legs checked: ${rows.length}`);
console.table(rows.map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  baseEdge: r.baseEdge,
  adj: r.contextAdjustment,
  contextEdge: r.contextAdjustedEdge,
  flags: r.flags.join(", ") || "clean"
})));

const severe = rows.filter(r =>
  r.flags.includes("PLAYER_INJURY_RISK") ||
  r.flags.includes("LINEUP_NOT_CONFIRMED")
);

if (severe.length) {
  console.log("SEVERE CONTEXT WARNINGS");
  console.table(severe.map(r => ({
    player: r.player,
    pick: `${r.market} ${r.side} ${r.line}`,
    flags: r.flags.join(", ")
  })));
}

console.log(`Wrote outputs/context/context-guards-${DATE}.json`);
