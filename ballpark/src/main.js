import { Actor, log } from 'apify';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';

await Actor.init();

log.info('BALLPARK EXPORT SCRAPER VERSION: v2-login-export-center');

const input = (await Actor.getInput()) || {};

const date = input.date || new Date().toISOString().slice(0, 10);
const email = process.env.BALLPARKPAL_EMAIL;
const password = process.env.BALLPARKPAL_PASSWORD;

if (!email || !password) {
    throw new Error('Missing BALLPARKPAL_EMAIL or BALLPARKPAL_PASSWORD environment variable.');
}

const exportsToFetch = [
    {
        recordType: 'batter',
        name: 'Batters',
        url: `https://www.ballparkpal.com/ExportBatters.php?date=${date}`,
    },
    {
        recordType: 'pitcher',
        name: 'Pitchers',
        url: `https://www.ballparkpal.com/ExportPitchers.php?date=${date}`,
    },
    {
        recordType: 'team',
        name: 'Teams',
        url: `https://www.ballparkpal.com/ExportTeams.php?date=${date}`,
    },
    {
        recordType: 'game',
        name: 'Games',
        url: `https://www.ballparkpal.com/ExportGames.php?date=${date}`,
    },
];

function cleanKey(key) {
    return String(key || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
        .replace(/^[A-Z]/, (m) => m.toLowerCase());
}

function cleanRow(row) {
    const out = {};

    for (const [key, value] of Object.entries(row)) {
        const cleanedKey = cleanKey(key);
        if (!cleanedKey) continue;
        out[cleanedKey] = value === undefined ? null : value;
    }

    return out;
}

async function loginAndGetCookie() {
    log.info('Opening browser for BallparkPal login');

    const browser = await chromium.launch({
        headless: true,
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    log.info('Navigating to login page');

    await page.goto('https://www.ballparkpal.com/login.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    await page.fill('input[type="email"], input[name="email"], input[name="username"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);

    await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => null),
        page.click('button[type="submit"], input[type="submit"], button'),
    ]);

    await page.goto('https://www.ballparkpal.com/Export-Center.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    const html = await page.content();

    if (html.toLowerCase().includes('login') && html.toLowerCase().includes('password')) {
        await browser.close();
        throw new Error('Login appears to have failed. Check BALLPARKPAL_EMAIL and BALLPARKPAL_PASSWORD.');
    }

    const cookies = await context.cookies('https://www.ballparkpal.com');

    const cookieHeader = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

    if (!cookieHeader.includes('PHPSESSID') && !cookieHeader.includes('system_id')) {
        await browser.close();
        throw new Error('Login succeeded visually, but expected session cookies were not found.');
    }

    log.info('Login complete; session cookie captured', {
        cookieCount: cookies.length,
    });

    await browser.close();

    return cookieHeader;
}

async function downloadExcel({ name, url }, cookie) {
    log.info(`Downloading ${name}`, { url });

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            cookie,
            referer: 'https://www.ballparkpal.com/Export-Center.php',
            'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            accept:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,*/*',
        },
    });

    if (!res.ok) {
        throw new Error(`Failed downloading ${name}: ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const contentDisposition = res.headers.get('content-disposition') || '';

    log.info(`Downloaded ${name}`, {
        status: res.status,
        contentType,
        contentDisposition,
    });

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const head = buffer.slice(0, 300).toString('utf8').toLowerCase();

    if (head.includes('<html') || head.includes('<!doctype')) {
        throw new Error(`${name} downloaded HTML instead of Excel. Login/session failed or export URL is wrong.`);
    }

    return buffer;
}

function parseExcel(buffer, exportMeta) {
    const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        raw: false,
    });

    const rows = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];

        const jsonRows = XLSX.utils.sheet_to_json(sheet, {
            defval: null,
        });

        for (const row of jsonRows) {
            const cleaned = cleanRow(row);

            rows.push({
                source: 'BallparkPal',
                exportDate: date,
                exportName: exportMeta.name,
                recordType: exportMeta.recordType,
                sheetName,
                parsedAt: new Date().toISOString(),
                ...cleaned,
                raw: row,
            });
        }
    }

    return rows;
}

const summary = {
    source: 'BallparkPal',
    recordType: 'export_debug_summary',
    version: 'v2-login-export-center',
    exportDate: date,
    exports: {},
    totalRows: 0,
    parsedAt: new Date().toISOString(),
};

const cookie = await loginAndGetCookie();

for (const exportMeta of exportsToFetch) {
    const buffer = await downloadExcel(exportMeta, cookie);
    const rows = parseExcel(buffer, exportMeta);

    summary.exports[exportMeta.name] = {
        recordType: exportMeta.recordType,
        url: exportMeta.url,
        rows: rows.length,
    };

    summary.totalRows += rows.length;

    log.info(`Parsed ${exportMeta.name}`, {
        rows: rows.length,
    });

    if (rows.length) {
        await Actor.pushData(rows);
    }
}

await Actor.pushData(summary);

log.info('BALLPARK EXPORT SCRAPER COMPLETE', summary);

await Actor.exit();