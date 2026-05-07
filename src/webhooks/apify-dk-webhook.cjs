const fs = require("fs");
const express = require("express");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3001;
const TOKEN = process.env.APIFY_TOKEN;
const SECRET = process.env.APIFY_WEBHOOK_SECRET || "change-this-secret";

if (!TOKEN) throw new Error("Missing APIFY_TOKEN");

app.use(express.json({ limit: "5mb" }));

function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: "/root/mlb-prop-platform" }, (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (err) reject(err);
      else resolve();
    });
  });
}

app.post("/apify/draftkings/:secret", async (req, res) => {
  if (req.params.secret !== SECRET) return res.status(403).send("bad secret");

  try {
    const runId =
      req.body?.eventData?.actorRunId ||
      req.body?.actorRunId ||
      req.body?.resource?.id;

    if (!runId) throw new Error("No actorRunId in webhook payload");

    const url = `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?clean=true&format=json&token=${TOKEN}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`dataset download failed ${r.status}: ${await r.text()}`);

    const raw = await r.json();
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/vegas-raw.json", JSON.stringify(raw, null, 2));

    await run("/usr/bin/node", ["src/jobs/final-daily-pipeline.cjs"]);

    res.json({ ok: true, runId, rows: raw.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Apify webhook listening on ${PORT}`);
});
