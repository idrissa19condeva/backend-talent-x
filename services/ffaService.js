const https = require("https");

const stripTags = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const parseWind = (raw) => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
    const cleaned = String(raw).replace(/,/g, ".").replace(/m\/?s/i, "").trim();
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const value = parseFloat(match[0]);
    return Number.isFinite(value) ? value : undefined;
};

const parseDistance = (raw = "") => {
    const num = Number.parseFloat(String(raw).replace(",", "."));
    return Number.isFinite(num) ? num : null;
};

const normalizeLicense = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits || null;
};

const classifyMetric = (epreuve, performance) => {
    const label = String(epreuve || "").toLowerCase();
    const perf = String(performance || "").toLowerCase();

    if (/decathlon|heptathlon|pentathlon/.test(label) || /pts|points/.test(perf)) return "points";

    const hasTimeHints = perf.includes(":") || /['’]/.test(perf) || /km|marathon/.test(label) || /\d+m/.test(label.replace(/\s+/g, ""));
    const timeValue = parsePerformanceToSeconds(performance);
    if (timeValue !== null && (hasTimeHints || timeValue < 20 * 60)) {
        return "time";
    }

    return "distance";
};

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

const extractLicensesFromProfile = (html = "") => {
    // Primary pass: tolerant span/gap between label and digits (allows tags, nbsp, newlines, etc.).
    const primary = [...html.matchAll(/licen[cs]e[\s\S]{0,80}?(\d{5,})/gi)]
        .map((m) => normalizeLicense(m[1]))
        .filter(Boolean);
    if (primary.length) return Array.from(new Set(primary));

    // Fallback: strip tags and retry on plain text in case the first regex missed.
    const text = stripTags(html);
    const fallback = [...text.matchAll(/licen[cs]e[^0-9]{0,20}(\d{5,})/gi)]
        .map((m) => normalizeLicense(m[1]))
        .filter(Boolean);
    return Array.from(new Set(fallback));
};

async function resolveActseqByLicense(autocomplete = [], normalizedLicense) {
    if (!normalizedLicense || !Array.isArray(autocomplete) || autocomplete.length === 0) return null;

    const direct = autocomplete.find((entry) => {
        const lic = normalizeLicense(
            entry?.license
            || entry?.licence
            || entry?.licenceNumber
            || entry?.licence_number
            || entry?.lic,
        );
        return Boolean(lic && lic === normalizedLicense);
    });
    if (direct?.actseq) return direct.actseq;

    for (const entry of autocomplete) {
        const seq = entry?.actseq;
        if (!seq) continue;
        try {
            const profileHtml = await fetchUrl(new URL(`https://www.athle.fr/athletes/${seq}`));
            const licenses = extractLicensesFromProfile(profileHtml);
            console.log("FFA license profile scan", { actseq: seq, provided: normalizedLicense, found: licenses });
            if (licenses.includes(normalizedLicense)) return seq;
        } catch (err) {
            console.warn("FFA license lookup failed for actseq", seq, err.message);
        }
    }

    return null;
}

async function fetchFfaByName(firstName, lastName, years = [], licenseNumber) {
    const trimmedFirst = (firstName || "").trim();
    const trimmedLast = (lastName || "").trim();
    if (!trimmedFirst || !trimmedLast) return null;

    const normalizedLicense = normalizeLicense(licenseNumber);

    const search = `${encodeURIComponent(trimmedLast)}%20${encodeURIComponent(trimmedFirst)}`;
    const url = new URL(`https://www.athle.fr/ajax/autocompletion.aspx?mode=1&recherche=${search}`);

    const raw = await fetchUrl(url);
    console.log("FFA fetch autocomplete len=", raw?.length, "preview=", raw?.slice?.(0, 120));

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_err) {
        console.warn("FFA parse autocomplete failed for search", search);
    }

    const autocomplete = Array.isArray(parsed) ? parsed : [];

    let actseq = null;
    if (autocomplete.length) {
        actseq = normalizedLicense ? await resolveActseqByLicense(autocomplete, normalizedLicense) : null;
        if (!actseq && normalizedLicense) {
            console.warn("FFA autocomplete multiple matches, license filter did not match", normalizedLicense);
        }
        if (!actseq && !normalizedLicense) {
            actseq = autocomplete[0]?.actseq;
        }
    }

    if (!actseq) {
        console.warn("FFA autocomplete returned no actseq for", trimmedLast, trimmedFirst, "license", normalizedLicense || "none");
        const base = { autocomplete, resultsByYear: {}, recordsByEvent: {} };
        if (normalizedLicense) {
            return { ...base, licenseVerified: false, licenseCheckFailed: true };
        }
        return base;
    }

    const getMaxPage = (html) => {
        const pages = [...html.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1])).filter((n) => !Number.isNaN(n));
        const altPages = [...html.matchAll(/page=(\d+)/gi)].map((m) => Number(m[1])).filter((n) => !Number.isNaN(n));
        return Math.max(1, ...pages, ...altPages);
    };

    let profileHtmlCache = null;
    let licenseVerified = normalizedLicense ? false : undefined;

    if (normalizedLicense) {
        try {
            profileHtmlCache = await fetchUrl(new URL(`https://www.athle.fr/athletes/${actseq}`));
            const licenses = extractLicensesFromProfile(profileHtmlCache);
            console.log("FFA license check", { actseq, provided: normalizedLicense, found: licenses });
            const matches = licenses.includes(normalizedLicense);
            licenseVerified = matches;
            if (!matches) {
                console.warn("FFA license mismatch, skip fetching performances", {
                    actseq,
                    expected: normalizedLicense,
                    found: licenses,
                    source: "profile"
                });
                return {
                    actseq,
                    autocomplete,
                    resultsByYear: {},
                    recordsByEvent: {},
                    licenseVerified: false,
                    licensesFound: licenses,
                };
            }
        } catch (err) {
            console.warn("FFA license verification failed for actseq", actseq, err.message);
            return {
                actseq,
                autocomplete,
                resultsByYear: {},
                recordsByEvent: {},
                licenseVerified: false,
                licenseCheckFailed: true,
            };
        }
    }

    const fetchAvailableYears = async (cachedHtml) => {
        let html = cachedHtml;
        if (!html) {
            try {
                html = await fetchUrl(new URL(`https://www.athle.fr/athletes/${actseq}`));
            } catch (err) {
                console.warn("FFA fetch years failed for actseq", actseq, err.message);
                return [];
            }
        }

        const yearMatches = [...html.matchAll(/(?:data-value|value)="(\d{4})"/g)].map((m) => m[1]);
        const distinct = Array.from(new Set(yearMatches));
        return distinct.sort((a, b) => Number(b) - Number(a));
    };

    let resolvedYears = (years || []).filter(Boolean);
    if (resolvedYears.length === 0) {
        resolvedYears = await fetchAvailableYears(profileHtmlCache);
    }
    if (resolvedYears.length === 0) {
        resolvedYears = [String(new Date().getFullYear())];
    }

    const resultsByYear = {};
    for (const year of resolvedYears) {
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

    const betterThan = (metric, candidateValue, currentValue) => {
        if (candidateValue === null || candidateValue === undefined) return false;
        if (currentValue === null || currentValue === undefined) return true;
        if (metric === "time") return candidateValue < currentValue;
        return candidateValue > currentValue; // distance or points
    };

    for (const events of Object.values(resultsByYear)) {
        for (const [epreuve, entries] of Object.entries(events)) {
            const metric = classifyMetric(epreuve, entries[0]?.performance);
            for (const entry of entries) {
                const wind = parseWind(entry.vent);
                const legal = wind === undefined || wind === null || wind <= 2.0;

                let candidateValue = null;
                if (metric === "points") {
                    const pts = Number(entry.points);
                    candidateValue = Number.isFinite(pts) ? pts : null;
                } else if (metric === "time") {
                    candidateValue = parsePerformanceToSeconds(entry.performance);
                } else {
                    candidateValue = parseDistance(entry.performance);
                }

                const current = recordsByEvent[epreuve];
                const currentLegal = current?.__legal === true;
                const currentValue = current?.__value;

                const shouldReplace = () => {
                    if (legal && !currentLegal) return true;
                    if (legal === currentLegal) return betterThan(metric, candidateValue, currentValue);
                    return false;
                };

                if (shouldReplace()) {
                    recordsByEvent[epreuve] = { ...entry, __legal: legal, __value: candidateValue, __metric: metric };
                }
            }
        }
    }

    // strip helper flags
    Object.keys(recordsByEvent).forEach((key) => {
        if (recordsByEvent[key]) {
            const { __legal, __value, __metric, ...rest } = recordsByEvent[key];
            recordsByEvent[key] = rest;
        }
    });

    return { actseq, resultsByYear, autocomplete, recordsByEvent, licenseVerified };
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
                const label = entry.epreuveOriginal || discipline;
                const value = parsePerformanceToSeconds(entry.performance);
                const date = toIsoDate(entry.date, year);
                if (value === null || !date) continue;
                points.push({
                    discipline: label,
                    date,
                    value,
                    meeting: `${entry.tour || ""}${entry.niveau ? ` (${entry.niveau})` : ""}${entry.vent ? `, vent ${entry.vent}` : ""}`.trim(),
                    city: entry.lieu || undefined,
                    points: entry.points ? Number.parseInt(entry.points, 10) : undefined,
                    wind: parseWind(entry.vent),
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
