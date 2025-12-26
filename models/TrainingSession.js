const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        addedAt: { type: Date, default: Date.now },
        confirmedAt: { type: Date },
        status: { type: String, enum: ["pending", "confirmed"], default: "pending" },
    },
    { _id: false }
);

const chronoEntrySchema = new mongoose.Schema(
    {
        participant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        seriesId: { type: String, required: true, trim: true },
        seriesIndex: { type: Number, min: 0, default: 0 },
        repeatIndex: { type: Number, min: 0, default: 0 },
        segmentId: { type: String, required: true, trim: true },
        segmentIndex: { type: Number, min: 0, default: 0 },
        repetitionIndex: { type: Number, min: 0, default: 0 },
        distance: { type: Number, min: 0 },
        time: { type: String, required: true, trim: true },
        seconds: { type: Number, min: 0 },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

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
                    return typeof value === "number" && value >= 1;
                },
                message: "La distance doit être positive pour ce bloc.",
            },
        },
        distanceUnit: { type: String, enum: ["m", "km"], default: "m" },
        restInterval: { type: Number, required: true, min: 0 },
        restUnit: { type: String, enum: ["s", "min"], default: "s" },
        blockName: { type: String, trim: true },
        blockType: { type: String, enum: ["vitesse", "cotes", "ppg", "start", "recup", "custom"] },
        cotesMode: { type: String, enum: ["distance", "duration"] },
        durationSeconds: { type: Number, min: 0 },
        ppgExercises: { type: [String], default: [] },
        ppgDurationSeconds: { type: Number, min: 0 },
        ppgRestSeconds: { type: Number, min: 0 },
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

const normalizeUserLikeForJson = (value) => {
    if (!value) {
        return value;
    }

    if (typeof value === "object" && value._id) {
        const normalizedId = value._id.toString();
        return {
            ...value,
            id: normalizedId,
            _id: normalizedId,
        };
    }

    if (typeof value === "object" && value.id) {
        return {
            ...value,
            id: value.id.toString(),
        };
    }

    return value.toString();
};

const normalizeParticipantForJson = (participant) => {
    if (!participant) {
        return participant;
    }

    const normalized = { ...participant };
    normalized.user = normalizeUserLikeForJson(normalized.user);
    normalized.addedBy = normalizeUserLikeForJson(normalized.addedBy);
    return normalized;
};

const toNormalizedId = (value) => {
    if (!value) {
        return value;
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "object") {
        if (value._id) {
            return value._id.toString();
        }
        if (value.id) {
            return value.id.toString();
        }
    }
    return value.toString();
};

const normalizeChronoForJson = (entry) => {
    if (!entry) {
        return entry;
    }

    const normalized = { ...entry };
    const participantId = toNormalizedId(entry.participant || entry.participantId);
    const updatedBy = toNormalizedId(entry.updatedBy);

    normalized.participantId = participantId;
    if (updatedBy) {
        normalized.updatedBy = updatedBy;
    }

    delete normalized.participant;
    delete normalized._id;

    return normalized;
};

const buildUserPreview = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value === "object") {
        const id = value._id ? value._id.toString() : value.id ? value.id.toString() : undefined;
        return {
            id,
            _id: id,
            fullName: value.fullName,
            username: value.username,
            photoUrl: value.photoUrl,
        };
    }

    return null;
};

const trainingSessionSchema = new mongoose.Schema(
    {
        athleteId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        date: { type: Date, required: true },
        startTime: { type: String, trim: true },
        durationMinutes: { type: Number, min: 1 },
        type: { type: String, enum: ["vitesse", "endurance", "force", "technique", "récupération"], required: true },
        title: { type: String, required: true, trim: true },
        place: { type: String, trim: true },
        description: { type: String, trim: true },
        series: { type: [trainingSeriesSchema], default: [] },
        seriesRestInterval: { type: Number, min: 0, default: 120 },
        seriesRestUnit: { type: String, enum: ["s", "min"], default: "s" },
        targetIntensity: { type: Number, min: 1, max: 10 },
        coachNotes: { type: String, trim: true },
        athleteFeedback: { type: String, trim: true },
        equipment: { type: String, trim: true },
        participants: { type: [participantSchema], default: [] },
        chronos: { type: [chronoEntrySchema], default: [] },
        group: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingGroup", index: true },
        status: { type: String, enum: ["planned", "ongoing", "canceled", "done", "postponed"], default: "planned" },
    },
    { timestamps: true }
);

trainingSessionSchema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        if (doc.populated("athleteId") && doc.athleteId) {
            const athletePreview = buildUserPreview(doc.athleteId);
            if (athletePreview) {
                ret.athlete = athletePreview;
                ret.athleteId = athletePreview.id;
            } else if (ret.athleteId) {
                ret.athleteId = ret.athleteId.toString();
            }
        } else if (ret.athleteId) {
            ret.athleteId = ret.athleteId.toString();
        }
        if (Array.isArray(ret.participants)) {
            ret.participants = ret.participants.map(normalizeParticipantForJson);
        }
        if (ret.group) {
            if (typeof ret.group === "object" && ret.group._id) {
                const normalizedGroupId = ret.group._id.toString();
                ret.groupId = normalizedGroupId;
                ret.group = {
                    id: normalizedGroupId,
                    name: ret.group.name,
                    description: ret.group.description,
                };
            } else {
                const normalizedGroupId = ret.group.toString();
                ret.groupId = normalizedGroupId;
                ret.group = { id: normalizedGroupId };
            }
        }
        if (Array.isArray(ret.chronos)) {
            ret.chronos = ret.chronos.map(normalizeChronoForJson);
        }
        return ret;
    },
});

module.exports = mongoose.model("TrainingSession", trainingSessionSchema);
