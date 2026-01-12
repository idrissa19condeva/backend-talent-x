const mongoose = require("mongoose");

const trainingBlockSegmentSchema = new mongoose.Schema(
    {
        distance: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: function (value) {
                    if (this.blockType === "custom") {
                        return typeof value === "number" && value >= 0;
                    }
                    if (this.blockType === "muscu") {
                        return typeof value === "number" && value >= 0;
                    }
                    if (this.blockType === "cotes" && this.cotesMode === "duration") {
                        return typeof value === "number" && value >= 0;
                    }
                    return typeof value === "number" && value >= 1;
                },
                message: "La distance doit être positive pour ce bloc.",
            },
        },
        distanceUnit: { type: String, enum: ["m", "km"], default: "m" },
        restInterval: { type: Number, required: true, min: 0 },
        restUnit: { type: String, enum: ["s", "min"], default: "s" },
        blockType: { type: String, enum: ["vitesse", "cotes", "ppg", "muscu", "start", "recup", "custom"], required: true },
        cotesMode: { type: String, enum: ["distance", "duration"] },
        durationSeconds: { type: Number, min: 0 },
        ppgExercises: { type: [String], default: [] },
        ppgMode: { type: String, enum: ["time", "reps"], default: "time" },
        ppgDurationSeconds: { type: Number, min: 0 },
        ppgRestSeconds: { type: Number, min: 0 },
        ppgRepetitions: {
            type: Number,
            min: 0,
            validate: {
                validator: function (value) {
                    if (this.blockType !== "ppg") return true;
                    if (this.ppgMode !== "reps") return true;
                    return typeof value === "number" && value >= 1;
                },
                message: "Le nombre de répétitions doit être au moins 1 pour une PPG aux répétitions.",
            },
        },
        muscuExercises: { type: [String], default: [] },
        muscuRepetitions: {
            type: Number,
            min: 0,
            validate: {
                validator: function (value) {
                    if (this.blockType !== "muscu") return true;
                    return typeof value === "number" && value >= 1;
                },
                message: "Le nombre de répétitions doit être au moins 1 pour un bloc muscu.",
            },
        },
        recoveryMode: { type: String, enum: ["marche", "footing", "passive", "active"] },
        recoveryDurationSeconds: { type: Number, min: 0 },
        startCount: { type: Number, min: 0 },
        startExitDistance: { type: Number, min: 0 },
        repetitions: { type: Number, min: 1 },
        targetPace: { type: String, trim: true },
        recordReferenceDistance: { type: String, trim: true },
        recordReferencePercent: { type: Number, min: 0, max: 200 },
        customGoal: { type: String, trim: true },
        customMetricEnabled: { type: Boolean, default: false },
        customMetricKind: { type: String, enum: ["distance", "duration", "reps", "exo"] },
        customMetricDistance: { type: Number, min: 0 },
        customMetricDurationSeconds: { type: Number, min: 0 },
        customMetricRepetitions: { type: Number, min: 0 },
        customNotes: { type: String, trim: true },
        customExercises: { type: [String], default: [] },
    },
    { _id: false }
);

const trainingBlockSchema = new mongoose.Schema(
    {
        ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        // Shared blocks available to all users (seeded by the server).
        isDefault: { type: Boolean, default: false, index: true },
        // Stable identifier for seeded default blocks.
        defaultKey: { type: String, trim: true, unique: true, sparse: true, index: true },
        title: { type: String, required: true, trim: true },
        segment: { type: trainingBlockSegmentSchema, required: true },
        version: { type: Number, default: 1, min: 1 },
    },
    { timestamps: true }
);

trainingBlockSchema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        if (ret.ownerId) {
            ret.ownerId = ret.ownerId.toString();
        }
        return ret;
    },
});

module.exports = mongoose.model("TrainingBlock", trainingBlockSchema);
