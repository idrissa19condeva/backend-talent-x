const { normalizePersonName } = require("../../utils/nameFormat");

describe("normalizePersonName", () => {
    test("normalizes casing + trims", () => {
        expect(normalizePersonName("  IDRISSA  ")).toBe("Idrissa");
        expect(normalizePersonName("cOnDe")).toBe("Conde");
    });

    test("collapses multiple spaces", () => {
        expect(normalizePersonName("  jean   pierre  ")).toBe("Jean Pierre");
    });

    test("keeps hyphens and apostrophes with Title Case", () => {
        expect(normalizePersonName("JEAN-PIERRE")).toBe("Jean-Pierre");
        expect(normalizePersonName("O'NEIL")).toBe("O'Neil");
        expect(normalizePersonName("d’ARTAGNAN")).toBe("D’Artagnan");
    });

    test("returns empty string for empty input", () => {
        expect(normalizePersonName("")).toBe("");
        expect(normalizePersonName("   ")).toBe("");
    });
});
