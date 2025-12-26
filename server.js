const express = require("express");
const app = express();
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");

// Load environment variables before loading routes/controllers that rely on them.
dotenv.config();

const userRoutes = require("./routes/userRoute");
const authRoutes = require("./routes/authRoute");
const avatarRoutes = require("./routes/avatarRoute");
const trainingRoutes = require("./routes/trainingRoute");
const trainingGroupRoutes = require("./routes/trainingGroupRoute");

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB connecté");

        // Ensure the username index is sparse to avoid duplicate null errors.
        try {
            const User = require("./models/User");
            const indexes = await User.collection.indexes();
            const usernameIndex = indexes.find((idx) => idx.name === "username_1");
            const needsFix = usernameIndex && !usernameIndex.sparse;
            if (needsFix) {
                await User.collection.dropIndex("username_1");
                await User.collection.createIndex({ username: 1 }, { unique: true, sparse: true, name: "username_1" });
                console.log("🔧 Index username_1 recréé en sparse");
            }
        } catch (indexErr) {
            console.warn("⚠️ Impossible de vérifier/créer l'index username_1 :", indexErr.message);
        }
    })
    .catch((err) => console.error("Erreur MongoDB:", err));

app.use("/api/user", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/avatar", avatarRoutes);
app.use("/api/trainings", trainingRoutes);
app.use("/api/groups", trainingGroupRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));
