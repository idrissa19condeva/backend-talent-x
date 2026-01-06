const dotenv = require("dotenv");

// Load environment variables BEFORE requiring the app/controllers.
// Otherwise modules may read process.env at import time and cache undefined.
dotenv.config({ path: process.env.ENV_FILE || undefined });

const mongoose = require("mongoose");
const { createApp } = require("./app");

const requireEnv = (key) => {
    const value = process.env[key];
    if (!value) {
        const envFileHint = process.env.ENV_FILE ? ` (ENV_FILE=${process.env.ENV_FILE})` : "";
        throw new Error(
            `Missing required env var: ${key}${envFileHint}. ` +
            `For E2E, start with: ENV_FILE=.env.e2e (via \"npm run e2e:start\").`
        );
    }
    return value;
};

// Fail fast if critical auth config is missing (prevents obscure JWT errors later).
try {
    requireEnv("MONGO_URI");
    requireEnv("JWT_SECRET");
    requireEnv("JWT_REFRESH_SECRET");
} catch (err) {
    console.error("❌ Config error:", err.message);
    process.exit(1);
}

const app = createApp();

const ensureUsernameIndex = async () => {
    // Ensure the username index is sparse to avoid duplicate null errors.
    const User = require("./models/User");
    const indexes = await User.collection.indexes();
    const usernameIndex = indexes.find((idx) => idx.name === "username_1");
    const needsFix = usernameIndex && !usernameIndex.sparse;
    if (needsFix) {
        await User.collection.dropIndex("username_1");
        await User.collection.createIndex({ username: 1 }, { unique: true, sparse: true, name: "username_1" });
        console.log("🔧 Index username_1 recréé en sparse");
    }
};

const start = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB connecté");

        try {
            await ensureUsernameIndex();
        } catch (indexErr) {
            console.warn("⚠️ Impossible de vérifier/créer l'index username_1 :", indexErr.message);
        }

        const PORT = process.env.PORT || 4001;
        const HOST = process.env.HOST || "0.0.0.0";
        app.listen(PORT, HOST, () => console.log(`🚀 Serveur lancé sur http://${HOST}:${PORT}`));
    } catch (err) {
        console.error("Erreur MongoDB:", err);
        process.exitCode = 1;
    }
};

start();
