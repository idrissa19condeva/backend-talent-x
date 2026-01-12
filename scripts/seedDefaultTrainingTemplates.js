const mongoose = require("mongoose");
const TrainingTemplate = require("../models/TrainingTemplate");

// Use a stable ObjectId that doesn't need to exist in the users collection.
const SYSTEM_OWNER_ID = new mongoose.Types.ObjectId("000000000000000000000000");

const makeId = (prefix, n) => `${prefix}-${String(n).padStart(2, "0")}`;

const makeSerie = (idx, segments) => ({
    id: makeId("serie", idx),
    repeatCount: 1,
    enablePace: false,
    pacePercent: 95,
    paceReferenceDistance: "100m",
    segments,
});

const baseSegment = (id, overrides) => ({
    id,
    // Keep required numeric fields present for the backend schema.
    distance: 200,
    distanceUnit: "m",
    restInterval: 90,
    restUnit: "s",
    repetitions: 1,
    recordReferencePercent: 95,
    ...overrides,
});

const DEFAULT_TEMPLATES = [
    // Sprint
    {
        defaultKey: "tpl-sprint-departs-accel",
        title: "Sprint • Départs + accélération (0–30m)",
        type: "technique",
        description: "Départs courts, accélération progressive, qualité d'appuis.",
        equipment: "Starting blocks (optionnel)",
        targetIntensity: 8,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 1), {
                    blockType: "start",
                    blockName: "Départs",
                    startCount: 6,
                    startExitDistance: 20,
                    distance: 20,
                    repetitions: 1,
                    restInterval: 150,
                }),
                baseSegment(makeId("seg", 2), {
                    blockType: "vitesse",
                    blockName: "Accélération",
                    distance: 30,
                    repetitions: 6,
                    restInterval: 150,
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-sprint-vmax-fly",
        title: "Sprint • Vitesse max (fly 20m)",
        type: "vitesse",
        description: "Vitesse maximale en lancé, récupération complète.",
        equipment: "Marquage au sol (optionnel)",
        targetIntensity: 9,
        seriesRestInterval: 180,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 3), {
                    blockType: "vitesse",
                    blockName: "Fly 20m",
                    distance: 20,
                    repetitions: 8,
                    restInterval: 180,
                }),
                baseSegment(makeId("seg", 4), {
                    blockType: "recup",
                    blockName: "Retour au calme",
                    distance: 1,
                    repetitions: 1,
                    recoveryMode: "footing",
                    recoveryDurationSeconds: 600,
                    restInterval: 0,
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-sprint-speed-endurance",
        title: "Sprint • Speed endurance (5×150m)",
        type: "vitesse",
        description: "Efforts longs à haute intensité, récup longue.",
        targetIntensity: 9,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 5), {
                    blockType: "vitesse",
                    blockName: "150m",
                    distance: 150,
                    repetitions: 5,
                    restInterval: 420,
                }),
            ]),
        ],
    },

    // Demi-fond
    {
        defaultKey: "tpl-demi-fond-vma-12x200",
        title: "Demi-fond • VMA courte (12×200m)",
        type: "endurance",
        description: "VMA courte, récupération courte.",
        targetIntensity: 8,
        seriesRestInterval: 60,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 6), {
                    blockType: "vitesse",
                    blockName: "200m VMA",
                    distance: 200,
                    repetitions: 12,
                    restInterval: 60,
                }),
                baseSegment(makeId("seg", 7), {
                    blockType: "recup",
                    blockName: "Retour au calme",
                    distance: 1,
                    repetitions: 1,
                    recoveryMode: "footing",
                    recoveryDurationSeconds: 600,
                    restInterval: 0,
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-demi-fond-seuil-3x8min",
        title: "Demi-fond • Seuil / tempo (3×8 min)",
        type: "endurance",
        description: "Travail au seuil, récupération courte.",
        targetIntensity: 7,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 8), {
                    blockType: "custom",
                    blockName: "Tempo",
                    distance: 0,
                    restInterval: 120,
                    repetitions: 3,
                    customGoal: "3×8 min au seuil (tempo)",
                    customMetricEnabled: true,
                    customMetricKind: "duration",
                    customMetricDurationSeconds: 480,
                    customExercises: ["Tempo"],
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-demi-fond-6x400",
        title: "Demi-fond • Spécifique (6×400m)",
        type: "endurance",
        description: "Allure spécifique, récupération modérée.",
        targetIntensity: 8,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 9), {
                    blockType: "vitesse",
                    blockName: "400m",
                    distance: 400,
                    repetitions: 6,
                    restInterval: 150,
                }),
            ]),
        ],
    },

    // Haies
    {
        defaultKey: "tpl-haies-rythme-technique",
        title: "Haies • Rythme (technique)",
        type: "technique",
        description: "Départs + rythme de haies, récupération complète.",
        targetIntensity: 7,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 10), {
                    blockType: "start",
                    blockName: "Départs jusqu'à H1",
                    startCount: 5,
                    startExitDistance: 13,
                    distance: 13,
                    restInterval: 180,
                }),
                baseSegment(makeId("seg", 11), {
                    blockType: "custom",
                    blockName: "Passages 3 haies",
                    distance: 0,
                    restInterval: 150,
                    repetitions: 8,
                    customGoal: "Passage de 3 haies (rythme / 3 pas)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 3,
                    customExercises: ["Rythme 3 pas", "Passage de haies"],
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-haies-endurance-vitesse-4x150",
        title: "Haies • Endurance de vitesse (4×150m)",
        type: "vitesse",
        description: "Spécifique haies, récup longue.",
        targetIntensity: 9,
        seriesRestInterval: 180,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 12), {
                    blockType: "vitesse",
                    blockName: "150m haies",
                    distance: 150,
                    repetitions: 4,
                    restInterval: 480,
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-haies-coordination-haies-basses",
        title: "Haies • Coordination (haies basses)",
        type: "technique",
        description: "Drills haies basses + mobilité, intensité modérée.",
        targetIntensity: 6,
        seriesRestInterval: 60,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 13), {
                    blockType: "custom",
                    blockName: "Drills",
                    distance: 0,
                    restInterval: 90,
                    repetitions: 10,
                    customGoal: "Gammes / haies basses (qualité)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 1,
                    customExercises: ["Passage de haies basses", "Mobilité hanches"],
                }),
            ]),
        ],
    },

    // Sauts
    {
        defaultKey: "tpl-sauts-longueur-elan-appel",
        title: "Sauts • Longueur (élan + appel)",
        type: "technique",
        description: "Travail d'élan et d'appel, récupération complète.",
        targetIntensity: 7,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 14), {
                    blockType: "custom",
                    blockName: "Élan contrôlé",
                    distance: 0,
                    repetitions: 8,
                    restInterval: 120,
                    customGoal: "Courses d'élan (marquage)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 1,
                    customExercises: ["Course d’élan", "Marquage"],
                }),
                baseSegment(makeId("seg", 15), {
                    blockType: "custom",
                    blockName: "Appel + impulsion",
                    distance: 0,
                    repetitions: 8,
                    restInterval: 150,
                    customGoal: "Appel + impulsion (sans saut complet)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 1,
                    customExercises: ["Appel", "Impulsion"],
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-sauts-hauteur-approche",
        title: "Sauts • Hauteur (approche + impulsion)",
        type: "technique",
        description: "Courbe d'élan + impulsion, récup complète.",
        targetIntensity: 7,
        seriesRestInterval: 120,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 16), {
                    blockType: "custom",
                    blockName: "Courbe d'élan",
                    distance: 0,
                    repetitions: 8,
                    restInterval: 120,
                    customGoal: "Courbe d'élan (repères)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 1,
                    customExercises: ["Courbe d’élan", "Repères"],
                }),
                baseSegment(makeId("seg", 17), {
                    blockType: "custom",
                    blockName: "Sauts",
                    distance: 0,
                    repetitions: 8,
                    restInterval: 180,
                    customGoal: "Sauts (barre basse/moyenne)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 1,
                    customExercises: ["Impulsion hauteur"],
                }),
            ]),
        ],
    },
    {
        defaultKey: "tpl-sauts-force-plyo",
        title: "Sauts • Plyométrie / force spécifique",
        type: "force",
        description: "Plyo légère + renforcement, volume modéré.",
        targetIntensity: 7,
        seriesRestInterval: 90,
        seriesRestUnit: "s",
        series: [
            makeSerie(1, [
                baseSegment(makeId("seg", 18), {
                    blockType: "muscu",
                    blockName: "Renforcement",
                    distance: 0,
                    restInterval: 120,
                    repetitions: 3,
                    muscuRepetitions: 8,
                    muscuExercises: ["Squat", "Fentes", "Mollets"],
                }),
                baseSegment(makeId("seg", 19), {
                    blockType: "custom",
                    blockName: "Plyo",
                    distance: 0,
                    restInterval: 120,
                    repetitions: 5,
                    customGoal: "Plyométrie légère (qualité)",
                    customMetricEnabled: true,
                    customMetricKind: "reps",
                    customMetricRepetitions: 10,
                    customExercises: ["Sauts verticaux", "Bondissements"],
                }),
            ]),
        ],
    },
];

const seedDefaultTrainingTemplates = async () => {
    const ops = DEFAULT_TEMPLATES.map((template) => {
        const payload = {
            ownerId: SYSTEM_OWNER_ID,
            isDefault: true,
            defaultKey: template.defaultKey,
            title: template.title,
            type: template.type,
            description: template.description,
            equipment: template.equipment,
            targetIntensity: template.targetIntensity,
            series: template.series,
            seriesRestInterval: template.seriesRestInterval,
            seriesRestUnit: template.seriesRestUnit,
            visibility: "private",
            version: 1,
        };

        return TrainingTemplate.updateOne(
            { defaultKey: template.defaultKey },
            { $set: payload },
            { upsert: true },
        );
    });

    await Promise.all(ops);

    return {
        insertedOrUpdated: DEFAULT_TEMPLATES.length,
    };
};

module.exports = {
    DEFAULT_TEMPLATES,
    SYSTEM_OWNER_ID,
    seedDefaultTrainingTemplates,
};
