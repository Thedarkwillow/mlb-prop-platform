const { chromium } = require("playwright");
const fs = require("fs");

const URL = "https://www.pickfinder.app/props";
const OUT = "outputs/pickfinder-network.json";
const OUT_SUMMARY = "outputs/pickfinder-network-summary.txt";

function isNoiseUrl(url = "") {
  return /google|facebook|doubleclick|analytics|pagead|googletagmanager|gstatic|clerk|sign-in|conversion|collect|\/tr\?/i.test(url);
}

function isInterestingUrl(url = "") {
  return /pickfinder\.app|api|supabase|vercel|graphql|trpc|props|projections|lineup|lineups|players|sportsbook|prizepicks|underdog|mlb/i.test(url);
}

function redactText(input) {
  return String(input || "")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "JWT_REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer REDACTED")
    .replace(/negreteelijah1@gmail\.com/gi, "EMAIL_REDACTED")
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
      if (/token|jwt|session|authorization|cookie|clerk|password|email/i.test(k)) {
        out[k] = "REDACTED";
      } else {
        out[k] = redactJson(val);
      }
    }
    return out;
  }
  return v;
}

async function main() {
  fs.mkdirSync("outputs", { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
  });

  const page = await context.newPage();
  const hits = [];

  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (isNoiseUrl(url)) return;
      if (!isInterestingUrl(url)) return;

      const req = response.request();
      const status = response.status();
      const method = req.method();
      const headers = response.headers();
      const contentType = headers["content-type"] || "";

      let body = null;
      if (/json|text|javascript/i.test(contentType)) {
        const txt = await response.text().catch(() => "");
        if (txt && txt.length < 150000) {
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
      if (body) {
        const printable = typeof body === "string" ? body : JSON.stringify(body, null, 2);
        console.log(printable.slice(0, 2000));
      }
    } catch (e) {
      // ignore noisy response parsing failures
    }
  });

  console.log("Opening PickFinder. Log in if needed, then click MLB props / lineup-related filters.");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

  console.log("Browser is open. Use noVNC to log in/load MLB. Close browser when finished.");
  await page.waitForEvent("close", { timeout: 20 * 60 * 1000 }).catch(() => {});

  fs.writeFileSync(OUT, JSON.stringify(hits, null, 2) + "\n");

  const summary = [];
  summary.push(`Saved ${hits.length} safe app/network hits to ${OUT}`);
  summary.push("");
  for (const h of hits) {
    summary.push(`${h.status} ${h.method} ${h.contentType || ""}`);
    summary.push(h.url);
    summary.push("");
  }
  fs.writeFileSync(OUT_SUMMARY, summary.join("\n") + "\n");

  console.log(`Saved ${hits.length} safe app/network hits to ${OUT}`);
  console.log(`Saved summary to ${OUT_SUMMARY}`);

  await browser.close().catch(() => {});
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
