const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/userRoute");
const authRoutes = require("./routes/authRoute");
const avatarRoutes = require("./routes/avatarRoute");
const trainingRoutes = require("./routes/trainingRoute");
const trainingGroupRoutes = require("./routes/trainingGroupRoute");
const trainingTemplateRoutes = require("./routes/trainingTemplateRoute");
const trainingBlockRoutes = require("./routes/trainingBlockRoute");

const createApp = () => {
    const app = express();

    app.use(cors());
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
