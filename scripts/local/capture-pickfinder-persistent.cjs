const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PROFILE = "data/pickfinder/vps-browser-profile";
const OUT = "outputs/pickfinder-network.json";
const OUT_SUMMARY = "outputs/pickfinder-network-summary.txt";
const URL = "https://www.pickfinder.app/props";

function isNoiseUrl(url = "") {
  return /google|facebook|doubleclick|analytics|pagead|googletagmanager|gstatic|clerk|sign-in|conversion|collect|\/tr\?/i.test(url);
}

function isInterestingUrl(url = "") {
  return /pickfinder\.app|api-v3\.pickfinder\.app|api|supabase|vercel|graphql|trpc|props|projections|lineup|lineups|players|sportsbook|prizepicks|underdog|mlb/i.test(url);
}

function redactText(input) {
  return String(input || "")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "JWT_REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer REDACTED")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "EMAIL_REDACTED")
    .replace(/("token"\s*:\s*")[^"]+(")/gi, "$1REDACTED$2")
    .replace(/("jwt"\s*:\s*")[^"]+(")/gi, "$1REDACTED$2")
    .replace(/("session[^"]*"\s*:\s*")[^"]+(")/gi, "$1REDACTED$2")
    .replace(/([?&](token|jwt|session|authorization|__clerk[^=&]*)=)[^&]+/gi, "$1REDACTED");
}

function redactJson(v) {
  if (v == null) return v;
  if (typeof v === "string") return redactText(v);
  if (Array.isArray(v)) return v.map(redactJson);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (/token|jwt|session|authorization|cookie|clerk|password|email/i.test(k)) out[k] = "REDACTED";
      else out[k] = redactJson(val);
    }
    return out;
  }
  return v;
}

async function main() {
  fs.mkdirSync("outputs", { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  const page = context.pages()[0] || await context.newPage();
  const hits = [];

  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (isNoiseUrl(url)) return;
      if (!isInterestingUrl(url)) return;

      const req = response.request();
      const status = response.status();
      const method = req.method();
      const contentType = response.headers()["content-type"] || "";

      let body = null;
      if (/json|text|javascript/i.test(contentType)) {
        const txt = await response.text().catch(() => "");
        if (txt && txt.length < 200000) {
          try {
            body = redactJson(JSON.parse(txt));
          } catch {
            body = redactText(txt).slice(0, 12000);
          }
        }
      }

      const row = {
        ts: new Date().toISOString(),
        status,
        method,
        contentType,
        url: redactText(url),
        body
      };

      hits.push(row);

      console.log("---");
      console.log(`${status} ${method} ${contentType}`);
      console.log(row.url);
    } catch {}
  });

  console.log("Opening PickFinder with persistent profile.");
  console.log("If already logged in, click MLB/game/lineups. If not, log in once.");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

  let saved = false;

  function saveCapture() {
    if (saved) return;
    saved = true;

    fs.writeFileSync(OUT, JSON.stringify(hits, null, 2) + "\n");

    const summary = [];
    summary.push(`Saved ${hits.length} safe PickFinder hits to ${OUT}`);
    summary.push("");
    for (const h of hits) {
      summary.push(`${h.status} ${h.method} ${h.contentType || ""}`);
      summary.push(h.url);
      summary.push("");
    }
    fs.writeFileSync(OUT_SUMMARY, summary.join("\n") + "\n");

    console.log(`Saved ${hits.length} safe PickFinder hits to ${OUT}`);
    console.log(`Saved summary to ${OUT_SUMMARY}`);
  }

  process.on("SIGINT", async () => {
    console.log("\n=== CTRL-C RECEIVED: SAVING PICKFINDER CAPTURE ===");
    saveCapture();
    await context.close().catch(() => {});
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n=== SIGTERM RECEIVED: SAVING PICKFINDER CAPTURE ===");
    saveCapture();
    await context.close().catch(() => {});
    process.exit(0);
  });

  console.log("Capture is running. Use PickFinder in noVNC. Press Ctrl+C here when finished.");
  await new Promise(() => {});
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
