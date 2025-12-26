// Simple script to fetch FFA autocomplete results and optionally chain the athlete results call.
// Usage:
//   node scripts/fetch-ffa-autocomplete.js "conde%idrissa" 2024
//     - first arg: search term (already URL-encoded)
//     - second arg: year for fiche-athlete-resultats (optional, default 2024)

const https = require("https");

const search = process.argv[2] || "Conde%Idrissa";
const years = (process.argv[3]?.split(",") ?? ["2025", "2024", "2023"]).map((y) => y.trim()).filter(Boolean);
const url = new URL(`https://www.athle.fr/ajax/autocompletion.aspx?mode=1&recherche=${search}`);

const stripTags = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function parseResultsTable(html) {
    const rows = [...html.matchAll(/<tr[^>]*class="[^"]*clickable[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)];
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

function fetchAutocomplete(targetUrl) {
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

(async () => {
    try {
        const raw = await fetchAutocomplete(url);
        let parsed;
        try {
            parsed = JSON.parse(raw);
            console.log("Autocomplete:");
            console.log(JSON.stringify(parsed, null, 2));
        } catch (_err) {
            console.log("Autocomplete (raw):");
            console.log(raw);
        }

        // If we have an actseq, chain the results call.
        const actseq = Array.isArray(parsed) && parsed[0]?.actseq;
        console.log("\nExtracted actseq:", actseq);
        if (!actseq) return;

        for (const year of years) {
            const resultsUrl = new URL(
                `https://www.athle.fr/ajax/fiche-athlete-resultats.aspx?seq=${actseq}&annee=${year}`,
            );
            const rawResults = await fetchAutocomplete(resultsUrl);
            const structured = parseResultsTable(rawResults);
            console.log(`\nRésultats ${year} (structurés par épreuve):`);
            console.log(JSON.stringify(structured, null, 2));
        }
    } catch (err) {
        console.error("Fetch failed:", err.message);
        process.exitCode = 1;
    }
})();
