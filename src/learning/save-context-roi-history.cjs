const fs = require("fs");

function read(p, d) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return d; }
}

const today = new Date().toISOString().slice(0,10);

const report = read("outputs/context-roi-report.json", []);
const historyPath = "data/learning/context-roi-history.json";

const history = read(historyPath, []);

history.push({
  date: today,
  signals: report
});

fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
console.log("Saved context ROI history:", today);
