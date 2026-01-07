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
