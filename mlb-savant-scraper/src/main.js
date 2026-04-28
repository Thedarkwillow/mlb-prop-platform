import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};
const year = input.year || 2026;

const startPages = [
    {
        url: `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}`,
        metricSet: 'expected_statistics_batters',
    },
    {
        url: `https://baseballsavant.mlb.com/statcast_leaderboard?year=${year}`,
        metricSet: 'statcast_leaderboard_batters',
    },
    {
        url: `https://baseballsavant.mlb.com/leaderboard/sprint_speed?year=${year}`,
        metricSet: 'sprint_speed',
    },
    {
        url: `https://baseballsavant.mlb.com/leaderboard/basestealing-run-value?season_start=${year}&season_end=${year}&type=Batting+Team`,
        metricSet: 'basestealing_run_value',
    },
    {
        url: `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=batter&year=${year}`,
        metricSet: 'pitch_arsenal_stats_batters',
    },
    {
        url: `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&year=${year}`,
        metricSet: 'pitch_arsenal_stats_pitchers',
    },
];

function cleanText(s) {
    return String(s ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function num(v) {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).replace(/,/g, '').replace(/%/g, '').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function parseMaybeNumber(v) {
    const n = num(v);
    return n === null ? cleanText(v) : n;
}

async function waitForLeaderboard(page) {
    const selectors = [
        'table',
        'table tbody tr',
        '.table',
        '[role="table"]',
    ];

    for (const selector of selectors) {
        try {
            await page.waitForSelector(selector, { timeout: 12000 });
            return selector;
        } catch {}
    }

    return null;
}

async function extractRows(page, metricSet, pageUrl) {
    return await page.evaluate(({ metricSet, pageUrl }) => {
        function cleanText(s) {
            return String(s ?? '')
                .replace(/\u00a0/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function firstWorkingTable() {
            const tables = Array.from(document.querySelectorAll('table'));
            for (const table of tables) {
                const rows = table.querySelectorAll('tbody tr');
                if (rows.length >= 3) return table;
            }
            return tables[0] || null;
        }

        const table = firstWorkingTable();
        if (!table) return [];

        const headerCells = Array.from(table.querySelectorAll('thead th'))
            .map((th) => cleanText(th.textContent))
            .filter(Boolean);

        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));

        const records = bodyRows.map((tr, idx) => {
            const cells = Array.from(tr.querySelectorAll('td, th')).map((td) => cleanText(td.textContent));
            if (!cells.length) return null;

            const obj = {
                source: 'BaseballSavant',
                metricSet,
                page: pageUrl,
                scrapedAt: new Date().toISOString(),
                rowIndex: idx + 1,
                rawCells: cells,
            };

            if (headerCells.length && headerCells.length === cells.length) {
                headerCells.forEach((h, i) => {
                    obj[`col_${i + 1}_${h.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()}`] = cells[i];
                });
            } else {
                cells.forEach((c, i) => {
                    obj[`col_${i + 1}`] = c;
                });
            }

            return obj;
        }).filter(Boolean);

        return records;
    }, { metricSet, pageUrl });
}

function normalizeLeaderboardRows(rows) {
    return rows.map((row) => {
        const out = { ...row };

        for (const [key, value] of Object.entries(out)) {
            if (typeof value === 'string') {
                const trimmed = cleanText(value);
                const parsed = parseMaybeNumber(trimmed);
                out[key] = parsed;
            }
        }

        return out;
    });
}

const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    async requestHandler({ page, request }) {
        log.info(`Opening ${request.userData.metricSet}`);

        await page.goto(request.url, { waitUntil: 'networkidle' });

        // Give Savant extra time because its tables can hydrate client-side.
        await page.waitForTimeout(4000);
        await waitForLeaderboard(page);
        await page.waitForTimeout(2000);

        const rows = await extractRows(page, request.userData.metricSet, request.url);
        const normalized = normalizeLeaderboardRows(rows);

        if (!normalized.length) {
            log.warning(`No rows found for ${request.userData.metricSet}`);
            await Dataset.pushData([{
                source: 'BaseballSavant',
                metricSet: request.userData.metricSet,
                page: request.url,
                scrapedAt: new Date().toISOString(),
                recordType: 'empty_result',
            }]);
            return;
        }

        await Dataset.pushData(normalized);
        log.info(`Saved ${normalized.length} rows for ${request.userData.metricSet}`);
    },
});

await crawler.run(
    startPages.map((p) => ({
        url: p.url,
        userData: { metricSet: p.metricSet },
    }))
);

await Actor.exit();