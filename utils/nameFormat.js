function normalizePersonName(raw) {
    const cleaned = String(raw ?? "")
        .trim()
        .replace(/\s+/g, " ");

    if (!cleaned) return "";

    const lower = cleaned.toLocaleLowerCase();
    const parts = lower.split(/([\s\-’'])/);

    return parts
        .map((part) => {
            if (!part) return "";
            if (/^[\s\-’']$/.test(part)) return part;
            return part.charAt(0).toLocaleUpperCase() + part.slice(1);
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}

module.exports = { normalizePersonName };
