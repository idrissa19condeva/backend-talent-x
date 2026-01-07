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

const ensureTrainingGroupNameKeyIndex = async () => {
    const TrainingGroup = require("./models/TrainingGroup");

    // Backfill missing nameKey for existing groups.
    // Uses an aggregation pipeline update to compute: trim(name) + lowercase.
    await TrainingGroup.updateMany(
        {
            $or: [{ nameKey: { $exists: false } }, { nameKey: null }, { nameKey: "" }],
        },
        [
            {
                $set: {
                    nameKey: {
                        $toLower: {
                            $trim: { input: "$name" },
                        },
                    },
                },
            },
        ]
    );

    // Ensure the nameKey index is sparse unique to avoid duplicate null issues during rollout.
    const indexes = await TrainingGroup.collection.indexes();
    const nameKeyIndex = indexes.find((idx) => idx.name === "nameKey_1");
    const needsFix = nameKeyIndex && (!nameKeyIndex.unique || !nameKeyIndex.sparse);

    if (needsFix) {
        await TrainingGroup.collection.dropIndex("nameKey_1");
    }

    if (!nameKeyIndex || needsFix) {
        await TrainingGroup.collection.createIndex(
            { nameKey: 1 },
            { unique: true, sparse: true, name: "nameKey_1" }
        );
        console.log("🔧 Index nameKey_1 recréé en sparse unique");
    }
};

const ensureLicenseNumberIndex = async () => {
    const User = require("./models/User");
    const { normalizeLicenseNumber } = require("./utils/licenseNumber");

    // Backfill / normalize existing license numbers to digits-only.
    const cursor = User.find({ licenseNumber: { $exists: true, $ne: null } })
        .select("_id licenseNumber")
        .cursor();

    for await (const doc of cursor) {
        const current = doc.licenseNumber;
        if (current === undefined) continue;
        const normalized = normalizeLicenseNumber(current);

        if (!normalized) {
            await User.updateOne({ _id: doc._id }, { $unset: { licenseNumber: "" } });
            continue;
        }

        if (normalized !== current) {
            await User.updateOne({ _id: doc._id }, { $set: { licenseNumber: normalized } });
        }
    }

    // Ensure index is sparse+unique
    const indexes = await User.collection.indexes();
    const idx = indexes.find((i) => i.name === "licenseNumber_1");
    const needsFix = idx && (!idx.unique || !idx.sparse);
    if (needsFix) {
        await User.collection.dropIndex("licenseNumber_1");
    }

    if (!idx || needsFix) {
        await User.collection.createIndex(
            { licenseNumber: 1 },
            { unique: true, sparse: true, name: "licenseNumber_1" }
        );
        console.log("🔧 Index licenseNumber_1 recréé en sparse unique");
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

        try {
            await ensureTrainingGroupNameKeyIndex();
        } catch (indexErr) {
            console.warn("⚠️ Impossible de vérifier/créer l'index nameKey_1 :", indexErr.message);
        }

        try {
            await ensureLicenseNumberIndex();
        } catch (indexErr) {
            console.warn("⚠️ Impossible de vérifier/créer l'index licenseNumber_1 :", indexErr.message);
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
