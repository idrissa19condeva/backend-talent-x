const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), ".env") });

const User = require("../../models/User");

const requireSafeDb = (mongoUri) => {
    if (!mongoUri) throw new Error("MONGO_URI manquant");
    const safe = /e2e|test/i.test(mongoUri);
    if (!safe) {
        throw new Error(
            `Refus de toucher à une DB non-e2e/non-test. MONGO_URI=${mongoUri}`
        );
    }
};

const main = async () => {
    const mongoUri = process.env.MONGO_URI;
    requireSafeDb(mongoUri);

    await mongoose.connect(mongoUri);

    // Reset
    await mongoose.connection.dropDatabase();

    // Seed: deterministic user
    const email = process.env.E2E_USER_EMAIL || "e2e.user@example.com";
    const password = process.env.E2E_USER_PASSWORD || "P@ssw0rd!";
    const passwordHash = await bcrypt.hash(password, 10);

    await User.findOneAndUpdate(
        { email: email.toLowerCase() },
        {
            email: email.toLowerCase(),
            passwordHash,
            firstName: "E2E",
            lastName: "User",
            fullName: "E2E User",
            role: "athlete",
            gender: "female",
            status: "active",
            isVerified: true,
            // keep optional fields minimal
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log("✅ E2E DB reset + seeded");
    console.log("E2E_USER_EMAIL=", email);
    console.log("E2E_USER_PASSWORD=", password);

    await mongoose.disconnect();
};

main().catch((err) => {
    console.error("❌ E2E prepare failed:", err);
    process.exitCode = 1;
});
