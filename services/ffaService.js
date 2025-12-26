const https = require("https");

const stripTags = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function parseResultsTable(html) {
    // Some rows are not marked clickable; accept any row with 9+ cells to avoid missing performances.
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    const byEvent = {};

    for (const [, rowHtml] of rows) {
        const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
        if (cells.length < 9) continue;
        const [date, epreuve, performance, vent, tour, place, niveau, points, lieu] = cells;
        const entry = { date, performance, vent, tour, place, niveau, points, lieu };
        byEvent[epreuve] = byEvent[epreuve] || [];
        byEvent[epreuve].push(entry);
    }

    return byEvent;
}

function fetchUrl(targetUrl) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            targetUrl,
            {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                },
            },
            (res) => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    res.resume();
                    return;
                }

                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    body += chunk;
                });
                res.on("end", () => resolve(body));
            },
        );

        req.on("error", (err) => reject(err));
    });
}

async function fetchFfaByName(firstName, lastName, years = []) {
    const trimmedFirst = (firstName || "").trim();
    const trimmedLast = (lastName || "").trim();
    if (!trimmedFirst || !trimmedLast) return null;

    const search = `${encodeURIComponent(trimmedLast)}%${encodeURIComponent(trimmedFirst)}`;
    const url = new URL(`https://www.athle.fr/ajax/autocompletion.aspx?mode=1&recherche=${search}`);

    const raw = await fetchUrl(url);
    console.log("FFA fetch autocomplete len=", raw?.length, "preview=", raw?.slice?.(0, 120));

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_err) {
        console.warn("FFA parse autocomplete failed for search", search);
    }

    const autocomplete = Array.isArray(parsed) ? parsed : null;
    const actseq = Array.isArray(parsed) && parsed[0]?.actseq;
    if (!actseq) {
        console.warn("FFA autocomplete returned no actseq for", trimmedLast, trimmedFirst);
        return { autocomplete: autocomplete || [], resultsByYear: {}, recordsByEvent: {} };
    }

    const getMaxPage = (html) => {
        const pages = [...html.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1])).filter((n) => !Number.isNaN(n));
        const altPages = [...html.matchAll(/page=(\d+)/gi)].map((m) => Number(m[1])).filter((n) => !Number.isNaN(n));
        return Math.max(1, ...pages, ...altPages);
    };

    const resultsByYear = {};
    for (const year of years) {
        const baseUrl = `https://www.athle.fr/ajax/fiche-athlete-resultats.aspx?seq=${actseq}&annee=${year}`;

        const firstPageRaw = await fetchUrl(new URL(baseUrl));
        let merged = parseResultsTable(firstPageRaw);
        const maxPage = getMaxPage(firstPageRaw);

        if (maxPage > 1) {
            for (let page = 2; page <= maxPage; page += 1) {
                const pagedRaw = await fetchUrl(new URL(`${baseUrl}&page=${page}`));
                const parsedPage = parseResultsTable(pagedRaw);
                for (const [epreuve, entries] of Object.entries(parsedPage)) {
                    merged[epreuve] = merged[epreuve] || [];
                    merged[epreuve].push(...entries);
                }
            }
        }

        resultsByYear[year] = merged;
    }

    const recordsByEvent = {};
    for (const events of Object.values(resultsByYear)) {
        for (const [epreuve, entries] of Object.entries(events)) {
            for (const entry of entries) {
                const pts = Number(entry.points);
                const current = recordsByEvent[epreuve];
                const currentPts = Number(current?.points);
                const isBetter = !Number.isNaN(pts)
                    ? Number.isNaN(currentPts) || pts > currentPts
                    : current === undefined;
                if (isBetter) {
                    recordsByEvent[epreuve] = entry;
                }
            }
        }
    }

    return { actseq, resultsByYear, autocomplete: autocomplete || [], recordsByEvent };
}

// --- Normalization helpers to produce frontend-ready data ---
const monthMap = {
    janv: 1,
    "janv.": 1,
    jan: 1,
    fev: 2,
    "fev.": 2,
    fevr: 2,
    "fevr.": 2,
    fevrier: 2,
    mar: 3,
    mars: 3,
    avr: 4,
    mai: 5,
    juin: 6,
    juil: 7,
    "juil.": 7,
    juillet: 7,
    aout: 8,
    "aout.": 8,
    sept: 9,
    "sept.": 9,
    octobre: 10,
    oct: 10,
    nov: 11,
    novembre: 11,
    dec: 12,
    "dec.": 12,
    decembre: 12,
};

const normalizeMonth = (value = "") => {
    const key = value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[^a-z.]/g, "");
    return monthMap[key] || null;
};

const toIsoDate = (raw, year) => {
    if (!raw || !year) return null;
    const parts = raw.replace(/\s+/g, " ").trim().split(" ");
    const day = Number.parseInt(parts[0], 10);
    const month = normalizeMonth(parts[1]);
    if (!Number.isFinite(day) || !month) return null;
    // noon UTC to avoid TZ shifts on display
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
};

const parsePerformanceToSeconds = (raw = "") => {
    const trimmed = raw.trim();
    if (!trimmed || /dnf|np|nr/i.test(trimmed)) return null;

    // prefer corrected value inside parentheses when present
    const paren = trimmed.match(/\(([^)]+)\)/);
    const base = paren ? paren[1].trim() : trimmed;

    // format mm'ss'' or mm'ss.xx
    const mmss = base.match(/^(\d+)[’'](\d{1,2})(?:[.’'](\d{1,2}))?/);
    if (mmss) {
        const m = Number.parseInt(mmss[1], 10);
        const s = Number.parseInt(mmss[2], 10);
        const dec = mmss[3] ? Number.parseInt(mmss[3], 10) / 100 : 0;
        return m * 60 + s + dec;
    }

    // format ss'' or ss.xx'' (sprints)
    const ss = base.match(/^(\d{1,3})(?:[’']{2}|[’'])(\d{0,2})?$/);
    if (ss) {
        const whole = Number.parseInt(ss[1], 10);
        const dec = ss[2] ? Number.parseInt(ss[2], 10) / 100 : 0;
        return whole + dec;
    }

    // plain numeric with comma/point
    const num = Number.parseFloat(base.replace(",", "."));
    return Number.isFinite(num) ? num : null;
};

const buildPerformancePoints = (resultsByYear) => {
    const points = [];
    for (const [yearStr, events] of Object.entries(resultsByYear || {})) {
        const year = Number.parseInt(yearStr, 10);
        if (!Number.isFinite(year)) continue;
        for (const [discipline, entries] of Object.entries(events || {})) {
            for (const entry of entries) {
                const value = parsePerformanceToSeconds(entry.performance);
                const date = toIsoDate(entry.date, year);
                if (value === null || !date) continue;
                points.push({
                    discipline,
                    date,
                    value,
                    meeting: `${entry.tour || ""}${entry.niveau ? ` (${entry.niveau})` : ""}${entry.vent ? `, vent ${entry.vent}` : ""}`.trim(),
                    city: entry.lieu || undefined,
                    points: entry.points ? Number.parseInt(entry.points, 10) : undefined,
                });
            }
        }
    }
    return points.sort((a, b) => new Date(a.date) - new Date(b.date));
};

module.exports = {
    fetchFfaByName,
    parseResultsTable,
    buildPerformancePoints,
    parsePerformanceToSeconds,
    toIsoDate,
};
