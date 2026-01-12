const mongoose = require("mongoose");
const TrainingBlock = require("../models/TrainingBlock");

// Use a stable ObjectId that doesn't need to exist in the users collection.
const SYSTEM_OWNER_ID = new mongoose.Types.ObjectId("000000000000000000000000");

const DEFAULT_BLOCKS = [
    {
        defaultKey: "sprint-accel-6x30-r120",
        title: "Sprint • Accélération 6×30m (récup 2min)",
        segment: {
            blockType: "vitesse",
            distance: 30,
            distanceUnit: "m",
            repetitions: 6,
            restInterval: 120,
            restUnit: "s",
        },
    },
    {
        defaultKey: "sprint-vitesse-4x60-r180",
        title: "Sprint • Vitesse 4×60m (récup 3min)",
        segment: {
            blockType: "vitesse",
            distance: 60,
            distanceUnit: "m",
            repetitions: 4,
            restInterval: 180,
            restUnit: "s",
        },
    },
    {
        defaultKey: "demi-fond-vma-6x400-r90",
        title: "Demi-fond • VMA 6×400m (récup 1min30)",
        segment: {
            blockType: "vitesse",
            distance: 400,
            distanceUnit: "m",
            repetitions: 6,
            restInterval: 90,
            restUnit: "s",
        },
    },
    {
        defaultKey: "demi-fond-seuil-3x1000-r120",
        title: "Demi-fond • Seuil 3×1000m (récup 2min)",
        segment: {
            blockType: "vitesse",
            distance: 1000,
            distanceUnit: "m",
            repetitions: 3,
            restInterval: 120,
            restUnit: "s",
        },
    },
    {
        defaultKey: "haies-rythme-8x3haies-r60",
        title: "Haies • Rythme 8×3 haies (récup 1min)",
        segment: {
            blockType: "custom",
            distance: 0,
            distanceUnit: "m",
            restInterval: 60,
            restUnit: "s",
            customGoal: "Passages de 3 haies (rythme / 3 pas)",
            customMetricEnabled: true,
            customMetricKind: "reps",
            customMetricRepetitions: 3,
            customExercises: ["Passage de haies", "Rythme 3 pas"],
        },
    },
    {
        defaultKey: "haies-drills-10min-r60",
        title: "Haies • Drills 10 min (récup 1min)",
        segment: {
            blockType: "custom",
            distance: 0,
            distanceUnit: "m",
            restInterval: 60,
            restUnit: "s",
            customGoal: "Drills de haies (mobilité + technique)",
            customMetricEnabled: true,
            customMetricKind: "duration",
            customMetricDurationSeconds: 600,
            customExercises: ["Montées de genoux", "Passage de haies basses"],
        },
    },
    {
        defaultKey: "sauts-bondissements-3x10-r120",
        title: "Sauts • Bondissements 3×10 (récup 2min)",
        segment: {
            blockType: "custom",
            distance: 0,
            distanceUnit: "m",
            restInterval: 120,
            restUnit: "s",
            customGoal: "Bondissements (qualité d'appuis)",
            customMetricEnabled: true,
            customMetricKind: "reps",
            customMetricRepetitions: 10,
            customExercises: ["Bondissements"],
        },
    },
    {
        defaultKey: "sauts-impulsions-12-r60",
        title: "Sauts • 12 impulsions (récup 1min)",
        segment: {
            blockType: "custom",
            distance: 0,
            distanceUnit: "m",
            restInterval: 60,
            restUnit: "s",
            customGoal: "Impulsions / appels (stabilité + vitesse)",
            customMetricEnabled: true,
            customMetricKind: "reps",
            customMetricRepetitions: 12,
            customExercises: ["Impulsions", "Appels"],
        },
    },
];

const seedDefaultTrainingBlocks = async () => {
    const ops = DEFAULT_BLOCKS.map((block) => {
        const payload = {
            ownerId: SYSTEM_OWNER_ID,
            isDefault: true,
            defaultKey: block.defaultKey,
            title: block.title,
            segment: block.segment,
            version: 1,
        };

        return TrainingBlock.updateOne(
            { defaultKey: block.defaultKey },
            { $set: payload },
            { upsert: true }
        );
    });

    await Promise.all(ops);

    return {
        insertedOrUpdated: DEFAULT_BLOCKS.length,
    };
};

module.exports = {
    DEFAULT_BLOCKS,
    SYSTEM_OWNER_ID,
    seedDefaultTrainingBlocks,
};
