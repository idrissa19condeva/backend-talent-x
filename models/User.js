const mongoose = require("mongoose");

const performanceTimelineSchema = new mongoose.Schema(
    {
        date: { type: Date, required: false },
        rawDate: { type: String, trim: true },
        year: { type: Number, required: false },
        value: { type: String, required: true }, // garder la performance brute (ex: "23''44")
        discipline: { type: String, required: true, trim: true },
        meeting: { type: String, trim: true },
        city: { type: String, trim: true },
        surface: { type: String, trim: true },
        notes: { type: String, trim: true },
        source: { type: String, trim: true },
    },
    { _id: true, timestamps: false }
);

const medalsSchema = new mongoose.Schema(
    {
        gold: { type: Number, default: 0 },
        silver: { type: Number, default: 0 },
        bronze: { type: Number, default: 0 },
    },
    { _id: false }
);

const inboxNotificationSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            required: true,
            enum: [
                "friend_request_received",
                "friend_request_accepted",
                "group_join_requested",
                "group_join_accepted",
                "group_session_shared",
                "group_session_removed",
            ],
        },
        message: { type: String, required: true, trim: true, maxlength: 200 },
        data: { type: mongoose.Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: true, timestamps: false }
);

const userSchema = new mongoose.Schema(
    {
        // 🔹 Informations de base
        fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
        firstName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
        lastName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
        username: { type: String, required: false, trim: true, unique: true, sparse: true },
        email: { type: String, required: true, unique: true, lowercase: true },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ["athlete", "coach"], default: "athlete" },

        // 🔹 Informations personnelles
        gender: { type: String, enum: ["male", "female"], default: "female" },
        birthDate: { type: Date, required: false },
        country: { type: String, required: false },
        city: { type: String },
        language: { type: String, enum: ["fr", "en"], default: "fr" },
        bodyWeightKg: { type: Number, min: 0 },
        maxMuscuKg: { type: Number, min: 0 },
        maxChariotKg: { type: Number, min: 0 },
        phone: { type: String, trim: true },
        phoneNumber: { type: String, trim: true },
        trainingAddress: { type: String, trim: true },
        photoUrl: { type: String },
        photoVersion: { type: Number, default: 0 },
        photoData: { type: Buffer, select: false },
        photoContentType: { type: String, select: false },

        // 🔹 Informations sportives
        mainDisciplineFamily: { type: String, required: false },
        mainDiscipline: { type: String, required: false },
        otherDisciplines: [{ type: String }],
        licenseNumber: { type: String, required: false, trim: true },
        epreuve: [{ type: Map, of: [String] }], // ex: [ { "100m": "12.34s" } ]
        club: { type: String },
        level: { type: String, enum: ["beginner", "intermediate", "advanced", "pro"], default: "beginner" },
        category: { type: String, enum: ["Benjamin", "Junior", "Senior", "Master"], default: "Senior" },
        goals: { type: String, maxlength: 200 },
        dominantLeg: { type: String, enum: ["left", "right", "unknown"], default: "unknown" },
        favoriteCoach: { type: String, trim: true },
        weeklySessions: { type: Number, min: 0, max: 21, default: 0 },

        // 🔹 Performances & statistiques
        records: { type: Map, of: String }, // ex: { "400m": "50.62s" }
        recordPoints: { type: Map, of: Number },
        competitionsCount: { type: Number, default: 0 },
        challengesCount: { type: Number, default: 0 },
        rankGlobal: { type: Number, default: 0 },
        rankNational: { type: Number, default: 0 },
        trackPoints: { type: Number, default: 0 },
        badges: [{ type: mongoose.Schema.Types.Mixed }],
        seasonPerformances: { type: Map, of: String },
        performanceTimeline: { type: [performanceTimelineSchema], default: [] },
        performances: [
            {
                epreuve: { type: String, required: true }, record: { type: String }, bestSeason: { type: String }
            }],
        xp: { type: Number, default: 0 },
        levelName: { type: String, default: "Rookie" },
        medals: { type: medalsSchema, default: () => ({}) },
        followers: { type: Number, default: 0 },
        following: { type: Number, default: 0 },
        achievements: [{ type: String }],
        favoriteSurface: { type: String, enum: ["track", "road", "trail", "indoor", "unknown"], default: "track" },
        preferredTrainingTime: {
            type: String,
            enum: ["morning", "afternoon", "evening", "night"],
            default: "morning",
        },
        totalDistance: { type: Number, default: 0 },
        bestPerformance: { type: String },
        lastActivityDate: { type: Date },
        streakDays: { type: Number, default: 0 },
        bio: { type: String, maxlength: 280 },
        friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        friendRequestsSent: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: [] }],
        friendRequestsReceived: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: [] }],

        // 🔔 Notifications persistées (inbox)
        inboxNotifications: { type: [inboxNotificationSchema], default: [] },

        // 📱 Push notifications (Expo)
        // Stored server-side to target this device when sending pushes.
        // Kept private (not returned by default in /me).
        expoPushTokens: { type: [String], default: [], select: false },

        // 🔹 Compte & sécurité
        isVerified: { type: Boolean, default: false },
        status: { type: String, enum: ["active", "suspended", "deleted"], default: "active" },

        // 🔐 Reset mot de passe (code email)
        // Stocké en hash pour éviter de persister le code en clair.
        passwordResetCodeHash: { type: String, select: false },
        passwordResetExpiresAt: { type: Date, select: false },
        passwordResetAttempts: { type: Number, default: 0, select: false },
        passwordResetRequestedAt: { type: Date, select: false },

        // 🔹 Préférences
        isProfilePublic: { type: Boolean, default: true },
        notificationsEnabled: { type: Boolean, default: true },
        autoSharePerformance: { type: Boolean, default: false },
        theme: { type: String, enum: ["light", "dark", "system"], default: "system" },

        // 🔹 Réseaux sociaux
        instagram: { type: String },
        strava: { type: String },
        tiktok: { type: String },
        website: { type: String },

        // 🔹 Avatar Ready Player Me
        rpmAvatarId: { type: String },
        rpmAvatarUrl: { type: String },
        rpmAvatarPreviewUrl: { type: String },
        rpmAvatarMeta: { type: mongoose.Schema.Types.Mixed },
        rpmUserId: { type: String },
        rpmUserToken: { type: String, select: false },

        // 🔹 Résultats FFA importés
        ffaResultsByYear: { type: mongoose.Schema.Types.Mixed }, // { [year]: { [epreuve]: Entry[] } }
        ffaMergedByEvent: { type: mongoose.Schema.Types.Mixed }, // { [epreuve]: Entry[] }
    },
    {
        timestamps: true, // ajoute createdAt et updatedAt automatiquement
    }
);

userSchema.index({ licenseNumber: 1 }, { unique: true, sparse: true, name: "licenseNumber_1" });

module.exports = mongoose.model("User", userSchema);
