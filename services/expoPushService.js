const fetch = require("node-fetch");

const isExpoPushToken = (token) => {
    if (typeof token !== "string") return false;
    const trimmed = token.trim();
    return trimmed.startsWith("ExponentPushToken[") || trimmed.startsWith("ExpoPushToken[");
};

const chunkArray = (items = [], size = 1) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const sendExpoPush = async ({ tokens, title, body, data }) => {
    const messages = (tokens || [])
        .filter(isExpoPushToken)
        .map((token) => ({
            to: token,
            sound: "default",
            title: title || "Talent-X",
            body: body || "",
            data: data || {},
        }));

    if (!messages.length) {
        return { ok: true, tickets: [], message: "No valid Expo push tokens" };
    }

    const tickets = [];
    // Expo rejects a single /push/send request if it contains tokens from different projects.
    // Users can accumulate tokens from multiple builds/projects over time.
    // Sending one token per request avoids cross-project conflicts.
    const chunks = chunkArray(messages, 1);

    for (const chunk of chunks) {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(chunk),
        });

        const json = await response.json().catch(() => null);
        if (!response.ok) {
            const message = json?.errors?.[0]?.message || json?.message || `Expo push error (${response.status})`;
            throw new Error(message);
        }

        const chunkTickets = json?.data;
        if (Array.isArray(chunkTickets)) {
            tickets.push(...chunkTickets);
        }
    }

    return { ok: true, tickets };
};

module.exports = {
    isExpoPushToken,
    sendExpoPush,
};
