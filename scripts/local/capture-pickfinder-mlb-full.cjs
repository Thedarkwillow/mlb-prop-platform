const { chromium } = require("playwright");
const fs = require("fs");

const PROFILE = "data/pickfinder/vps-browser-profile";

const OUT = "outputs/pickfinder-mlb-full-capture.json";
const OUT_PROPS = "outputs/pickfinder-mlb-props.json";
const OUT_LINEUPS = "outputs/pickfinder-mlb-lineups.json";
const OUT_ODDS = "outputs/pickfinder-mlb-odds.json";
const OUT_PLAYERS = "outputs/pickfinder-mlb-player-details.json";
const OUT_POPULAR = "outputs/pickfinder-mlb-popular.json";
const OUT_DISCREPANCIES = "outputs/pickfinder-mlb-discrepancies.json";

const PROP_PER_PAGE = Number(process.env.PF_PROP_PER_PAGE || 200);
const MAX_PROP_PAGES = Number(process.env.PF_MAX_PROP_PAGES || 999);
const PLAYER_MODE = String(process.env.PF_PLAYER_MODE || "team").toLowerCase(); // team | all | none
const MAX_PLAYERS = Number(process.env.PF_MAX_PLAYERS || 60);
const DELAY_MS = Number(process.env.PF_DELAY_MS || 500);
let apiV3Headers = null;
const playerDetailCache = new Map();
const MODIFIER = String(process.env.PF_MODIFIER || "none").toLowerCase(); // none | any
const MAX_POPULAR_PAGES = Number(process.env.PF_MAX_POPULAR_PAGES || 10);
const MAX_DISCREPANCY_PAGES = Number(process.env.PF_MAX_DISCREPANCY_PAGES || 5);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function iso(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function writeJson(file, data) {
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

async function fetchJsonInPage(page, url) {
  const isApiV3 = /api-v3\.pickfinder\.app/i.test(url);

  if (isApiV3 && apiV3Headers) {
    try {
      const res = await page.request.get(url, {
        headers: apiV3Headers,
        timeout: 60000
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); }
      catch { body = text.slice(0, 3000); }
      return { url, status: res.status(), ok: res.ok(), body, method: "request_with_live_headers" };
    } catch (e) {
      return { url, status: 0, ok: false, body: null, method: "request_with_live_headers_failed", error: String(e?.message || e) };
    }
  }

  try {
    return await page.evaluate(async (url) => {
      const res = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json,text/plain,*/*" }
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); }
      catch { body = text.slice(0, 3000); }
      return { url, status: res.status, ok: res.ok, body, method: "browser" };
    }, url);
  } catch (browserErr) {
    return {
      url,
      status: 0,
      ok: false,
      body: null,
      method: "failed",
      error: String(browserErr?.message || browserErr)
    };
  }
}

function fixtureFromProp(item) {
  const fixtureId = item.fixture_id;
  const startDate = iso(item.start_date);
  const team = item.team || {};
  const opp = item.opponent || {};

  if (!fixtureId || !startDate || !team.sr_id_long || !opp.sr_id_long) return null;

  const home = team.home ? team : opp.home ? opp : null;
  const away = team.home ? opp : opp.home ? team : null;
  if (!home?.sr_id_long || !away?.sr_id_long) return null;

  return {
    fixtureId,
    fixtureSrId: item.fixture_sr_id || null,
    gameString: item.game_string || null,
    startDate,
    homeTeam: home.name || null,
    awayTeam: away.name || null,
    homeAbbr: home.abbreviation || null,
    awayAbbr: away.abbreviation || null,
    homeTeamId: home.sr_id_long,
    awayTeamId: away.sr_id_long
  };
}

function playerFromProp(item) {
  if (!item.player_id || !item.player_name) return null;
  return {
    playerId: item.player_id,
    playerName: item.player_name,
    playerKey: safeName(item.player_name),
    team: item.team?.abbreviation || null,
    teamName: item.team?.name || null,
    fixtureId: item.fixture_id || null,
    sampleProp: item.groupKey || item.market_id || null
  };
}

async function main() {
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync("outputs", { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });

  const page = context.pages()[0] || await context.newPage();


  function usableApiHeaders(headers = {}) {
    const out = {};
    for (const [k, v] of Object.entries(headers || {})) {
      const key = String(k).toLowerCase();
      if (
        key === "accept" ||
        key === "authorization" ||
        key === "cookie" ||
        key === "origin" ||
        key === "referer" ||
        key === "user-agent" ||
        key.startsWith("x-")
      ) {
        out[k] = v;
      }
    }
    out.accept = out.accept || "application/json,text/plain,*/*";
    out.referer = out.referer || "https://www.pickfinder.app/props";
    out.origin = out.origin || "https://www.pickfinder.app";
    return out;
  }

  page.on("request", req => {
    const u = req.url();
    if (/api-v3\.pickfinder\.app\/props\?sport=mlb/i.test(u)) {
      apiV3Headers = usableApiHeaders(req.headers());
      console.log("Captured live api-v3 headers from PickFinder app request.");
    }
  });

  page.on("response", async res => {
    try {
      const u = res.url();
      const m = u.match(/api-v3\.pickfinder\.app\/players\/([^/]+)\/(props|gamelog)/i);
      if (!m) return;

      const playerId = m[1];
      const kind = m[2].toLowerCase();
      const text = await res.text().catch(() => "");
      let body = null;
      try { body = JSON.parse(text); }
      catch { body = text.slice(0, 3000); }

      const existing = playerDetailCache.get(playerId) || {};
      existing[kind] = {
        url: u,
        status: res.status(),
        ok: res.ok(),
        body,
        method: "frontend_network_capture"
      };
      playerDetailCache.set(playerId, existing);
    } catch {}
  });

  console.log("Opening PickFinder logged-in profile...");
  await page.goto("https://www.pickfinder.app/props", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);

  if (!apiV3Headers) {
    console.log("No live api-v3 headers captured yet; trying to click MLB and wait.");
    await page.getByText(/^MLB$/i).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(6000);
  }

  console.log({ hasApiV3Headers: Boolean(apiV3Headers) });

  const capture = {
    generatedAt: new Date().toISOString(),
    settings: { PROP_PER_PAGE, MAX_PROP_PAGES, PLAYER_MODE, MAX_PLAYERS, DELAY_MS, MODIFIER, MAX_POPULAR_PAGES, MAX_DISCREPANCY_PAGES },
    filters: null,
    propsPages: [],
    props: [],
    fixtures: [],
    lineups: [],
    odds: [],
    playerDetails: [],
    popularPages: [],
    popular: [],
    discrepancyPages: [],
    discrepancies: []
  };

  console.log("Fetching MLB filters...");
  capture.filters = await fetchJsonInPage(page, "https://api-v3.pickfinder.app/props/filters?sport=mlb");
  await sleep(DELAY_MS);

  console.log("Fetching MLB props pages...");
  let pageNo = 1;
  let totalPages = 1;

  while (pageNo <= totalPages && pageNo <= MAX_PROP_PAGES) {
    const url = `https://api-v3.pickfinder.app/props?sport=mlb&modifier=${MODIFIER}&sort=-hitRateLast10&page=${pageNo}&perPage=${PROP_PER_PAGE}`;
    const res = await fetchJsonInPage(page, url);
    capture.propsPages.push(res);

    const body = res.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    capture.props.push(...items);

    totalPages = Number(body.totalPages || totalPages || 1);
    console.log({ kind: "props", page: pageNo, totalPages, items: items.length, totalItems: body.totalItems });

    if (!res.ok || items.length === 0) break;
    pageNo++;
    await sleep(DELAY_MS);
  }

  console.log("Fetching MLB popular pages using same props API sort signal...");
  for (let p = 1; p <= MAX_POPULAR_PAGES; p++) {
    const url = `https://api-v3.pickfinder.app/props?sport=mlb&modifier=${MODIFIER}&sort=-favorite_count_over&page=${p}&perPage=${PROP_PER_PAGE}`;
    const res = await fetchJsonInPage(page, url);
    capture.popularPages.push(res);
    const items = Array.isArray(res.body?.items) ? res.body.items : [];
    capture.popular.push(...items);
    console.log({ kind: "popular", page: p, items: items.length });
    if (!res.ok || items.length === 0) break;
    await sleep(DELAY_MS);
  }

  console.log("Fetching MLB discrepancy-style pages using line difference sort candidates...");
  const discrepancySorts = ["-differencePercent", "-differenceLast10", "-consensus_over_ip", "-consensus_under_ip"];
  for (const sort of discrepancySorts) {
    for (let p = 1; p <= MAX_DISCREPANCY_PAGES; p++) {
      const url = `https://api-v3.pickfinder.app/props?sport=mlb&modifier=${MODIFIER}&sort=${encodeURIComponent(sort)}&page=${p}&perPage=${PROP_PER_PAGE}`;
      const res = await fetchJsonInPage(page, url);
      capture.discrepancyPages.push(res);
      const items = Array.isArray(res.body?.items) ? res.body.items : [];
      capture.discrepancies.push(...items);
      console.log({ kind: "discrepancy", sort, page: p, items: items.length });
      if (!res.ok || items.length === 0) break;
      await sleep(DELAY_MS);
    }
  }

  const fixtureMap = new Map();
  const playerMap = new Map();
  const teamPlayerMap = new Map();

  for (const item of capture.props) {
    const fx = fixtureFromProp(item);
    if (fx && !fixtureMap.has(fx.fixtureId)) fixtureMap.set(fx.fixtureId, fx);

    const p = playerFromProp(item);
    if (p && !playerMap.has(p.playerId)) playerMap.set(p.playerId, p);
    if (p?.team && !teamPlayerMap.has(p.team)) teamPlayerMap.set(p.team, p);
  }

  capture.fixtures = [...fixtureMap.values()];

  console.log({
    totalProps: capture.props.length,
    fixtures: capture.fixtures.length,
    uniquePlayers: playerMap.size,
    teams: teamPlayerMap.size,
    popular: capture.popular.length,
    discrepancies: capture.discrepancies.length
  });

  console.log("Fetching every fixture lineup + odds...");
  for (const fx of capture.fixtures) {
    const lineupUrl =
      `https://www.pickfinder.app/api/mlb/matches/${encodeURIComponent(fx.fixtureId)}/lineups` +
      `?match_start_date=${encodeURIComponent(fx.startDate)}` +
      `&home_team=${encodeURIComponent(fx.homeTeamId)}` +
      `&away_team=${encodeURIComponent(fx.awayTeamId)}` +
      `&season=2026`;

    const oddsUrl = `https://www.pickfinder.app/api/mlb/matches/${encodeURIComponent(fx.fixtureId)}/odds`;

    const lineup = await fetchJsonInPage(page, lineupUrl);
    capture.lineups.push({ fixture: fx, ...lineup });
    console.log("LINEUP", fx.fixtureId, lineup.status, fx.awayAbbr, "@", fx.homeAbbr);
    await sleep(DELAY_MS);

    const odds = await fetchJsonInPage(page, oddsUrl);
    capture.odds.push({ fixture: fx, ...odds });
    console.log("ODDS", fx.fixtureId, odds.status);
    await sleep(DELAY_MS);
  }

  let playersToFetch = [];
  if (PLAYER_MODE === "team") playersToFetch = [...teamPlayerMap.values()];
  else if (PLAYER_MODE === "all") playersToFetch = [...playerMap.values()];
  playersToFetch = playersToFetch.slice(0, MAX_PLAYERS);

  console.log({ PLAYER_MODE, playersToFetch: playersToFetch.length });

  for (const p of playersToFetch) {
    const playerUrl = `https://www.pickfinder.app/players/mlb/${encodeURIComponent(p.playerId)}`;
    console.log("OPEN PLAYER PAGE", p.team, p.playerName, playerUrl);

    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    for (const label of ["Game Log", "Gamelog", "Props", "Stats", "Odds", "Matchup"]) {
      await page.getByText(label, { exact: false }).click({ timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(1200);
    }

    await page.waitForTimeout(2500);

    const cached = playerDetailCache.get(p.playerId) || {};
    const props = cached.props || { status: 0, ok: false, method: "frontend_network_capture_missing" };
    const gamelog = cached.gamelog || { status: 0, ok: false, method: "frontend_network_capture_missing" };

    capture.playerDetails.push({ player: p, playerUrl, props, gamelog });
    console.log("PLAYER", p.team, p.playerName, props.status, gamelog.status, props.method, gamelog.method);
  }

  writeJson(OUT, capture);
  writeJson(OUT_PROPS, { generatedAt: capture.generatedAt, props: capture.props });
  writeJson(OUT_LINEUPS, { generatedAt: capture.generatedAt, fixtures: capture.fixtures, lineups: capture.lineups });
  writeJson(OUT_ODDS, { generatedAt: capture.generatedAt, fixtures: capture.fixtures, odds: capture.odds });
  writeJson(OUT_PLAYERS, { generatedAt: capture.generatedAt, playerDetails: capture.playerDetails });
  writeJson(OUT_POPULAR, { generatedAt: capture.generatedAt, popular: capture.popular });
  writeJson(OUT_DISCREPANCIES, { generatedAt: capture.generatedAt, discrepancies: capture.discrepancies });

  const batterCount = capture.lineups.reduce((n, x) => {
    const body = x.body;
    if (!body || typeof body !== "object") return n;
    return n + Object.values(body).reduce((m, team) => {
      const b = team?.batters;
      if (Array.isArray(b)) return m + b.length;
      if (b && typeof b === "object") return m + Object.keys(b).length;
      return m;
    }, 0);
  }, 0);

  console.log("DONE", {
    props: capture.props.length,
    fixtures: capture.fixtures.length,
    lineups: capture.lineups.length,
    odds: capture.odds.length,
    playerDetails: capture.playerDetails.length,
    popular: capture.popular.length,
    discrepancies: capture.discrepancies.length,
    batters: batterCount,
    out: OUT
  });

  await context.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
