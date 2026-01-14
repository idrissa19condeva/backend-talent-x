const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/userRoute");
const authRoutes = require("./routes/authRoute");
const avatarRoutes = require("./routes/avatarRoute");
const trainingRoutes = require("./routes/trainingRoute");
const trainingGroupRoutes = require("./routes/trainingGroupRoute");
const trainingTemplateRoutes = require("./routes/trainingTemplateRoute");
const trainingBlockRoutes = require("./routes/trainingBlockRoute");

const parseCorsOrigins = () => {
    const raw = String(process.env.CORS_ORIGINS || "").trim();
    if (!raw) return null;

    const origins = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    return origins.length ? origins : null;
};

const createApp = () => {
    const app = express();

    const escapeHtml = (value) =>
        String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");

    const allowedOrigins = parseCorsOrigins();
    if (!allowedOrigins) {
        // Default: permissive (useful for local dev + native mobile clients).
        app.use(cors());
    } else {
        app.use(
            cors({
                origin: (origin, callback) => {
                    // Native/mobile requests often have no Origin header.
                    if (!origin) return callback(null, true);
                    if (allowedOrigins.includes(origin)) return callback(null, true);
                    return callback(new Error("Not allowed by CORS"));
                },
            }),
        );
    }
    app.use(express.json({ limit: "10mb" }));
    app.use("/uploads", express.static("uploads"));

    // Universal links / App links support
    // - iOS: /.well-known/apple-app-site-association
    // - Android: /.well-known/assetlinks.json
    // These are used when sharing https://<domain>/groups/<id>
    app.get("/.well-known/apple-app-site-association", (_req, res) => {
        const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
        const bundleId = String(process.env.IOS_BUNDLE_ID || "com.talentx.app").trim();

        if (!teamId) {
            return res.status(503).json({
                error: "Missing APPLE_TEAM_ID",
                hint: "Set APPLE_TEAM_ID (Apple Team ID) for Universal Links to work on iOS.",
            });
        }

        res.setHeader("Content-Type", "application/json");
        return res.status(200).send({
            applinks: {
                apps: [],
                details: [
                    {
                        appID: `${teamId}.${bundleId}`,
                        paths: ["/groups/*"],
                    },
                ],
            },
        });
    });

    app.get("/.well-known/assetlinks.json", (_req, res) => {
        const packageName = String(process.env.ANDROID_PACKAGE_NAME || "com.talentx.app").trim();
        const fingerprintsRaw = String(process.env.ANDROID_SHA256_CERT_FINGERPRINTS || "").trim();
        const fingerprints = fingerprintsRaw
            ? fingerprintsRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

        if (!fingerprints.length) {
            return res.status(503).json({
                error: "Missing ANDROID_SHA256_CERT_FINGERPRINTS",
                hint:
                    "Set ANDROID_SHA256_CERT_FINGERPRINTS as comma-separated SHA256 fingerprints to enable Android App Links.",
            });
        }

        res.setHeader("Content-Type", "application/json");
        return res.status(200).send([
            {
                relation: ["delegate_permission/common.handle_all_urls"],
                target: {
                    namespace: "android_app",
                    package_name: packageName,
                    sha256_cert_fingerprints: fingerprints,
                },
            },
        ]);
    });

    // Landing page when the app is not installed.
    // When the app is installed and universal links/app links are configured,
    // opening this URL should jump into the app automatically.
    app.get("/groups/:id", async (req, res) => {
        const groupId = String(req.params.id || "").trim();
        const deepLink = `talent-x:///(main)/training/groups/${encodeURIComponent(groupId)}`;

        let groupName = "ce groupe";
        try {
            const mongoose = require("mongoose");
            const isValidId = mongoose.Types.ObjectId.isValid(groupId);
            if (isValidId) {
                const TrainingGroup = require("./models/TrainingGroup");
                const group = await TrainingGroup.findById(groupId).select("name").lean();
                if (group?.name) {
                    groupName = group.name;
                }
            }
        } catch (error) {
            // Best-effort only: landing page must still render even if DB isn't reachable.
            console.warn("groupsLanding", error?.message || error);
        }

        const safeGroupName = escapeHtml(groupName);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(`<!doctype html>
<html lang="fr">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Rejoindre ${safeGroupName} - Talent-X</title>
    </head>
    <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; padding:24px; background:#0b1220; color:#e2e8f0;">
        <h1 style="margin:0 0 6px; font-size:18px; line-height:1.25; font-weight:700;">Rejoindre ${safeGroupName}</h1>
        <p style="margin:0 0 18px; color:#94a3b8;">
            Ouvre Talent-X pour accéder au groupe et faire ta demande d’adhésion.
        </p>
        <a href="${deepLink}" style="display:inline-block; padding:12px 16px; background:#22d3ee; color:#02131d; text-decoration:none; border-radius:10px; font-weight:700;">
            Ouvrir dans l’app
        </a>
        <p style="margin:18px 0 0; color:#94a3b8;">
            Si l’app ne s’ouvre pas automatiquement, installe Talent-X puis ré-ouvre ce lien.
        </p>
    </body>
</html>`);
    });

    app.get("/api/health", (_req, res) => {
        res.status(200).json({ ok: true });
    });

    app.use("/api/user", userRoutes);
    app.use("/api/auth", authRoutes);
    app.use("/api/avatar", avatarRoutes);
    app.use("/api/trainings", trainingRoutes);
    app.use("/api/groups", trainingGroupRoutes);
    app.use("/api/training-templates", trainingTemplateRoutes);
    app.use("/api/training-blocks", trainingBlockRoutes);

    return app;
};

module.exports = { createApp };
