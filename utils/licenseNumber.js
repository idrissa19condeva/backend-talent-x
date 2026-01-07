const normalizeLicenseNumber = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits || null;
};

module.exports = {
    normalizeLicenseNumber,
};
