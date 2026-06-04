const fs = require("fs");
const { chromium } = require("playwright");

const OUT = "outputs/pickfinder-lineup-source-inspect.json";
const URL = "https://www.pickfinder.app/props";

function interesting(url) {
  return /lineup|lineups|starter|starters|probable|player|players|prop|props|projection|projections|slate|game|games|mlb|availability|status|confirmed/i.test(url);
}

(async () => {
  fs.mkdirSync("outputs", { recursive: true });
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
  });
  const page = await context.newPage();

  const network = [];
  const bodies = [];

  page.on("response", async (res) => {
    const url = res.url();
    if (!interesting(url)) return;
    const rec = {
      url,
      status: res.status(),
      contentType: res.headers()["content-type"] || "",
      method: res.request().method()
    };
    network.push(rec);
    try {
      const ct = rec.contentType;
      if (/json|text/i.test(ct)) {
        const txt = await res.text();
        const lower = txt.toLowerCase();
        if (/lineup|confirmed|projected|starter|probable|batting|order|availability/.test(lower)) {
          bodies.push({
            url,
            status: rec.status,
            contentType: ct,
            sample: txt.slice(0, 5000)
          });
        }
      }
    } catch {}
  });

  console.log("Opening PickFinder. Log in if needed, then wait for props to load.");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(45000);

  const storage = await page.evaluate(() => {
    const local = {};
    const session = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      local[k] = localStorage.getItem(k)?.slice(0, 2000);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      session[k] = sessionStorage.getItem(k)?.slice(0, 2000);
    }
    const text = document.body.innerText.slice(0, 10000);
    return { local, session, pageTextSample: text };
  });

  const out = {
    capturedAt: new Date().toISOString(),
    url: page.url(),
    network,
    lineupRelatedBodies: bodies,
    storage
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`saved: ${OUT}`);
  console.log("Top matching URLs:");
  for (const r of network.slice(0, 80)) console.log(`${r.status} ${r.url}`);
  await browser.close();
})();
