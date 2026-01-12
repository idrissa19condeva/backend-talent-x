const mongoose = require("mongoose");

const trainingSeriesSegmentSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, trim: true },
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
                    return typeof value === "number" && value >= 1;
                },
                message: "La distance doit être positive pour ce bloc.",
            },
        },
        distanceUnit: { type: String, enum: ["m", "km"], default: "m" },
        restInterval: { type: Number, required: true, min: 0 },
        restUnit: { type: String, enum: ["s", "min"], default: "s" },
        blockName: { type: String, trim: true },
        blockType: { type: String, enum: ["vitesse", "cotes", "ppg", "muscu", "start", "recup", "custom"] },
        cotesMode: { type: String, enum: ["distance", "duration"] },
        durationSeconds: { type: Number, min: 0 },
        ppgExercises: { type: [String], default: [] },
        ppgDurationSeconds: { type: Number, min: 0 },
        ppgRestSeconds: { type: Number, min: 0 },
        muscuExercises: { type: [String], default: [] },
        muscuRepetitions: { type: Number, min: 0 },
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

const trainingSeriesSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, trim: true },
        repeatCount: { type: Number, default: 1, min: 1 },
        enablePace: { type: Boolean, default: false },
        pacePercent: { type: Number, min: 0, max: 200 },
        paceReferenceDistance: {
            type: String,
            enum: ["60m", "100m", "200m", "400m", "bodyweight", "max-muscu", "max-chariot"],
        },
        paceReferenceBodyWeightKg: { type: Number, min: 0 },
        paceReferenceMaxMuscuKg: { type: Number, min: 0 },
        paceReferenceMaxChariotKg: { type: Number, min: 0 },
        segments: { type: [trainingSeriesSegmentSchema], default: [] },
    },
    { _id: false }
);

const trainingTemplateSchema = new mongoose.Schema(
    {
        ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        // Shared templates available to all users (seeded by the server).
        isDefault: { type: Boolean, default: false, index: true },
        // Stable identifier for seeded default templates.
        defaultKey: { type: String, trim: true, unique: true, sparse: true, index: true },
        title: { type: String, required: true, trim: true },
        type: { type: String, enum: ["vitesse", "endurance", "force", "technique", "récupération"], required: true },
        description: { type: String, trim: true },
        equipment: { type: String, trim: true },
        targetIntensity: { type: Number, min: 1, max: 10 },
        series: { type: [trainingSeriesSchema], default: [] },
        seriesRestInterval: { type: Number, min: 0, default: 120 },
        seriesRestUnit: { type: String, enum: ["s", "min"], default: "s" },
        visibility: { type: String, enum: ["private"], default: "private" },
        version: { type: Number, default: 1, min: 1 },
    },
    { timestamps: true }
);

trainingTemplateSchema.set("toJSON", {
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

module.exports = mongoose.model("TrainingTemplate", trainingTemplateSchema);
