module.exports = {
    testEnvironment: "node",
    setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.js"],
    testMatch: ["**/tests/**/*.test.js"],
    clearMocks: true,
    modulePathIgnorePatterns: ["<rootDir>/tracknfield-mobile-back/"],
};
