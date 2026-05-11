const fs = require("fs");
const path = require("path");

const INPUT = process.argv[2] || "data/context/imports/umpire-scorecards.csv";
const OUTPUT = "data/context/umpires.json";

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];

    if (c === '"' && q && n === '"') {
      cur += '"';
      i++;
      continue;
    }

    if (c === '"') {
      q = !q;
      continue;
    }

    if (c === "," && !q) {
      row.push(cur);
      cur = "";
      continue;
    }

    if ((c === "\n" || c === "\r") && !q) {
      if (cur || row.length) {
        row.push(cur);
        rows.push(row);
      }
      cur = "";
      row = [];
      if (c === "\r" && n === "\n") i++;
      continue;
    }

    cur += c;
  }

  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }

  return rows;
}

function num(v) {
  const n = Number(String(v ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && row[name] !== "") return row[name];
  }
  return "";
}

function classifyKFactor(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) > 1) return n / 100;
  return n;
}

function main() {
  fs.mkdirSync(path.dirname(INPUT), { recursive: true });

  if (!fs.existsSync(INPUT)) {
    fs.writeFileSync(
      INPUT,
      [
        "game,umpire,kFactor,calledStrikeBoost,accuracy,consistency,notes",
        "New York Yankees @ Baltimore Orioles,Example Umpire,0.04,true,94.2,93.1,wide zone / K friendly"
      ].join("\n") + "\n"
    );

    fs.writeFileSync(
      OUTPUT,
      JSON.stringify({ games: {}, umpires: {}, source: INPUT }, null, 2) + "\n"
    );

    console.log(`Missing ${INPUT}; created template and empty ${OUTPUT}`);
    return;
  }

  const table = parseCsv(fs.readFileSync(INPUT, "utf8"));
  const header = table.shift().map(h => norm(h));
  const games = {};
  const umpires = {};

  for (const cells of table) {
    const row = {};
    header.forEach((h, i) => row[h] = cells[i] || "");

    const game = pick(row, ["game", "matchup"]);
    const umpire = pick(row, ["umpire", "home plate umpire", "hp umpire", "name"]);
    if (!game && !umpire) continue;

    const kFactorRaw = pick(row, ["kfactor", "k factor", "calledstrikeboost", "called strike boost", "strikezoneboost"]);
    const kFactor = classifyKFactor(num(kFactorRaw));

    const payload = {
      game,
      umpire,
      kFactor,
      kBoost: kFactor > 0.03,
      kDowngrade: kFactor < -0.03,
      accuracy: num(pick(row, ["accuracy", "acc"])),
      consistency: num(pick(row, ["consistency", "con"])),
      notes: pick(row, ["notes", "note"]),
      source: INPUT
    };

    if (game) games[norm(game)] = payload;
    if (umpire) umpires[norm(umpire)] = payload;
  }

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify({ games, umpires, source: INPUT, updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );

  console.log("UMPIRE STRIKE-ZONE IMPORT");
  console.log("=========================");
  console.log(`Input: ${INPUT}`);
  console.log(`Games mapped: ${Object.keys(games).length}`);
  console.log(`Umpires mapped: ${Object.keys(umpires).length}`);
  console.log(`Wrote ${OUTPUT}`);
}

main();
